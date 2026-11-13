package com.expensetracker;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class AuthPasswordLengthTest {
    private static AuthController.Credentials credentials(String password) {
        return new AuthController.Credentials("user@example.com", password);
    }

    @Test
    void acceptsEightCharacterPasswords() {
        assertDoesNotThrow(() -> AuthController.validate(credentials("abcd1234")));
    }

    /** 登入的基本檢查只看長度；設定新密碼（註冊、重設）另外要求大小寫、數字、符號。 */
    @Test
    void newPasswordsAlsoNeedAllCharacterTypes() {
        assertThrows(ResponseStatusException.class, () -> AuthController.validateNewPassword(credentials("abcd1234")));
        assertDoesNotThrow(() -> AuthController.validateNewPassword(credentials("Abcd123!")));
    }

    @Test
    void rejectsShortOrTooLongPasswords() {
        assertThrows(ResponseStatusException.class, () -> AuthController.validate(credentials("abc1234")));
        assertThrows(ResponseStatusException.class, () -> AuthController.validate(credentials("a".repeat(129))));
    }
}
