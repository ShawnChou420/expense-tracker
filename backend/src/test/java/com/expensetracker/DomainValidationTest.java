package com.expensetracker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.math.BigDecimal;
import java.util.Map;
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

    @Test
    void usesPayslipRatesWhenProvidedAndDefaultMultipliersOtherwise() {
        BigDecimal base = new BigDecimal("28.01");
        assertEquals(0, new BigDecimal("21.0075").compareTo(
            FinanceController.derivedRate(Map.of(), "sundayLoadingRate", base, "0.75")));
        assertEquals(0, new BigDecimal("8.5").compareTo(
            FinanceController.derivedRate(Map.of("shiftLoadingRate", "8.5"), "shiftLoadingRate", base, "0.25")));
        assertThrows(ResponseStatusException.class,
            () -> FinanceController.derivedRate(Map.of("doubleRate", "-1"), "doubleRate", base, "2.0"));
    }
}
