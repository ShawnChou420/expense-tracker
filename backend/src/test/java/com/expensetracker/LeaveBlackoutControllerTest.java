package com.expensetracker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.web.server.ResponseStatusException;

class LeaveBlackoutControllerTest {
    private final JdbcTemplate db = mock(JdbcTemplate.class);
    private final LeaveBlackoutController controller = new LeaveBlackoutController(db);
    private final Authentication auth = mock(Authentication.class);

    @Test
    void rejectsInvalidDatesBeforeWriting() {
        when(auth.getPrincipal()).thenReturn(7L);
        assertThrows(ResponseStatusException.class,
            () -> controller.save(auth, "2026-02-30", Map.of("reason", "忙碌")));
        assertThrows(ResponseStatusException.class,
            () -> controller.delete(auth, "../other"));
        verifyNoInteractions(db);
    }

    @Test
    void rejectsExcessiveReasonBeforeWriting() {
        assertThrows(ResponseStatusException.class,
            () -> controller.save(auth, "2026-10-01", Map.of("reason", "x".repeat(241))));
        verifyNoInteractions(db);
    }

    @Test
    void acceptsOptionalReason() {
        when(auth.getPrincipal()).thenReturn(7L);
        assertEquals(Map.of("date", "2026-10-01", "reason", ""),
            controller.save(auth, "2026-10-01", Map.of()));
    }
}
