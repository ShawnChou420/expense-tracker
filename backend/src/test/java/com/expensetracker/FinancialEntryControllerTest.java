package com.expensetracker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.web.server.ResponseStatusException;

/** 通用手動交易：分類口徑、多幣別換算、無匯率不換算、移轉、訪客合併重送冪等。 */
class FinancialEntryControllerTest {
    private final JdbcTemplate db = mock(JdbcTemplate.class);
    private final FinancialEntryController controller = new FinancialEntryController(db);
    private final Authentication auth = mock(Authentication.class);

    private static Map<String, Object> income(String currency, long amountMinor) {
        Map<String, Object> body = new HashMap<>();
        body.put("id", "fe-1");
        body.put("date", "2026-11-20");
        body.put("type", "INCOME");
        body.put("status", "SETTLED");
        body.put("category", "SECONDHAND_SALE");
        body.put("amountMinor", amountMinor);
        body.put("currency", currency);
        return body;
    }

    @Test
    void audIncomeConvertsOneToOne() {
        var entry = FinancialEntryController.validate("fe-1", income("AUD", 12_345));
        assertEquals(12_345L, entry.convertedAudCents());
        assertEquals("NORMAL", entry.classification());
        assertNull(entry.fxRate());
    }

    @Test
    void foreignWithoutRateIsNotConverted() {
        var entry = FinancialEntryController.validate("fe-1", income("TWD", 150_000));
        assertNull(entry.convertedAudCents());
        assertNull(entry.fxSource());
    }

    @Test
    void foreignWithRateRoundsHalfUpToCents() {
        var body = income("TWD", 150_000); // NT$1,500.00
        body.put("fxRate", "0.0478");
        body.put("fxSource", "MANUAL");
        body.put("fxRateDate", "2026-11-20");
        var entry = FinancialEntryController.validate("fe-1", body);
        assertEquals(7_170L, entry.convertedAudCents()); // 150000 × 0.0478 = 7170
        assertEquals(5L, FinancialEntryController.convert(1, new BigDecimal("4.5")));
        assertEquals(1L, FinancialEntryController.convert(3, new BigDecimal("0.1666666667")));
    }

    @Test
    void classificationFollowsCategory() {
        var gain = income("AUD", 100);
        gain.put("category", "INVESTMENT_GAIN");
        assertEquals("INVESTMENT_PNL", FinancialEntryController.validate("fe-1", gain).classification());
        var refund = income("AUD", 100);
        refund.put("category", "REFUND");
        assertEquals("REFUND", FinancialEntryController.validate("fe-1", refund).classification());
        var mismatch = income("AUD", 100);
        mismatch.put("classification", "NORMAL");
        mismatch.put("category", "INVESTMENT_GAIN");
        assertThrows(ResponseStatusException.class, () -> FinancialEntryController.validate("fe-1", mismatch));
    }

    @Test
    void transferIsItsOwnClassification() {
        var body = income("TWD", 1_000_000);
        body.put("type", "TRANSFER");
        body.put("category", "TRANSFER");
        assertEquals("TRANSFER", FinancialEntryController.validate("fe-1", body).classification());
        body.put("category", "BONUS");
        assertThrows(ResponseStatusException.class, () -> FinancialEntryController.validate("fe-1", body));
    }

    @Test
    void rejectsInvalidInputBeforeWriting() {
        when(auth.getPrincipal()).thenReturn(7L);
        var salary = income("AUD", 100);
        salary.put("category", "SALARY");
        var audExpense = income("AUD", 100);
        audExpense.put("type", "EXPENSE");
        audExpense.put("category", "GROCERIES");
        var loss = income("USD", 100);
        loss.put("type", "EXPENSE");
        loss.put("category", "INVESTMENT_LOSS");
        var yen = income("JPY", 100);
        var zero = income("AUD", 0);
        var badDate = income("AUD", 100);
        badDate.put("date", "2026-02-30");
        var badRate = income("USD", 100);
        badRate.put("fxRate", "-1");
        badRate.put("fxSource", "MANUAL");
        var noSource = income("USD", 100);
        noSource.put("fxRate", "1.5");
        for (var body : java.util.List.of(salary, audExpense, loss, yen, zero, badDate, badRate, noSource))
            assertThrows(ResponseStatusException.class, () -> controller.save(auth, "fe-1", body));
        assertThrows(ResponseStatusException.class, () -> controller.save(auth, "fe-2", income("AUD", 100)));
        assertThrows(ResponseStatusException.class, () -> controller.delete(auth, "../x"));
        verifyNoInteractions(db);
    }

    @Test
    void saveUpsertsByOwnerAndClientId() {
        when(auth.getPrincipal()).thenReturn(7L);
        var saved = controller.save(auth, "fe-1", income("AUD", 500));
        assertEquals(500L, saved.get("convertedAudCents"));
        assertEquals("NORMAL", saved.get("classification"));
        var call = org.mockito.Mockito.mockingDetails(db).getInvocations().iterator().next();
        assertTrue(((String) call.getArgument(0)).contains("ON CONFLICT (user_seq, client_id)"));
        assertEquals(7L, (Long) call.getArgument(2));
        assertEquals("fe-1", (Object) call.getArgument(3));
    }

    @Test
    void migrationAndAccountDeletionCoverTheTable() throws Exception {
        String sql = Files.readString(Path.of("src/main/resources/db/migration/V18__financial_entry.sql"));
        assertTrue(sql.contains("UNIQUE (user_seq, client_id)"));
        assertTrue(AuthService.ACCOUNT_DELETE_STATEMENTS.contains("DELETE FROM financial_entry WHERE user_seq = ?"));
    }
}
