package com.expensetracker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.time.Clock;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.transaction.support.TransactionOperations;

class SpecialsSyncServiceTest {
    private final JdbcTemplate db = mock(JdbcTemplate.class);
    private final SpecialsSyncService service =
        new SpecialsSyncService(db, TransactionOperations.withoutTransaction(), Clock.systemUTC());
    static final String CSV = WoolworthsProductNormalizerTest.HEADER
        + "1,Tim Tam,,200g,Biscuits,5,2.5,,HALF_PRICE,2026-11-26,2026-12-02,\n"
        + "2,Milk,,2L,Dairy,4,3.1,,,2026-11-26,2026-12-02,\n"
        + "3,Bad,,,,,abc,,,2026-11-26,2026-12-02,\n";

    private static SpecialsSyncService.Options options(boolean dryRun) {
        return new SpecialsSyncService.Options("MANUAL", "NSW", dryRun, "catalogue", 1L);
    }

    @SuppressWarnings("unchecked")
    private void runStarts(long runSeq) {
        when(db.query(contains("INSERT INTO supermarket_import_run"), any(RowMapper.class), any(Object[].class)))
            .thenReturn(List.of(runSeq));
    }

    @Test
    void dryRunNeverWrites() {
        var result = service.sync(new CsvSpecialsCollector(CSV, "CSV", "upload"), options(true));
        assertEquals(2, result.get("validCount"));
        assertEquals(1, result.get("errorCount"));
        verifyNoInteractions(db);
    }

    @Test
    void countsInsertedAndUpdatedAndMarksPartial() {
        runStarts(11L);
        when(db.queryForObject(contains("pg_try_advisory_xact_lock"), eq(Boolean.class), any(Object[].class)))
            .thenReturn(true);
        when(db.queryForObject(contains("INSERT INTO supermarket_product"), eq(Long.class), any(Object[].class)))
            .thenReturn(3L);
        when(db.queryForObject(contains("INSERT INTO supermarket_promotion"), eq(Boolean.class), any(Object[].class)))
            .thenReturn(true, false);
        var result = service.sync(new CsvSpecialsCollector(CSV, "CSV", "upload"), options(false));
        assertEquals("PARTIAL", result.get("status"));
        assertEquals(1, result.get("insertedCount"));
        assertEquals(1, result.get("updatedCount"));
        verify(db).update(contains("UPDATE supermarket_import_run"), eq("PARTIAL"), eq(3), eq(2), eq(1), eq(1), eq(1),
            anyString(), eq(11L));
    }

    @Test
    @SuppressWarnings("unchecked")
    void refusesWhenAnotherRunIsUnfinished() {
        when(db.query(contains("INSERT INTO supermarket_import_run"), any(RowMapper.class), any(Object[].class)))
            .thenReturn(List.of());
        assertThrows(SpecialsSyncService.Busy.class,
            () -> service.sync(new CsvSpecialsCollector(CSV, "CSV", "upload"), options(false)));
        verify(db, never()).queryForObject(contains("INSERT INTO supermarket_product"), eq(Long.class), any(Object[].class));
    }

    @Test
    void collectorFailureIsLoggedAsRetryableAndTouchesNoData() {
        runStarts(12L);
        WoolworthsSpecialsCollector broken = () -> {
            throw new IOException("資料源回應 HTTP 503");
        };
        var result = service.sync(broken, options(false));
        assertEquals("FAILED", result.get("status"));
        assertEquals(true, result.get("retryable"));
        verify(db).update(contains("UPDATE supermarket_import_run"), eq("FAILED"), eq(0), eq(0), eq(0), eq(0), eq(0),
            eq("取得資料失敗：資料源回應 HTTP 503"), eq(12L));
        verify(db, never()).update(contains("DELETE"), any(Object[].class));
    }

    @Test
    void writeFailureRollsBackWholeBatchAndKeepsHistory() {
        runStarts(13L);
        when(db.queryForObject(contains("pg_try_advisory_xact_lock"), eq(Boolean.class), any(Object[].class)))
            .thenReturn(true);
        when(db.queryForObject(contains("INSERT INTO supermarket_product"), eq(Long.class), any(Object[].class)))
            .thenThrow(new org.springframework.dao.DataIntegrityViolationException("boom"));
        var result = service.sync(new CsvSpecialsCollector(CSV, "CSV", "upload"), options(false));
        assertEquals("FAILED", result.get("status"));
        assertEquals(true, result.get("retryable"));
        verify(db, never()).update(contains("DELETE"), any(Object[].class));
    }

    @Test
    void dataWithNoValidRowsFailsWithoutRetry() {
        runStarts(14L);
        var result = service.sync(new CsvSpecialsCollector("name\nx\n", "CSV", "upload"), options(false));
        assertEquals("FAILED", result.get("status"));
        assertEquals(false, result.get("retryable"));
    }

    @Test
    void safeMessageNeverLeaksUrls() {
        assertEquals("IOException", SpecialsSyncService.safeMessage(new IOException("GET https://x/y?key=secret")));
        assertEquals("NullPointerException", SpecialsSyncService.safeMessage(new NullPointerException("x")));
        assertTrue(SpecialsSyncService.safeMessage(new IOException("timeout")).equals("timeout"));
    }
}
