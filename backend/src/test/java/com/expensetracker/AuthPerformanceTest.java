package com.expensetracker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.server.ResponseStatusException;

/** P0-2：減少每個請求的 SQL、登入時間不透露帳號是否存在、通知信不阻塞回應。 */
class AuthPerformanceTest {
    private final JdbcTemplate db = mock(JdbcTemplate.class);
    private final PasswordEncoder passwords = mock(PasswordEncoder.class);
    private final AuthService auth = new AuthService(db, passwords);
    private static final String TOKEN = "t".repeat(43);

    @SuppressWarnings("unchecked")
    private void sessionRow(Object[] row) {
        when(db.query(startsWith("SELECT s.user_seq"), any(RowMapper.class), any(), any()))
            .thenReturn(row == null ? List.of() : List.<Object>of((Object) row));
    }

    @Test
    void validTokenThatDoesNotNeedRenewalUsesOneQuery() {
        sessionRow(new Object[] { 7L, false, false });
        assertEquals(new AuthService.SessionUser(7L, false), auth.findUserForToken(TOKEN));
        verify(db, never()).update(anyString(), any(), any(), any());
    }

    @Test
    void tokenNearExpiryIsRenewed() {
        sessionRow(new Object[] { 7L, true, true });
        assertEquals(new AuthService.SessionUser(7L, true), auth.findUserForToken(TOKEN));
        verify(db, times(1)).update(startsWith("UPDATE auth_session SET expires_at"),
            eq(AuthService.SESSION_DAYS), anyString(), eq(AuthService.SESSION_DAYS - 1));
    }

    @Test
    void unknownTokenIsRejectedWithoutWrites() {
        sessionRow(null);
        assertNull(auth.findUserForToken(TOKEN));
        verify(db, never()).update(anyString(), any(), any(), any());
    }

    @Test
    @SuppressWarnings("unchecked")
    void unknownEmailStillRunsPasswordCheck() {
        when(db.query(startsWith("SELECT seq, password_hash"), any(RowMapper.class), any()))
            .thenReturn(List.of());
        when(passwords.encode(anyString())).thenReturn("{bcrypt}dummy");
        var error = assertThrows(ResponseStatusException.class,
            () -> auth.login("nobody@example.com", "Password1!", "127.0.0.1"));
        assertEquals(HttpStatus.UNAUTHORIZED, error.getStatusCode());
        verify(passwords).matches("Password1!", "{bcrypt}dummy");

        // 假雜湊只產生一次
        assertThrows(ResponseStatusException.class,
            () -> auth.login("nobody@example.com", "Password1!", "127.0.0.2"));
        verify(passwords, times(1)).encode(anyString());
    }

    @Test
    void backgroundMailNeverThrowsToCaller() {
        // 沒有設定 SMTP 時 send 會丟例外；背景寄送必須吞掉，不影響註冊回應
        new MailService("", 587, "", "", "", "smtp")
            .sendInBackground("a@example.com", "subject", "text", "<p>html</p>");
    }
}
