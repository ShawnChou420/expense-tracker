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
    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(AuthController.class);
    private final AuthService auth;
    private final EmailCodeService codes;
    private final MailService mail;

    AuthController(AuthService auth, EmailCodeService codes, MailService mail) {
        this.auth = auth;
        this.codes = codes;
        this.mail = mail;
    }

    record Credentials(String email, String password) {}
    record RegisterRequest(String email, String password, String code) {}
    record CodeRequest(String email, String purpose) {}
    record TokenResponse(String token, Instant expiresAt, String email) {}

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Map<String, String>> safeAuthError(ResponseStatusException exception) {
        return ResponseEntity.status(exception.getStatusCode())
            .body(Map.of("detail", exception.getReason() == null ? "請檢查輸入資料" : exception.getReason()));
    }

    static final int MIN_PASSWORD_LENGTH = 8;

    static void validate(Credentials credentials) {
        if (credentials == null || credentials.email() == null ||
            credentials.email().length() > 100 ||
            !credentials.email().trim().matches("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "請輸入有效的 Email");
        }
        if (credentials.password() == null || credentials.password().isBlank() || credentials.password().length() < MIN_PASSWORD_LENGTH ||
            credentials.password().length() > 128) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "密碼須為 8 至 128 個字元");
        }
    }

    static void validateEmail(String email) {
        validate(new Credentials(email, "x".repeat(MIN_PASSWORD_LENGTH)));
    }

    /** 前端用來決定註冊是否需要驗證碼、是否提供忘記密碼 */
    @GetMapping("/config")
    Map<String, Object> config() {
        return Map.of("emailVerification", codes.enabled());
    }

    @PostMapping("/email-code")
    ResponseEntity<Map<String, Object>> emailCode(@RequestBody CodeRequest request) {
        if (request == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "請輸入有效的 Email");
        validateEmail(request.email());
        EmailCodeService.Purpose purpose;
        try {
            purpose = EmailCodeService.Purpose.valueOf(String.valueOf(request.purpose()));
        } catch (IllegalArgumentException exception) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "不支援的驗證類型");
        }
        codes.request(AuthService.normalizeEmail(request.email()), purpose);
        return ResponseEntity.accepted().body(Map.of(
            "resendAfterSeconds", EmailCodeService.RESEND_SECONDS,
            "expiresInMinutes", EmailCodeService.CODE_TTL_MINUTES));
    }

    @PostMapping("/register")
    TokenResponse register(@RequestBody RegisterRequest request) {
        if (request == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "請輸入有效的 Email");
        validate(new Credentials(request.email(), request.password()));
        boolean verify = codes.enabled();
        if (verify) {
            codes.verify(AuthService.normalizeEmail(request.email()), EmailCodeService.Purpose.REGISTER, request.code());
        }
        var result = auth.register(request.email(), request.password(), verify);
        if (verify) {
            try {
                mail.send(result.email(), "歡迎使用 WORK & SAVE",
                    "你的帳號 " + result.email() + " 已經建立完成。", MailService.welcomeHtml(result.email()));
            } catch (RuntimeException exception) {
                log.warn("歡迎信寄送失敗");
            }
        }
        return new TokenResponse(result.token(), result.expiresAt(), result.email());
    }

    @PostMapping("/reset-password")
    TokenResponse resetPassword(@RequestBody RegisterRequest request) {
        if (request == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "請輸入有效的 Email");
        if (!codes.enabled()) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Email 驗證尚未啟用");
        validate(new Credentials(request.email(), request.password()));
        codes.verify(AuthService.normalizeEmail(request.email()), EmailCodeService.Purpose.RESET_PASSWORD, request.code());
        var result = auth.resetPassword(request.email(), request.password());
        return new TokenResponse(result.token(), result.expiresAt(), result.email());
    }

    @PostMapping("/login")
    TokenResponse login(@RequestBody Credentials credentials,
                        jakarta.servlet.http.HttpServletRequest request) {
        validate(credentials);
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
