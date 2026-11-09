package com.expensetracker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class DomainValidationTest {
    @Test
    void normalizesEmailConsistently() {
        assertEquals("person@example.com", AuthService.normalizeEmail("  Person@Example.COM  "));
    }

    @Test
    void storesOnlyValidIntegerCents() {
        assertEquals(1234, LedgerController.cents(1234, false));
        assertThrows(ResponseStatusException.class, () -> LedgerController.cents("12.5", false));
        assertThrows(ResponseStatusException.class, () -> LedgerController.cents(-1, true));
    }

    @Test
    void rejectsUnsafeClientIds() {
        assertEquals("trip-123", LedgerController.clientId("trip-123"));
        assertThrows(ResponseStatusException.class, () -> LedgerController.clientId("../other"));
    }
}
