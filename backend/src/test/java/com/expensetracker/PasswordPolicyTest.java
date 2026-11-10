package com.expensetracker;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/** 註冊密碼規則；需與前端 src/domain/password.js 一致。 */
class PasswordPolicyTest {
    @Test
    void acceptsEightCharactersWithAllCharacterTypes() {
        assertTrue(AuthController.meetsPasswordPolicy("Abcdef1!"));
        assertTrue(AuthController.meetsPasswordPolicy("MyPass#2026"));
    }

    @Test
    void rejectsPasswordsMissingAnyRequirement() {
        assertFalse(AuthController.meetsPasswordPolicy(null));
        assertFalse(AuthController.meetsPasswordPolicy("Abcde1!"));  // 7 個字元
        assertFalse(AuthController.meetsPasswordPolicy("abcdef1!")); // 沒有大寫
        assertFalse(AuthController.meetsPasswordPolicy("ABCDEF1!")); // 沒有小寫
        assertFalse(AuthController.meetsPasswordPolicy("Abcdefg!")); // 沒有數字
        assertFalse(AuthController.meetsPasswordPolicy("Abcdefg1")); // 沒有特殊符號
        assertFalse(AuthController.meetsPasswordPolicy("Abcdef1 ")); // 空白不算特殊符號
        assertFalse(AuthController.meetsPasswordPolicy("Aa1!" + "x".repeat(125))); // 超過 128
    }
}
