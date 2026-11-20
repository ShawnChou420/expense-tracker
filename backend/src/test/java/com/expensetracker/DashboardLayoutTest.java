package com.expensetracker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.core.Authentication;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/** 首頁自訂（UI 2.0 Sprint 2）：驗證、只寫自己的資料、讀回原樣。 */
class DashboardLayoutTest {
    private final JdbcTemplate db = mock(JdbcTemplate.class);
    private final FinanceController controller = new FinanceController(db, new ObjectMapper());
    private final Authentication auth = mock(Authentication.class);

    private static Map<String, Object> module(String id, Object visible) {
        return Map.of("id", id, "visible", visible);
    }

    @Test
    void savesValidatedLayoutForOwnerOnly() {
        when(auth.getPrincipal()).thenReturn(7L);
        var body = Map.<String, Object>of("mode", "LIFE", "modules",
            List.of(module("today-shift", true), module("daily-quote", false)), "extra", "ignored");
        var saved = controller.saveDashboardLayout(auth, body);
        assertEquals("LIFE", saved.get("mode"));
        assertEquals(List.of(module("today-shift", true), module("daily-quote", false)), saved.get("modules"));
        verify(db).update(anyString(), eq(7L),
            eq("{\"mode\":\"LIFE\",\"modules\":[{\"id\":\"today-shift\",\"visible\":true},{\"id\":\"daily-quote\",\"visible\":false}]}"));
    }

    @Test
    void rejectsInvalidLayoutsBeforeWriting() {
        var tooMany = new ArrayList<Object>();
        for (int i = 0; i <= DashboardLayout.MAX_MODULES; i++) tooMany.add(module("m" + i, true));
        List<Map<String, Object>> invalid = List.of(
            Map.of("mode", "OTHER", "modules", List.of()),
            Map.of("modules", List.of()),
            Map.of("mode", "PAY", "modules", "weekly-pay"),
            Map.of("mode", "PAY", "modules", tooMany),
            Map.of("mode", "PAY", "modules", List.of(module("Weekly Pay", true))),
            Map.of("mode", "PAY", "modules", List.of(module("<script>", true))),
            Map.of("mode", "PAY", "modules", List.of(module("weekly-pay", "yes"))),
            Map.of("mode", "PAY", "modules", List.of(module("weekly-pay", true), module("weekly-pay", false))),
            Map.of("mode", "PAY", "modules", List.of("weekly-pay")));
        for (var body : invalid)
            assertThrows(ResponseStatusException.class, () -> controller.saveDashboardLayout(auth, body), body.toString());
        verifyNoInteractions(db);
    }

    @Test
    @SuppressWarnings("unchecked")
    void readsLayoutBackOrNullForDefault() throws Exception {
        when(db.query(anyString(), any(RowMapper.class), eq(7L))).thenAnswer(invocation -> {
            String sql = invocation.getArgument(0);
            if (!sql.contains("user_preferences")) return List.of();
            var rs = mock(java.sql.ResultSet.class);
            when(rs.getString(1)).thenReturn("AUD");
            when(rs.getString(3)).thenReturn("{\"mode\":\"PAY\",\"modules\":[{\"id\":\"weekly-pay\",\"visible\":false}]}");
            return List.of(((RowMapper<Object>) invocation.getArgument(1)).mapRow(rs, 0));
        });
        when(auth.getPrincipal()).thenReturn(7L);
        var result = controller.dashboardSettings(auth);
        assertEquals(Map.of("mode", "PAY", "modules", List.of(module("weekly-pay", false))), result.get("dashboardLayout"));

        when(db.query(anyString(), any(RowMapper.class), eq(8L))).thenReturn(List.of());
        when(auth.getPrincipal()).thenReturn(8L);
        assertNull(controller.dashboardSettings(auth).get("dashboardLayout"));
    }
}
