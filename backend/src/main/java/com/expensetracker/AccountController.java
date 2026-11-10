package com.expensetracker;

import java.time.Instant;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** 會員資料管理；owner 一律取自驗證身分，不接受前端傳入的 user ID。 */
@RestController
@RequestMapping("/api/account")
public class AccountController {
    static final int NICKNAME_MAX_LENGTH = 50; // 對應 user_info.nickname VARCHAR(50)

    private final AuthService auth;

    AccountController(AuthService auth) {
        this.auth = auth;
    }

    record AccountResponse(String email, String nickname, Instant createdAt) {}
    record ProfileRequest(String nickname) {}
    record PasswordChangeRequest(String currentPassword, String newPassword) {}

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Map<String, String>> safeError(ResponseStatusException exception) {
        return ResponseEntity.status(exception.getStatusCode())
            .body(Map.of("detail", exception.getReason() == null ? "請檢查輸入資料" : exception.getReason()));
    }

    @GetMapping
    AccountResponse get(Authentication authentication) {
        var info = auth.accountFor(owner(authentication));
        return new AccountResponse(info.email(), info.nickname(), info.createdAt());
    }

    @PutMapping("/profile")
    AccountResponse updateProfile(Authentication authentication, @RequestBody ProfileRequest request) {
        Long owner = owner(authentication);
        auth.updateNickname(owner, normalizeNickname(request == null ? null : request.nickname()));
        return get(authentication);
    }

    @PostMapping("/password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void changePassword(Authentication authentication, @RequestHeader("Authorization") String header,
                        @RequestBody PasswordChangeRequest request) {
        if (request == null || request.currentPassword() == null || request.currentPassword().isEmpty()
            || request.currentPassword().length() > 128)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "請輸入目前密碼");
        // 新密碼套用與註冊相同的規則
        if (!AuthController.meetsPasswordPolicy(request.newPassword()))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, AuthController.PASSWORD_RULE);
        auth.changePassword(owner(authentication), header.substring(7),
            request.currentPassword(), request.newPassword());
    }

    /** 去除前後空白；空字串視為清除（null）；超過長度或含控制字元則拒絕。 */
    static String normalizeNickname(String nickname) {
        if (nickname == null) return null;
        String trimmed = nickname.strip();
        if (trimmed.isEmpty()) return null;
        if (trimmed.codePointCount(0, trimmed.length()) > NICKNAME_MAX_LENGTH)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "顯示名稱最多 " + NICKNAME_MAX_LENGTH + " 個字");
        if (trimmed.codePoints().anyMatch(Character::isISOControl))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "顯示名稱含有不支援的字元");
        return trimmed;
    }

    private static Long owner(Authentication authentication) {
        return (Long) authentication.getPrincipal();
    }
}
