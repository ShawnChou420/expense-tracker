package com.expensetracker;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * 6 位數 Email 驗證碼：10 分鐘有效、最多錯 5 次、同一個 Email 60 秒內只能寄一次、每小時最多 5 封。
 * 資料庫只存雜湊。驗證失敗的次數要立刻寫入（不在交易裡，避免被 rollback）。
 */
@Service
public class EmailCodeService {
    enum Purpose { REGISTER, RESET_PASSWORD }

    static final int CODE_TTL_MINUTES = 10;
    static final int RESEND_SECONDS = 60;
    static final int MAX_PER_HOUR = 5;
    static final int MAX_ATTEMPTS = 5;
    private static final SecureRandom RANDOM = new SecureRandom();

    private final JdbcTemplate db;
    private final MailService mail;

    EmailCodeService(JdbcTemplate db, MailService mail) {
        this.db = db;
        this.mail = mail;
    }

    boolean enabled() {
        return mail.enabled();
    }

    static String newCode() {
        return String.format("%06d", RANDOM.nextInt(1_000_000));
    }

    static String hash(Purpose purpose, String email, String code) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest((purpose + ":" + email + ":" + code).getBytes(StandardCharsets.UTF_8)));
        } catch (Exception exception) {
            throw new IllegalStateException("SHA-256 unavailable", exception);
        }
    }

    private boolean userExists(String email) {
        Integer count = db.queryForObject(
            "SELECT count(*) FROM user_info WHERE email_normalized = ?", Integer.class, email);
        return count != null && count > 0;
    }

    /** 寄送驗證碼。忘記密碼時，Email 不存在也回傳成功但不寄信。 */
    void request(String email, Purpose purpose) {
        if (!enabled()) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Email 驗證尚未啟用");
        db.update("DELETE FROM email_verification_code WHERE created_at < now() - interval '1 day'");
        var recent = db.query(
            "SELECT created_at FROM email_verification_code WHERE email_normalized = ? AND purpose = ? "
                + "AND created_at > now() - interval '1 hour' ORDER BY created_at DESC",
            (rs, row) -> rs.getTimestamp(1).toInstant(), email, purpose.name());
        if (!recent.isEmpty()) {
            long wait = RESEND_SECONDS - ChronoUnit.SECONDS.between(recent.get(0), Instant.now());
            if (wait > 0) throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "請等 " + wait + " 秒後再重新寄送");
            if (recent.size() >= MAX_PER_HOUR) {
                throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "寄送次數太多，請一小時後再試");
            }
        }
        if (purpose == Purpose.REGISTER && userExists(email)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "這個 Email 已經註冊過，請直接登入；忘記密碼可以重設");
        }
        if (purpose == Purpose.RESET_PASSWORD && !userExists(email)) {
            // 不透露帳號是否存在，但仍記一筆，讓頻率限制一致
            db.update("INSERT INTO email_verification_code(email_normalized, purpose, code_hash, expires_at, consumed_at) "
                + "VALUES (?, ?, ?, now(), now())", email, purpose.name(), "0".repeat(64));
            return;
        }
        String code = newCode();
        db.update("UPDATE email_verification_code SET consumed_at = now() "
            + "WHERE email_normalized = ? AND purpose = ? AND consumed_at IS NULL", email, purpose.name());
        db.update("INSERT INTO email_verification_code(email_normalized, purpose, code_hash, expires_at) VALUES (?, ?, ?, ?)",
            email, purpose.name(), hash(purpose, email, code),
            Timestamp.from(Instant.now().plus(CODE_TTL_MINUTES, ChronoUnit.MINUTES)));
        boolean register = purpose == Purpose.REGISTER;
        String subject = (register ? "你的註冊驗證碼：" : "你的重設密碼驗證碼：") + code;
        String intro = register ? "請在 App 輸入下面的驗證碼完成註冊。" : "請在 App 輸入下面的驗證碼，並設定新的密碼。";
        String footer = "驗證碼 " + CODE_TTL_MINUTES + " 分鐘內有效。如果這不是你本人操作，請忽略這封信，你的帳號不會有任何變動。";
        try {
            mail.send(email, subject, intro + "\n\n驗證碼：" + code + "\n\n" + footer,
                MailService.codeHtml(register ? "完成註冊" : "重設密碼", intro, code, footer));
        } catch (IllegalStateException exception) {
            db.update("UPDATE email_verification_code SET consumed_at = now() "
                + "WHERE email_normalized = ? AND purpose = ? AND consumed_at IS NULL", email, purpose.name());
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "驗證信寄送失敗，請稍後再試");
        }
    }

    /** 驗證並使用驗證碼；錯誤次數立即寫入。 */
    void verify(String email, Purpose purpose, String code) {
        if (code == null || !code.trim().matches("\\d{6}")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "請輸入 6 位數驗證碼");
        }
        var rows = db.query(
            "SELECT id, code_hash, attempts, expires_at FROM email_verification_code "
                + "WHERE email_normalized = ? AND purpose = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1",
            (rs, row) -> new Object[] { rs.getLong(1), rs.getString(2), rs.getInt(3), rs.getTimestamp(4).toInstant() },
            email, purpose.name());
        if (rows.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "驗證碼已失效，請重新寄送");
        }
        long id = (Long) rows.get(0)[0];
        if ((Integer) rows.get(0)[2] >= MAX_ATTEMPTS) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "驗證碼錯誤次數太多，請重新寄送");
        }
        if (((Instant) rows.get(0)[3]).isBefore(Instant.now())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "驗證碼已過期，請重新寄送");
        }
        boolean matches = MessageDigest.isEqual(
            hash(purpose, email, code.trim()).getBytes(StandardCharsets.UTF_8),
            ((String) rows.get(0)[1]).getBytes(StandardCharsets.UTF_8));
        if (!matches) {
            db.update("UPDATE email_verification_code SET attempts = attempts + 1 WHERE id = ?", id);
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "驗證碼不正確");
        }
        int updated = db.update(
            "UPDATE email_verification_code SET consumed_at = now() WHERE id = ? AND consumed_at IS NULL", id);
        if (updated != 1) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "驗證碼已失效，請重新寄送");
    }
}
