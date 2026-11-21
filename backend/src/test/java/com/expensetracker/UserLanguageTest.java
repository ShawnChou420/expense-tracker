package com.expensetracker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.core.Authentication;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/** i18n：會員語言偏好只存支援的語系，只寫自己的資料，且不碰顯示貨幣。 */
class UserLanguageTest {
    private final JdbcTemplate db = mock(JdbcTemplate.class);
    private final FinanceController controller = new FinanceController(db, new ObjectMapper());
    private final Authentication auth = mock(Authentication.class);

    @Test
    void savesSupportedLanguageForOwnerOnly() {
        when(auth.getPrincipal()).thenReturn(7L);
        assertEquals(Map.of("language", "ja"), controller.saveLanguage(auth, Map.of("language", "ja")));
        verify(db).update(argThat((String sql) -> sql.contains("language") && !sql.contains("display_currency")),
            eq(7L), eq("ja"));
    }

    @Test
    void rejectsUnsupportedLanguagesBeforeWriting() {
        for (Object value : List.of("zh-CN", "fr", "", "ZH-TW"))
            assertThrows(ResponseStatusException.class,
                () -> controller.saveLanguage(auth, Map.of("language", value)), String.valueOf(value));
        assertThrows(ResponseStatusException.class, () -> controller.saveLanguage(auth, Map.of()));
        verifyNoInteractions(db);
    }

    @Test
    @SuppressWarnings("unchecked")
    void returnsLanguageOrNullInDashboardSettings() throws Exception {
        when(db.query(anyString(), any(RowMapper.class), eq(7L))).thenAnswer(invocation -> {
            String sql = invocation.getArgument(0);
            if (!sql.contains("user_preferences")) return List.of();
            var rs = mock(java.sql.ResultSet.class);
            when(rs.getString(1)).thenReturn("TWD");
            when(rs.getString(4)).thenReturn("ko");
            return List.of(((RowMapper<Object>) invocation.getArgument(1)).mapRow(rs, 0));
        });
        when(auth.getPrincipal()).thenReturn(7L);
        var result = controller.dashboardSettings(auth);
        assertEquals("ko", result.get("language"));
        assertEquals("TWD", result.get("displayCurrency"));

        when(db.query(anyString(), any(RowMapper.class), eq(8L))).thenReturn(List.of());
        when(auth.getPrincipal()).thenReturn(8L);
        var empty = controller.dashboardSettings(auth);
        assertTrue(empty.containsKey("language"));
        assertNull(empty.get("language"));
    }
}
