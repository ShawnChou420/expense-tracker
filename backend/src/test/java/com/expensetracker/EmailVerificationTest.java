package com.expensetracker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.HashSet;
import org.junit.jupiter.api.Test;

class EmailVerificationTest {
    @Test
    void codesAreSixDigits() {
        var seen = new HashSet<String>();
        for (int i = 0; i < 200; i++) {
            String code = EmailCodeService.newCode();
            assertTrue(code.matches("\\d{6}"), code);
            seen.add(code);
        }
        assertTrue(seen.size() > 150, "codes should be random");
    }

    @Test
    void hashDependsOnPurposeEmailAndCode() {
        String register = EmailCodeService.hash(EmailCodeService.Purpose.REGISTER, "a@example.com", "123456");
        assertEquals(64, register.length());
        assertNotEquals(register, EmailCodeService.hash(EmailCodeService.Purpose.RESET_PASSWORD, "a@example.com", "123456"));
        assertNotEquals(register, EmailCodeService.hash(EmailCodeService.Purpose.REGISTER, "b@example.com", "123456"));
        assertNotEquals(register, EmailCodeService.hash(EmailCodeService.Purpose.REGISTER, "a@example.com", "123457"));
    }

    @Test
    void mailIsDisabledWithoutSmtpHost() {
        assertFalse(new MailService("", 587, "", "", "", "smtp").enabled());
        assertTrue(new MailService("", 587, "", "", "", "log").enabled());
        assertTrue(new MailService("smtp.gmail.com", 587, "me@gmail.com", "app-password", "", "smtp").enabled());
    }

    @Test
    void codeEmailContainsTheCode() {
        assertTrue(MailService.codeHtml("完成註冊", "intro", "042917", "footer").contains("042917"));
    }
}
