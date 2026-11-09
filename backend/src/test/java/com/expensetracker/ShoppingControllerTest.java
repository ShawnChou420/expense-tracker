package com.expensetracker;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.web.server.ResponseStatusException;

class ShoppingControllerTest {
    private final JdbcTemplate db = mock(JdbcTemplate.class);
    private final ShoppingController controller = new ShoppingController(db);
    private final Authentication auth = mock(Authentication.class);

    @Test
    void scopesListToAuthenticatedMember() {
        when(auth.getPrincipal()).thenReturn(7L);
        controller.list(auth);
        verify(db).query(any(String.class), any(org.springframework.jdbc.core.RowMapper.class), eq(7L));
    }

    @Test
    void rejectsInvalidProgressWithoutWriting() {
        assertThrows(ResponseStatusException.class, () -> controller.save(auth, "milk", Map.of(
            "id", "milk", "name", "Milk", "unit", "bottle", "quantity", 1,
            "purchasedQuantity", 2, "priority", "HIGH", "bucket", "NOW", "store", "ANY")));
        verifyNoInteractions(db);
    }

    @Test
    void rejectsPathIdMismatchWithoutWriting() {
        assertThrows(ResponseStatusException.class, () -> controller.save(auth, "milk", Map.of("id", "other")));
        verifyNoInteractions(db);
    }
}
