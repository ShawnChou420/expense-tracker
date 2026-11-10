package com.expensetracker;

import java.time.Instant;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final AuthService auth;

    AuthController(AuthService auth) {
        this.auth = auth;
    }

    record Credentials(String email, String password) {}
    record TokenResponse(String token, Instant expiresAt, String email) {}

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Map<String, String>> safeAuthError(ResponseStatusException exception) {
        return ResponseEntity.status(exception.getStatusCode())
            .body(Map.of("detail", exception.getReason() == null ? "請檢查輸入資料" : exception.getReason()));
    }

    static final String PASSWORD_RULE = "密碼須為 8 至 128 個字元，且包含大寫字母、小寫字母、數字與特殊符號";

    /** 註冊用的密碼規則：8–128 字元，大寫、小寫、數字、特殊符號（非英數、非空白）各至少一個。 */
    static boolean meetsPasswordPolicy(String password) {
        return password != null
            && password.length() >= 8 && password.length() <= 128
            && password.chars().anyMatch(c -> c >= 'A' && c <= 'Z')
            && password.chars().anyMatch(c -> c >= 'a' && c <= 'z')
            && password.chars().anyMatch(c -> c >= '0' && c <= '9')
            && password.chars().anyMatch(c -> !(c >= 'A' && c <= 'Z') && !(c >= 'a' && c <= 'z')
                && !(c >= '0' && c <= '9') && !Character.isWhitespace(c));
    }

    private static void validateEmail(Credentials credentials) {
        if (credentials == null || credentials.email() == null ||
            credentials.email().length() > 100 ||
            !credentials.email().trim().matches("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "請輸入有效的 Email");
        }
    }

    /** 註冊：套用完整密碼規則。 */
    private static void validateRegistration(Credentials credentials) {
        validateEmail(credentials);
        if (!meetsPasswordPolicy(credentials.password()))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, PASSWORD_RULE);
    }

    /**
     * 登入：只檢查有輸入、長度上限，不套用註冊規則。
     * 規則變更前註冊的帳號（例如 12 字元但沒有特殊符號）才能繼續登入。
     */
    private static void validateLogin(Credentials credentials) {
        validateEmail(credentials);
        if (credentials.password() == null || credentials.password().isEmpty() || credentials.password().length() > 128)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "請輸入密碼");
    }

    @PostMapping("/register")
    TokenResponse register(@RequestBody Credentials credentials) {
        validateRegistration(credentials);
        var result = auth.register(credentials.email(), credentials.password());
        return new TokenResponse(result.token(), result.expiresAt(), result.email());
    }

    @PostMapping("/login")
    TokenResponse login(@RequestBody Credentials credentials,
                        jakarta.servlet.http.HttpServletRequest request) {
        validateLogin(credentials);
        var result = auth.login(credentials.email(), credentials.password(), request.getRemoteAddr());
        return new TokenResponse(result.token(), result.expiresAt(), result.email());
    }

    @PostMapping("/logout")
    @org.springframework.web.bind.annotation.ResponseStatus(HttpStatus.NO_CONTENT)
    void logout(Authentication authentication, @RequestHeader("Authorization") String header) {
        auth.logout((Long) authentication.getPrincipal(), header.substring(7));
    }

    @GetMapping("/me")
    Map<String, String> me(Authentication authentication) {
        return Map.of("email", auth.emailFor((Long) authentication.getPrincipal()));
    }
}
