package com.expensetracker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.support.TransactionOperations;
import org.springframework.web.server.ResponseStatusException;

class SupermarketServiceTest {
    private final JdbcTemplate db = mock(JdbcTemplate.class);
    // 2026-11-25 13:30 UTC = 2026-11-26 00:30 Sydney（夏令時間 +11）
    private final Clock clock = Clock.fixed(Instant.parse("2026-11-25T13:30:00Z"), ZoneOffset.UTC);
    private final SupermarketService service = new SupermarketService(db, TransactionOperations.withoutTransaction(), clock);
    static final String CSV = SupermarketCsvTest.HEADER
        + "1,Tim Tam,,200g,Biscuits,5,2.5,,HALF_PRICE,2026-11-26,2026-12-02,\n"
        + "2,Bad,,,,,abc,,,2026-11-26,2026-12-02,\n";

    @Test
    void todayUsesSydneyDate() {
        assertEquals(LocalDate.of(2026, 11, 26), service.today());
    }

    @Test
    @SuppressWarnings("unchecked")
    void searchFiltersCurrentPromotionsInRegionWithHalfPriceAndEscapedKeyword() {
        when(db.query(anyString(), any(RowMapper.class), any(Object[].class))).thenReturn(List.of());
        var result = service.search(SupermarketService.Query.of("50%_off", "Biscuits", true, 0, 20, "ending", null));
        verify(db).query(contains("AND half_price"), any(RowMapper.class),
            eq("NSW"), eq(LocalDate.of(2026, 11, 26)), eq(LocalDate.of(2026, 11, 26)),
            eq("%50\\%\\_off%"), eq("%50\\%\\_off%"), eq("Biscuits"), eq(20), eq(0));
        assertEquals(0L, ((Number) result.get("total")).longValue());
        assertEquals("2026-11-26", result.get("today"));
    }

    @Test
    void queryValidatesInput() {
        assertThrows(ResponseStatusException.class, () -> SupermarketService.Query.of(null, null, null, 0, 20, "evil;", null));
        assertThrows(ResponseStatusException.class, () -> SupermarketService.Query.of(null, null, null, 0, 20, null, "nsw; drop"));
        assertEquals(50, SupermarketService.Query.of(null, null, null, 0, 500, null, null).size());
        assertEquals("NSW-2000", SupermarketService.region("nsw-2000"));
    }

    @Test
    void dryRunNeverWrites() {
        var result = service.importCsv(CSV, "NSW", true, null, 1L);
        assertEquals(1, result.get("validCount"));
        assertEquals(1, result.get("errorCount"));
        verifyNoInteractions(db);
    }

    @Test
    void importRecordsPartialRunAndUpsertsValidRows() {
        when(db.queryForObject(contains("INSERT INTO supermarket_import_run"), eq(Long.class), any(Object[].class)))
            .thenReturn(11L);
        when(db.queryForObject(contains("INSERT INTO supermarket_product"), eq(Long.class), any(Object[].class)))
            .thenReturn(3L);
        var result = service.importCsv(CSV, "NSW", false, "catalogue 2026-11-26", 1L);
        assertEquals("PARTIAL", result.get("status"));
        assertEquals(1, result.get("importedCount"));
        verify(db).update(contains("INSERT INTO supermarket_promotion"), any(Object[].class));
        verify(db).update(contains("UPDATE supermarket_import_run"), eq("PARTIAL"), eq(1), anyString(), eq(11L));
    }

    @Test
    void failedWriteMarksRunFailedAndKeepsHistory() {
        when(db.queryForObject(contains("INSERT INTO supermarket_import_run"), eq(Long.class), any(Object[].class)))
            .thenReturn(11L);
        when(db.queryForObject(contains("INSERT INTO supermarket_product"), eq(Long.class), any(Object[].class)))
            .thenThrow(new org.springframework.dao.DataIntegrityViolationException("boom"));
        var result = service.importCsv(CSV, "NSW", false, null, 1L);
        assertEquals("FAILED", result.get("status"));
        assertEquals(0, result.get("importedCount"));
        verify(db).update(contains("UPDATE supermarket_import_run"), eq("FAILED"), eq(0), anyString(), eq(11L));
        verify(db, org.mockito.Mockito.never()).update(contains("DELETE"), any(Object[].class));
    }

    @Test
    void importEndpointRequiresSuperAdminAndDefaultsToDryRun() {
        var controller = new SupermarketController(mock(SupermarketService.class));
        Authentication member = mock(Authentication.class);
        when(member.getPrincipal()).thenReturn(7L);
        assertThrows(ResponseStatusException.class, () -> controller.importCsv(member, Map.of("csv", CSV)));
        assertTrue(SupermarketService.HALF_PRICE_SQL.contains("sale_price_cents * 2 <= p.regular_price_cents + 1"));
    }
}
