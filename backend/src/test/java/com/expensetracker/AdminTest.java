package com.expensetracker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/** Super Admin：權限、稽核、保護最後一位管理員、事件內容不含個資。 */
class AdminTest {
    private final JdbcTemplate db = mock(JdbcTemplate.class);
    private final AuthService auth = mock(AuthService.class);
    private final AdminService admin = new AdminService(db, auth, new ObjectMapper(), mock(PlatformTransactionManager.class));

    private static UsernamePasswordAuthenticationToken user(long seq, boolean superAdmin) {
        return new UsernamePasswordAuthenticationToken(seq, null,
            superAdmin ? List.of(new SimpleGrantedAuthority("ROLE_SUPER_ADMIN")) : List.of());
    }

    @Test
    void controllerRejectsMembersWithoutTheRole() {
        var error = assertThrows(ResponseStatusException.class, () -> AdminController.requireAdmin(user(7, false)));
        assertEquals(HttpStatus.FORBIDDEN, error.getStatusCode());
        assertThrows(ResponseStatusException.class, () -> AdminController.requireAdmin(null));
        assertEquals(7L, AdminController.requireAdmin(user(7, true)));
    }

    @Test
    void everyAdminEndpointChecksTheRoleItself() throws Exception {
        // 第二道防線：AdminController 每個 HTTP 方法第一行都呼叫 requireAdmin
        String source = java.nio.file.Files.readString(
            java.nio.file.Path.of("src/main/java/com/expensetracker/AdminController.java"));
        var methods = java.util.regex.Pattern.compile("@(Get|Put|Post|Delete)Mapping[^\\n]*\\n\\s+[^{]+\\{\\n\\s+(.*)")
            .matcher(source);
        int count = 0;
        while (methods.find()) {
            count++;
            assertTrue(methods.group(2).contains("requireAdmin(auth)"), "缺少權限檢查：" + methods.group(0));
        }
        assertTrue(count >= 10, "應檢查到所有管理 API：" + count);
    }

    @Test
    void reasonIsRequired() {
        assertThrows(ResponseStatusException.class, () -> AdminService.requireReason(null));
        assertThrows(ResponseStatusException.class, () -> AdminService.requireReason("短"));
        assertThrows(ResponseStatusException.class, () -> AdminService.requireReason("x".repeat(501)));
        assertEquals("會員要求停用帳號", AdminService.requireReason("  會員要求停用帳號 "));
    }

    @Test
    void cannotDisableYourselfAndTheFailureIsAudited() {
        when(db.queryForList(anyString(), eq(String.class), eq(7L))).thenReturn(List.of("admin@example.com"));
        var error = assertThrows(ResponseStatusException.class,
            () -> admin.setStatus(7, 7, false, "測試停用自己", "Admin#Pass1"));
        assertEquals(HttpStatus.BAD_REQUEST, error.getStatusCode());
        verify(db, never()).update(startsWith("UPDATE user_info SET account_status"), any(Object[].class));
        verify(db).update(startsWith("INSERT INTO admin_audit_log"), eq(7L), eq(7L), eq("DISABLE_USER"),
            eq("測試停用自己"), eq("FAILURE"), anyString(), any());
    }

    @Test
    void protectsTheLastSuperAdmin() {
        when(db.queryForList(anyString(), eq(String.class), eq(9L))).thenReturn(List.of("owner@example.com"));
        when(auth.isLastSuperAdmin(9L)).thenReturn(true);
        assertThrows(ResponseStatusException.class, () -> admin.setSuperAdmin(7, 9, false, "移除管理員權限", "Admin#Pass1"));
        assertThrows(ResponseStatusException.class, () -> admin.setStatus(7, 9, false, "停用管理員帳號", "Admin#Pass1"));
        assertThrows(ResponseStatusException.class,
            () -> admin.deleteUser(7, 9, "刪除管理員帳號", "Admin#Pass1", "owner@example.com"));
        verify(auth, never()).deleteAccountData(9L);
        verify(db, never()).update(startsWith("DELETE FROM user_role"), any(Object[].class));
    }

