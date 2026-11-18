package com.expensetracker;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class AuthService {
    private static final SecureRandom RANDOM = new SecureRandom();
    /** 沒有主動登出就保持登入；使用中會自動延長，30 天完全沒用才需要重新登入 */
    static final int SESSION_DAYS = 30;
    private final JdbcTemplate db;
    private final PasswordEncoder passwords;
    private final Map<String, Attempt> attempts = new ConcurrentHashMap<>();
    /** 活動事件紀錄；單元測試可以不提供 */
    private final ActivityLog activity;

    AuthService(JdbcTemplate db, PasswordEncoder passwords) {
        this(db, passwords, null);
    }

    @org.springframework.beans.factory.annotation.Autowired
    AuthService(JdbcTemplate db, PasswordEncoder passwords, ActivityLog activity) {
        this.db = db;
        this.passwords = passwords;
        this.activity = activity;
    }

    private void event(Long userSeq, String type, boolean ok, String errorCode) {
        if (activity != null) activity.record(userSeq, "USER", type, ok, errorCode, null);
    }

    /** 登入身分：會員編號與是否為 SUPER_ADMIN（每個請求由 TokenFilter 查一次） */
    record SessionUser(long userSeq, boolean superAdmin) {}
    static final String SUPER_ADMIN = "SUPER_ADMIN";

    private volatile String dummyHash;

    /** 第一次需要時才產生，避免拖慢冷啟動 */
    String dummyHash() {
        String hash = dummyHash;
        if (hash == null) {
            byte[] bytes = new byte[16];
            RANDOM.nextBytes(bytes);
            hash = dummyHash = passwords.encode(Base64.getEncoder().encodeToString(bytes));
        }
        return hash;
    }

    record Attempt(int count, Instant until) {}
    record IssuedToken(String token, Instant expiresAt, String email) {}

    static String normalizeEmail(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }

    @Transactional
    IssuedToken register(String email, String password, boolean emailVerified) {
        String normalized = normalizeEmail(email);
        try {
            Long userSeq = db.queryForObject(
                "INSERT INTO user_info(user_id, email, email_normalized, password_hash, email_verified_at) "
                    + "VALUES (?, ?, ?, ?, CASE WHEN ? THEN now() END) RETURNING seq",
                Long.class, UUID.randomUUID().toString(), normalized, normalized, passwords.encode(password),
                emailVerified);
            AuditLog.event("REGISTER", userSeq, normalized);
            event(userSeq, "REGISTER_SUCCESS", true, null);
            return issue(userSeq, normalized);
        } catch (DuplicateKeyException exception) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "這個 Email 已經註冊過，請直接登入；忘記密碼可以重設");
        }
    }

    /** 用 Email 驗證碼重設密碼：更新密碼、登出所有裝置、標記 Email 已驗證，並直接登入。 */
    @Transactional
    IssuedToken resetPassword(String email, String password) {
        String normalized = normalizeEmail(email);
        var users = db.query("SELECT seq FROM user_info WHERE email_normalized = ?",
            (rs, row) -> rs.getLong(1), normalized);
        if (users.size() != 1) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "驗證碼已失效，請重新寄送");
        Long userSeq = users.get(0);
        db.update("UPDATE user_info SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, now()), "
            + "update_time = now() WHERE seq = ?", passwords.encode(password), userSeq);
        db.update("UPDATE auth_session SET revoked_at = now() WHERE user_seq = ? AND revoked_at IS NULL", userSeq);
        attempts.keySet().removeIf(key -> key.endsWith(":" + normalized));
        AuditLog.event("PASSWORD_RESET", userSeq, normalized);
        return issue(userSeq, normalized);
    }

    @Transactional
    IssuedToken login(String email, String password, String ip) {
        String normalized = normalizeEmail(email);
        // 失敗次數只存在記憶體：清掉已過期的，避免被大量亂打的帳號塞滿
        if (attempts.size() > 5_000) attempts.values().removeIf(item -> item.until.isBefore(Instant.now()));
        String key = ip + ":" + normalized;
        Attempt state = attempts.get(key);
        if (state != null && state.count >= 5 && state.until.isAfter(Instant.now())) {
            AuditLog.event("LOGIN_LOCKED", null, normalized);
            event(null, "LOGIN_FAILED", false, "RATE_LIMITED");
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "請稍後再試");
        }
        var users = db.query(
            "SELECT seq, password_hash, account_status FROM user_info WHERE email_normalized = ?",
            (rs, row) -> new Object[] { rs.getLong("seq"), rs.getString("password_hash"), rs.getString("account_status") },
            normalized);
        // Email 不存在時也跑一次相同成本的密碼比對，讓回應時間不會透露帳號是否存在
        boolean valid;
        if (users.size() == 1) {
            valid = passwords.matches(password, (String) users.get(0)[1]);
        } else {
            passwords.matches(password, dummyHash());
            valid = false;
        }
        if (!valid) {
            attempts.compute(key, (ignored, old) ->
                new Attempt(old == null || old.until.isBefore(Instant.now()) ? 1 : old.count + 1,
                    Instant.now().plus(15, ChronoUnit.MINUTES)));
            AuditLog.event("LOGIN_FAILED", users.size() == 1 ? (Long) users.get(0)[0] : null, normalized);
            event(users.size() == 1 ? (Long) users.get(0)[0] : null, "LOGIN_FAILED", false, "BAD_CREDENTIALS");
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Email 或密碼不正確");
        }
        attempts.remove(key);
        // 密碼正確才告知帳號已停用，避免透露帳號狀態給不知道密碼的人
        if (!"ACTIVE".equals(users.get(0)[2])) {
            event((Long) users.get(0)[0], "LOGIN_FAILED", false, "ACCOUNT_DISABLED");
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "這個帳號已停用，如有疑問請聯絡我們");
        }
        AuditLog.event("LOGIN", (Long) users.get(0)[0], null);
        event((Long) users.get(0)[0], "LOGIN_SUCCESS", true, null);
        return issue((Long) users.get(0)[0], normalized);
    }

    private IssuedToken issue(Long userSeq, String email) {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        Instant expires = Instant.now().plus(SESSION_DAYS, ChronoUnit.DAYS);
        db.update("UPDATE user_info SET last_login_at = now() WHERE seq = ?", userSeq);
        db.update("INSERT INTO auth_session(token_hash, user_seq, expires_at) VALUES (?, ?, ?)",
            hash(token), userSeq, java.sql.Timestamp.from(expires));
        return new IssuedToken(token, expires, email);
    }

    SessionUser findUserForToken(String token) {
        if (token.length() < 40 || token.length() > 100) return null;
        String tokenHash = hash(token);
        // 一次查出：是否需要延長、帳號是否啟用、是否為 SUPER_ADMIN（大多數請求只要 1 次 SQL）
        var sessions = db.query(
            "SELECT s.user_seq, s.expires_at < now() + (? * interval '1 day') AS renew, "
                + "EXISTS (SELECT 1 FROM user_role r WHERE r.user_seq = s.user_seq AND r.role = 'SUPER_ADMIN') AS super_admin "
                + "FROM auth_session s JOIN user_info u ON u.seq = s.user_seq "
                + "WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > now() AND u.account_status = 'ACTIVE'",
            (rs, row) -> new Object[] { rs.getLong("user_seq"), rs.getBoolean("renew"), rs.getBoolean("super_admin") },
            SESSION_DAYS - 1, tokenHash);
        if (sessions.isEmpty()) return null;
        // 滑動期限：最多一天延長一次，只有需要延長時才寫資料庫
        if ((Boolean) sessions.get(0)[1]) {
            db.update("UPDATE auth_session SET expires_at = now() + (? * interval '1 day') "
                + "WHERE token_hash = ? AND expires_at < now() + (? * interval '1 day')",
                SESSION_DAYS, tokenHash, SESSION_DAYS - 1);
        }
        return new SessionUser((Long) sessions.get(0)[0], (Boolean) sessions.get(0)[2]);
    }

    /** 這位會員的角色（一般會員是空清單） */
    java.util.List<String> rolesFor(long userSeq) {
        return db.queryForList("SELECT role FROM user_role WHERE user_seq = ? ORDER BY role", String.class, userSeq);
    }

    /** 管理員執行敏感操作前再次驗證密碼（15 分鐘 5 次限制） */
    void reauthenticate(long userSeq, String password) {
        verifyCurrentPassword("admin-reauth:" + userSeq, userSeq, password == null ? "" : password);
    }

    /** 是否為最後一位 SUPER_ADMIN（避免被降權、停用或刪除後沒人能管理） */
    boolean isLastSuperAdmin(long userSeq) {
        Integer others = db.queryForObject(
            "SELECT count(*) FROM user_role WHERE role = 'SUPER_ADMIN' AND user_seq <> ?", Integer.class, userSeq);
        Integer self = db.queryForObject(
            "SELECT count(*) FROM user_role WHERE role = 'SUPER_ADMIN' AND user_seq = ?", Integer.class, userSeq);
        return self != null && self > 0 && (others == null || others == 0);
    }

    void logout(Long userSeq, String token) {
        db.update("UPDATE auth_session SET revoked_at = now() WHERE user_seq = ? AND token_hash = ?",
            userSeq, hash(token));
        AuditLog.event("LOGOUT", userSeq, null);
        event(userSeq, "LOGOUT", true, null);
    }

    record AccountInfo(String email, String nickname, Instant createdAt) {}

    /** 會員資料只依驗證身分查詢；create_time 為註冊時間。 */
    AccountInfo accountFor(Long userSeq) {
        return db.queryForObject(
            "SELECT email_normalized, nickname, create_time FROM user_info WHERE seq = ?",
            (rs, row) -> {
                var created = rs.getTimestamp("create_time");
                return new AccountInfo(rs.getString("email_normalized"), rs.getString("nickname"),
                    created == null ? null : created.toInstant());
            }, userSeq);
    }

    /** nickname 為 null 代表清除顯示名稱。 */
    void updateNickname(Long userSeq, String nickname) {
        db.update("UPDATE user_info SET nickname = ?, update_time = now() WHERE seq = ?", nickname, userSeq);
    }

    /**
     * 修改密碼：先驗證目前密碼，更新雜湊後撤銷此會員其他所有未撤銷的 session，保留目前這個 token。
     * 目前密碼錯誤回 400（不是 401），避免前端把它當成登入失效而清除登入狀態。
     */
    @Transactional
    void changePassword(Long userSeq, String currentToken, String currentPassword, String newPassword) {
        String hash = verifyCurrentPassword("password-change:" + userSeq, userSeq, currentPassword);
        if (passwords.matches(newPassword, hash)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "新密碼不可與目前密碼相同");
        }
        db.update("UPDATE user_info SET password_hash = ?, update_time = now() WHERE seq = ?",
            passwords.encode(newPassword), userSeq);
        db.update("UPDATE auth_session SET revoked_at = now() WHERE user_seq = ? AND token_hash <> ? AND revoked_at IS NULL",
            userSeq, hash(currentToken));
        AuditLog.event("PASSWORD_CHANGE", userSeq, null);
    }

    /** 刪除帳號時依外鍵由子到父刪除；全部表都以 user_seq 限定為同一會員。 */
    static final java.util.List<String> ACCOUNT_DELETE_STATEMENTS = java.util.List.of(
        "DELETE FROM trip_payment WHERE user_seq = ?",
        "DELETE FROM trip_charge WHERE user_seq = ?",
        "DELETE FROM trip WHERE user_seq = ?",
        "DELETE FROM passenger WHERE user_seq = ?",
        "DELETE FROM payslip_import WHERE user_seq = ?", // 參照 salary_deposit，先刪
        "DELETE FROM work_profile WHERE user_seq = ?",
        "DELETE FROM expense_payment WHERE user_seq = ?",
        "DELETE FROM expense_record WHERE user_seq = ?",
        "DELETE FROM salary_deposit WHERE user_seq = ?",
        "DELETE FROM saving_goal WHERE user_seq = ?",
        "DELETE FROM user_preferences WHERE user_seq = ?",
        "DELETE FROM salary_setting_info WHERE user_seq = ?",
        "DELETE FROM work_shift_info WHERE user_seq = ?",
        "DELETE FROM leave_blackout WHERE user_seq = ?",
        "DELETE FROM leave_blackout_notice WHERE user_seq = ?",
        "DELETE FROM visa_journey WHERE user_seq = ?",
        "DELETE FROM shopping_item WHERE user_seq = ?",
        "DELETE FROM daily_task_completion WHERE user_seq = ?", // 參照 daily_task，先刪
        "DELETE FROM daily_task WHERE user_seq = ?",
        "DELETE FROM daily_journal WHERE user_seq = ?",
        "DELETE FROM user_quote_history WHERE user_seq = ?",
        "DELETE FROM user_daily_quote WHERE user_seq = ?",
        "DELETE FROM user_activity_event WHERE user_seq = ?",
        "DELETE FROM user_role WHERE user_seq = ?",
        "DELETE FROM auth_session WHERE user_seq = ?",
        // 驗證碼以 Email 為鍵，不含 user_seq；一併刪除未過期的驗證碼
        "DELETE FROM email_verification_code WHERE email_normalized = (SELECT email_normalized FROM user_info WHERE seq = ?)",
        "DELETE FROM user_info WHERE seq = ?");

    /**
     * 刪除帳號：再次驗證密碼後，在同一交易內刪除此會員所有私人資料與所有 session。
     * 任何一步失敗整筆回滾，不會留下部分刪除的帳號。
     */
    @Transactional
    void deleteAccount(Long userSeq, String password) {
        verifyCurrentPassword("account-delete:" + userSeq, userSeq, password);
        if (isLastSuperAdmin(userSeq))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "你是最後一位管理員，請先授權其他管理員再刪除帳號");
        deleteAccountData(userSeq);
        event(userSeq, "ACCOUNT_DELETED", true, null);
    }

    /** 依外鍵由子到父刪除這位會員的所有私人資料與 session（呼叫端負責交易與權限檢查） */
    void deleteAccountData(long userSeq) {
        for (String sql : ACCOUNT_DELETE_STATEMENTS) db.update(sql, userSeq);
        AuditLog.event("ACCOUNT_DELETE", userSeq, null);
    }

    /** 驗證目前密碼並套用 15 分鐘 5 次的嘗試限制；錯誤回 400（不是 401），回傳目前雜湊。 */
    private String verifyCurrentPassword(String key, Long userSeq, String password) {
        Attempt state = attempts.get(key);
        if (state != null && state.count >= 5 && state.until.isAfter(Instant.now())) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "請稍後再試");
        }
        String hash = db.queryForObject("SELECT password_hash FROM user_info WHERE seq = ?", String.class, userSeq);
        if (hash == null || !passwords.matches(password, hash)) {
            attempts.compute(key, (ignored, old) ->
                new Attempt(old == null || old.until.isBefore(Instant.now()) ? 1 : old.count + 1,
                    Instant.now().plus(15, ChronoUnit.MINUTES)));
            AuditLog.event(key.startsWith("account-delete") ? "DELETE_PASSWORD_FAILED" : "PASSWORD_CHECK_FAILED", userSeq, null);
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "目前密碼不正確");
        }
        attempts.remove(key);
        return hash;
    }

    Long userSeqForEmail(String email) {
        var rows = db.queryForList("SELECT seq FROM user_info WHERE email_normalized = ?", Long.class, normalizeEmail(email));
        return rows.isEmpty() ? null : rows.get(0);
    }

    String emailFor(Long userSeq) {
        return db.queryForObject("SELECT email_normalized FROM user_info WHERE seq = ?", String.class, userSeq);
    }

    private static String hash(String token) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(token.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception exception) {
            throw new IllegalStateException("SHA-256 unavailable", exception);
        }
    }
}
