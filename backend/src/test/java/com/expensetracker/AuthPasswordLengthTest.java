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

    @Test
    void rejectsShortOrTooLongPasswords() {
        assertThrows(ResponseStatusException.class, () -> AuthController.validate(credentials("abc1234")));
        assertThrows(ResponseStatusException.class, () -> AuthController.validate(credentials("a".repeat(129))));
    }
}
