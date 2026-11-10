package com.expensetracker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.server.ResponseStatusException;

/** 刪除帳號：密碼確認、只刪同一會員、涵蓋所有私人資料表。 */
class AccountDeletionTest {
    private final JdbcTemplate db = mock(JdbcTemplate.class);
    private final PasswordEncoder encoder = mock(PasswordEncoder.class);
    private final AuthService service = new AuthService(db, encoder);

    @Test
    void deletesEveryTableForSameMemberInChildToParentOrder() {
        when(db.queryForObject(anyString(), eq(String.class), eq(7L))).thenReturn("{bcrypt}hash");
        when(encoder.matches("Right#Pass1", "{bcrypt}hash")).thenReturn(true);
        service.deleteAccount(7L, "Right#Pass1");
        var order = inOrder(db);
        for (String sql : AuthService.ACCOUNT_DELETE_STATEMENTS) order.verify(db).update(sql, 7L);
        assertTrue(AuthService.ACCOUNT_DELETE_STATEMENTS.getLast().startsWith("DELETE FROM user_info"));
    }

    @Test
    void wrongPasswordDeletesNothingAndIsNot401() {
        when(db.queryForObject(anyString(), eq(String.class), eq(7L))).thenReturn("{bcrypt}hash");
        var error = assertThrows(ResponseStatusException.class, () -> service.deleteAccount(7L, "Wrong#1a"));
        assertEquals(HttpStatus.BAD_REQUEST, error.getStatusCode());
        verify(db, never()).update(anyString(), any(Object[].class));
    }

    @Test
    void locksAfterRepeatedWrongPassword() {
        when(db.queryForObject(anyString(), eq(String.class), eq(7L))).thenReturn("{bcrypt}hash");
        for (int i = 0; i < 5; i++)
            assertThrows(ResponseStatusException.class, () -> service.deleteAccount(7L, "Wrong#1a"));
        var error = assertThrows(ResponseStatusException.class, () -> service.deleteAccount(7L, "Wrong#1a"));
        assertEquals(HttpStatus.TOO_MANY_REQUESTS, error.getStatusCode());
    }

    @Test
    void controllerRequiresPasswordAndUsesAuthenticatedOwner() {
        AuthService auth = mock(AuthService.class);
        AccountController controller = new AccountController(auth);
        Authentication authentication = mock(Authentication.class);
        when(authentication.getPrincipal()).thenReturn(7L);
        assertThrows(ResponseStatusException.class, () -> controller.deleteAccount(authentication,
            new AccountController.DeleteAccountRequest("")));
        assertThrows(ResponseStatusException.class, () -> controller.deleteAccount(authentication, null));
        verifyNoInteractions(auth);
        controller.deleteAccount(authentication, new AccountController.DeleteAccountRequest("Right#Pass1"));
        verify(auth).deleteAccount(7L, "Right#Pass1");
    }

    /** 之後新增含 user_seq 的資料表時，若忘了加入刪除清單，這個測試會失敗。 */
    @Test
    void deleteListCoversEveryMemberOwnedTableInMigrations() throws Exception {
        Pattern table = Pattern.compile("CREATE TABLE (\\w+) \\((.*?)\\n\\);", Pattern.DOTALL);
        Set<String> owned = new HashSet<>();
        try (var files = Files.list(Path.of("src/main/resources/db/migration"))) {
            for (Path file : files.toList()) {
                var matcher = table.matcher(Files.readString(file));
                while (matcher.find())
                    if (matcher.group(2).contains("user_seq")) owned.add(matcher.group(1));
            }
        }
        assertTrue(owned.size() >= 14, "應解析到所有會員資料表：" + owned);
        Set<String> deleted = new HashSet<>();
        for (String sql : AuthService.ACCOUNT_DELETE_STATEMENTS)
            deleted.add(sql.split(" ")[2]);
        for (String name : owned) assertTrue(deleted.contains(name), "刪除帳號未涵蓋 " + name);
        assertTrue(deleted.contains("user_info"));
    }
}
