package com.expensetracker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.server.ResponseStatusException;

/** 會員資料管理：owner 來自驗證身分、顯示名稱驗證、修改密碼流程。 */
class AccountControllerTest {
    private static final String TOKEN = "t".repeat(43);

    private final AuthService auth = mock(AuthService.class);
    private final AccountController controller = new AccountController(auth);
    private final Authentication authentication = mock(Authentication.class);

    @Test
    void readsAccountOfAuthenticatedMemberOnly() {
        when(authentication.getPrincipal()).thenReturn(7L);
        when(auth.accountFor(7L)).thenReturn(new AuthService.AccountInfo("a@b.co", "Shawn", Instant.EPOCH));
        var response = controller.get(authentication);
        assertEquals("a@b.co", response.email());
        assertEquals("Shawn", response.nickname());
        verify(auth).accountFor(7L);
    }

    @Test
    void trimsNicknameAndClearsBlankValue() {
        when(authentication.getPrincipal()).thenReturn(7L);
        when(auth.accountFor(7L)).thenReturn(new AuthService.AccountInfo("a@b.co", null, Instant.EPOCH));
        controller.updateProfile(authentication, new AccountController.ProfileRequest("  小周  "));
        verify(auth).updateNickname(7L, "小周");
        controller.updateProfile(authentication, new AccountController.ProfileRequest("   "));
        verify(auth).updateNickname(7L, null);
    }

    @Test
    void rejectsTooLongOrControlCharacterNickname() {
        assertEquals("名".repeat(50), AccountController.normalizeNickname("名".repeat(50)));
        assertThrows(ResponseStatusException.class, () -> AccountController.normalizeNickname("名".repeat(51)));
        assertThrows(ResponseStatusException.class, () -> AccountController.normalizeNickname("a\u0000b"));
        assertNull(AccountController.normalizeNickname(null));
    }

    @Test
    void rejectsWeakNewPasswordWithoutTouchingAccount() {
        when(authentication.getPrincipal()).thenReturn(7L);
        assertThrows(ResponseStatusException.class, () -> controller.changePassword(authentication,
            "Bearer " + TOKEN, new AccountController.PasswordChangeRequest("Old#Pass1", "weakpass")));
        assertThrows(ResponseStatusException.class, () -> controller.changePassword(authentication,
            "Bearer " + TOKEN, new AccountController.PasswordChangeRequest("", "New#Pass1")));
        verifyNoInteractions(auth);
    }

    @Test
    void passesCurrentTokenSoOnlyOtherSessionsAreRevoked() {
        when(authentication.getPrincipal()).thenReturn(7L);
        controller.changePassword(authentication, "Bearer " + TOKEN,
            new AccountController.PasswordChangeRequest("Old#Pass1", "New#Pass1"));
        verify(auth).changePassword(7L, TOKEN, "Old#Pass1", "New#Pass1");
    }

    @Test
    void serviceRejectsWrongCurrentPasswordWith400AndNoWrite() {
        JdbcTemplate db = mock(JdbcTemplate.class);
        PasswordEncoder encoder = mock(PasswordEncoder.class);
        AuthService service = new AuthService(db, encoder);
        when(db.queryForObject(anyString(), eq(String.class), eq(7L))).thenReturn("{bcrypt}old");
        when(encoder.matches("Wrong#Pass1", "{bcrypt}old")).thenReturn(false);
        var error = assertThrows(ResponseStatusException.class,
            () -> service.changePassword(7L, TOKEN, "Wrong#Pass1", "New#Pass1"));
        // 不可回 401，否則前端會當成登入失效
        assertEquals(HttpStatus.BAD_REQUEST, error.getStatusCode());
        verify(db, never()).update(anyString(), any(Object[].class));
    }

    @Test
    void serviceLocksAfterRepeatedWrongCurrentPassword() {
        JdbcTemplate db = mock(JdbcTemplate.class);
        PasswordEncoder encoder = mock(PasswordEncoder.class);
        AuthService service = new AuthService(db, encoder);
        when(db.queryForObject(anyString(), eq(String.class), eq(7L))).thenReturn("{bcrypt}old");
        for (int i = 0; i < 5; i++)
            assertThrows(ResponseStatusException.class, () -> service.changePassword(7L, TOKEN, "Wrong#1a", "New#Pass1"));
        var error = assertThrows(ResponseStatusException.class,
            () -> service.changePassword(7L, TOKEN, "Wrong#1a", "New#Pass1"));
        assertEquals(HttpStatus.TOO_MANY_REQUESTS, error.getStatusCode());
    }

    @Test
    void serviceUpdatesHashAndRevokesOtherSessionsOfSameMember() {
        JdbcTemplate db = mock(JdbcTemplate.class);
        PasswordEncoder encoder = mock(PasswordEncoder.class);
        AuthService service = new AuthService(db, encoder);
        when(db.queryForObject(anyString(), eq(String.class), eq(7L))).thenReturn("{bcrypt}old");
        when(encoder.matches("Old#Pass1", "{bcrypt}old")).thenReturn(true);
        when(encoder.matches("New#Pass1", "{bcrypt}old")).thenReturn(false);
        when(encoder.encode("New#Pass1")).thenReturn("{bcrypt}new");
        service.changePassword(7L, TOKEN, "Old#Pass1", "New#Pass1");
        verify(db).update(eq("UPDATE user_info SET password_hash = ?, update_time = now() WHERE seq = ?"),
            eq("{bcrypt}new"), eq(7L));
        verify(db).update(eq("UPDATE auth_session SET revoked_at = now() WHERE user_seq = ? AND token_hash <> ? AND revoked_at IS NULL"),
            eq(7L), anyString());
    }

    @Test
    void serviceRejectsReusingCurrentPassword() {
        JdbcTemplate db = mock(JdbcTemplate.class);
        PasswordEncoder encoder = mock(PasswordEncoder.class);
        AuthService service = new AuthService(db, encoder);
        when(db.queryForObject(anyString(), eq(String.class), eq(7L))).thenReturn("{bcrypt}old");
        when(encoder.matches("Same#Pass1", "{bcrypt}old")).thenReturn(true);
        assertThrows(ResponseStatusException.class, () -> service.changePassword(7L, TOKEN, "Same#Pass1", "Same#Pass1"));
        verify(db, never()).update(anyString(), any(Object[].class));
    }

}
