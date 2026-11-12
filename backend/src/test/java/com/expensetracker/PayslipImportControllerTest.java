package com.expensetracker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class PayslipImportControllerTest {
    @Test
    void acceptsOnlySha256Fingerprints() {
        String sha = "a".repeat(64);
        assertEquals(sha, PayslipImportController.fingerprint(sha));
        assertNull(PayslipImportController.fingerprint(null));
        assertThrows(ResponseStatusException.class, () -> PayslipImportController.fingerprint("../etc/passwd"));
    }

    @Test
    void validatesOptionalCentsAndText() {
        assertNull(PayslipImportController.optionalCents(Map.of(), "grossCents"));
        assertEquals(164639L, PayslipImportController.optionalCents(Map.of("grossCents", 164639), "grossCents"));
        assertThrows(ResponseStatusException.class,
            () -> PayslipImportController.optionalCents(Map.of("taxCents", -1), "taxCents"));
        assertNull(PayslipImportController.shortText("  ", 10));
        assertThrows(ResponseStatusException.class, () -> PayslipImportController.shortText("x".repeat(21), 20));
    }

    @Test
    void rejectsInvalidWorkProfiles() {
        assertThrows(ResponseStatusException.class, () -> WorkProfileController.validate(Map.of(), "{}"));
        assertThrows(ResponseStatusException.class,
            () -> WorkProfileController.validate(Map.of("payStatus", "ADMIN"), "{\"payStatus\":\"ADMIN\"}"));
        assertThrows(ResponseStatusException.class,
            () -> WorkProfileController.validate(Map.of("x", 1), "x".repeat(20_001)));
        assertEquals("{}", WorkProfileController.validate(Map.of("payStatus", "MANUAL_CONFIRMED"), "{}"));
    }
}
