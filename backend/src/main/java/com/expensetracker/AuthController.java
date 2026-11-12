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

    @PostMapping("/register")
    TokenResponse register(@RequestBody Credentials credentials) {
        validate(credentials);
        var result = auth.register(credentials.email(), credentials.password());
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
