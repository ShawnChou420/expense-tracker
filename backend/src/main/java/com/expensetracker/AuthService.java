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
    private final JdbcTemplate db;
    private final PasswordEncoder passwords;
    private final Map<String, Attempt> attempts = new ConcurrentHashMap<>();

    AuthService(JdbcTemplate db, PasswordEncoder passwords) {
        this.db = db;
        this.passwords = passwords;
    }

    record Attempt(int count, Instant until) {}
    record IssuedToken(String token, Instant expiresAt, String email) {}

    static String normalizeEmail(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }

    @Transactional
    IssuedToken register(String email, String password) {
        String normalized = normalizeEmail(email);
        try {
            Long userSeq = db.queryForObject(
                "INSERT INTO user_info(user_id, email, email_normalized, password_hash) VALUES (?, ?, ?, ?) RETURNING seq",
                Long.class, UUID.randomUUID().toString(), normalized, normalized, passwords.encode(password));
            return issue(userSeq, normalized);
        } catch (DuplicateKeyException exception) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "無法建立帳號，請檢查輸入資料");
        }
    }

    @Transactional
    IssuedToken login(String email, String password, String ip) {
        String normalized = normalizeEmail(email);
        String key = ip + ":" + normalized;
        Attempt state = attempts.get(key);
        if (state != null && state.count >= 5 && state.until.isAfter(Instant.now())) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "請稍後再試");
        }
        var users = db.query(
            "SELECT seq, password_hash FROM user_info WHERE email_normalized = ?",
            (rs, row) -> new Object[] { rs.getLong("seq"), rs.getString("password_hash") }, normalized);
        if (users.size() != 1 || !passwords.matches(password, (String) users.get(0)[1])) {
            attempts.compute(key, (ignored, old) ->
                new Attempt(old == null || old.until.isBefore(Instant.now()) ? 1 : old.count + 1,
                    Instant.now().plus(15, ChronoUnit.MINUTES)));
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Email 或密碼不正確");
        }
        attempts.remove(key);
        return issue((Long) users.get(0)[0], normalized);
    }

    private IssuedToken issue(Long userSeq, String email) {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        Instant expires = Instant.now().plus(12, ChronoUnit.HOURS);
        db.update("INSERT INTO auth_session(token_hash, user_seq, expires_at) VALUES (?, ?, ?)",
            hash(token), userSeq, java.sql.Timestamp.from(expires));
        return new IssuedToken(token, expires, email);
    }

    Long findUserForToken(String token) {
        if (token.length() < 40 || token.length() > 100) return null;
        var users = db.query(
            "SELECT user_seq FROM auth_session WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > now()",
            (rs, row) -> rs.getLong(1), hash(token));
        return users.isEmpty() ? null : users.get(0);
    }

    void logout(Long userSeq, String token) {
        db.update("UPDATE auth_session SET revoked_at = now() WHERE user_seq = ? AND token_hash = ?",
            userSeq, hash(token));
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
        String key = "password-change:" + userSeq;
        Attempt state = attempts.get(key);
        if (state != null && state.count >= 5 && state.until.isAfter(Instant.now())) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "請稍後再試");
        }
        String hash = db.queryForObject("SELECT password_hash FROM user_info WHERE seq = ?", String.class, userSeq);
        if (hash == null || !passwords.matches(currentPassword, hash)) {
            attempts.compute(key, (ignored, old) ->
                new Attempt(old == null || old.until.isBefore(Instant.now()) ? 1 : old.count + 1,
                    Instant.now().plus(15, ChronoUnit.MINUTES)));
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "目前密碼不正確");
        }
        attempts.remove(key);
        if (passwords.matches(newPassword, hash)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "新密碼不可與目前密碼相同");
        }
        db.update("UPDATE user_info SET password_hash = ?, update_time = now() WHERE seq = ?",
            passwords.encode(newPassword), userSeq);
        db.update("UPDATE auth_session SET revoked_at = now() WHERE user_seq = ? AND token_hash <> ? AND revoked_at IS NULL",
            userSeq, hash(currentToken));
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