    @Test
    void deleteRequiresPasswordAndTheMemberEmail() {
        when(db.queryForList(anyString(), eq(String.class), eq(12L))).thenReturn(List.of("member@example.com"));
        assertThrows(ResponseStatusException.class,
            () -> admin.deleteUser(7, 12, "會員要求刪除帳號", "Admin#Pass1", "other@example.com"));
        verify(auth, never()).deleteAccountData(12L);

        doThrow(new ResponseStatusException(HttpStatus.BAD_REQUEST, "目前密碼不正確"))
            .when(auth).reauthenticate(7L, "wrong");
        assertThrows(ResponseStatusException.class,
            () -> admin.deleteUser(7, 12, "會員要求刪除帳號", "wrong", "member@example.com"));
        verify(auth, never()).deleteAccountData(12L);

        admin.deleteUser(7, 12, "會員要求刪除帳號", "Admin#Pass1", " Member@Example.com ");
        verify(auth).deleteAccountData(12L);
        verify(db).update(startsWith("INSERT INTO admin_audit_log"), eq(7L), eq(12L), eq("DELETE_USER"),
            eq("會員要求刪除帳號"), eq("SUCCESS"), anyString(), any());
    }

    @Test
    void disablingRevokesAllSessions() {
        when(db.queryForList(anyString(), eq(String.class), eq(12L))).thenReturn(List.of("member@example.com"));
        admin.setStatus(7, 12, false, "違反使用規範", "Admin#Pass1");
        verify(auth).reauthenticate(7L, "Admin#Pass1");
        verify(db).update(startsWith("UPDATE user_info SET account_status"), eq("DISABLED"), eq(12L));
        verify(db).update(startsWith("UPDATE auth_session SET revoked_at"), eq(12L));
    }

    @Test
    void eventDetailsKeepOnlySafeValues() {
        var safe = ActivityLog.sanitize(Map.of(
            "count", 3,
            "ok", true,
            "goal", "SECOND",
            "email", "someone@example.com",
            "note", "x".repeat(41),
            "nested", Map.of("password", "secret"),
            "bad key", 1));
        assertEquals(Map.of("count", 3, "ok", true, "goal", "SECOND"), safe);
        var many = new java.util.HashMap<String, Object>();
        for (int i = 0; i < 20; i++) many.put("k" + i, i);
        assertEquals(ActivityLog.MAX_DETAIL_ENTRIES, ActivityLog.sanitize(many).size());
    }

    @Test
    void clientEventsAcceptOnlyAllowlistedTypes() {
        var activity = mock(ActivityLog.class);
        var controller = new ClientEventController(activity);
        var member = user(7, false);
        assertThrows(ResponseStatusException.class, () -> controller.record(member, Map.of("type", "ACCOUNT_DELETED")));
        controller.record(member, Map.of("type", "PAYSLIP_IMPORT_FAILED", "status", "FAILURE", "errorCode", "PASSWORD_REQUIRED"));
        verify(activity).record(eq(7L), eq("PAYSLIP"), eq("PAYSLIP_IMPORT_FAILED"), eq(false), eq("PASSWORD_REQUIRED"),
            argThat(Map::isEmpty));
        for (int i = 1; i < ClientEventController.MAX_PER_HOUR; i++)
            controller.record(member, Map.of("type", "FILL_MONTH_COMPLETED"));
        var limited = assertThrows(ResponseStatusException.class,
            () -> controller.record(member, Map.of("type", "FILL_MONTH_COMPLETED")));
        assertEquals(HttpStatus.TOO_MANY_REQUESTS, limited.getStatusCode());
    }

    @Test
    void requestIdsAreSafeAndErrorCodesReadable() {
        assertEquals("abc12345-ok", RequestTimingFilter.requestId("abc12345-ok"));
        String generated = RequestTimingFilter.requestId("<script>");
        assertNotEquals("<script>", generated);
        assertTrue(generated.matches("[a-f0-9-]{8,40}"));
        assertEquals("DATA_ACCESS_RESOURCE_FAILURE_EXCEPTION", ApiErrorHandler.errorCode(
            new org.springframework.dao.DataAccessResourceFailureException("db down")));
        assertFalse(ApiErrorHandler.errorCode(new IllegalStateException("x")).contains(" "));
    }
}
