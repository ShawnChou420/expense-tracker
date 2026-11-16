package com.expensetracker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/** 集簽設定、禁休公告與批次班表：輸入驗證、只寫入驗證身分的會員。 */
class VisaJourneyTest {
    private final JdbcTemplate db = mock(JdbcTemplate.class);
    private final Authentication auth = mock(Authentication.class);

    private static Map<String, Object> journey(Map<String, Object> overrides) {
        Map<String, Object> body = new HashMap<>(Map.of(
            "goal", "SECOND", "subclass", "417", "stage", "FIRST",
            "stayUntil", "2027-06-30", "workStart", "2026-08-03", "started", true));
        body.putAll(overrides);
        return body;
    }

    @Test
    void notTrackingNeedsOnlyTheGoal() {
        var result = VisaJourneyController.validate(Map.of("goal", "NONE"));
        assertEquals("NONE", result.goal());
        assertNull(result.subclass());
        assertNull(result.stayUntil());
    }

    @Test
    void trackingRequiresTheEssentialFieldsOnly() {
        var second = VisaJourneyController.validate(journey(Map.of()));
        assertEquals(LocalDate.parse("2026-08-03"), second.workStart());
        assertTrue(second.started());
        var third = VisaJourneyController.validate(journey(Map.of("goal", "THIRD", "subclass", "462", "stage", "SECOND")));
        assertEquals("THIRD", third.goal());

        var missing = new HashMap<>(journey(Map.of()));
        missing.remove("stayUntil");
        assertThrows(ResponseStatusException.class, () -> VisaJourneyController.validate(missing));
        assertThrows(ResponseStatusException.class,
            () -> VisaJourneyController.validate(journey(Map.of("subclass", "500"))));
        assertThrows(ResponseStatusException.class,
            () -> VisaJourneyController.validate(journey(Map.of("workStart", "2027-08-01"))));
        assertThrows(ResponseStatusException.class,
            () -> VisaJourneyController.validate(journey(Map.of("stayUntil", "2027-02-30"))));
        assertThrows(ResponseStatusException.class, () -> VisaJourneyController.validate(Map.of("goal", "FOURTH")));
    }

    @Test
    void savesForAuthenticatedMemberOnly() {
        when(auth.getPrincipal()).thenReturn(7L);
        new VisaJourneyController(db).save(auth, journey(Map.of("userSeq", 99)));
        verify(db).update(anyString(), eq(7L), eq("SECOND"), eq("417"), eq("FIRST"),
            eq(LocalDate.parse("2027-06-30")), eq(LocalDate.parse("2026-08-03")), eq(true), eq(false));
    }

    @Test
    void blackoutNoticeValidatesPeriodAndLength() {
        var controller = new BlackoutNoticeController(db);
        when(auth.getPrincipal()).thenReturn(7L);
        assertThrows(ResponseStatusException.class, () -> controller.save(auth, "n1",
            Map.of("startDate", "2026-12-20", "endDate", "2026-12-01")));
        assertThrows(ResponseStatusException.class, () -> controller.save(auth, "n1",
            Map.of("startDate", "2026-12-20", "endDate", "2026-12-21", "body", "x".repeat(5001))));
        assertThrows(ResponseStatusException.class, () -> controller.save(auth, "../n1",
            Map.of("startDate", "2026-12-20", "endDate", "2026-12-21")));
        verifyNoInteractions(db);

        var saved = controller.save(auth, "n1", Map.of("startDate", "2026-12-20", "endDate", "2027-01-05",
            "title", " 旺季禁休 ", "body", "第一行\r\n第二行"));
        assertEquals("旺季禁休", saved.get("title"));
        assertEquals("第一行\n第二行", saved.get("body"));
        verify(db).update(anyString(), eq(7L), eq("n1"), eq(LocalDate.parse("2026-12-20")),
            eq(LocalDate.parse("2027-01-05")), eq("旺季禁休"), eq("第一行\n第二行"));
    }

    @Test
    void workRecordRejectsUnknownLeaveTypeOrSource() {
        LedgerController.validateRecordMeta(Map.of("leaveType", "HOLIDAY", "leavePaid", true,
            "source", "HISTORICAL_USER_CONFIRMED"));
        assertThrows(ResponseStatusException.class,
            () -> LedgerController.validateRecordMeta(Map.of("leaveType", "VACATION")));
        assertThrows(ResponseStatusException.class,
            () -> LedgerController.validateRecordMeta(Map.of("source", "HOME_AFFAIRS_VERIFIED")));
        assertThrows(ResponseStatusException.class,
            () -> LedgerController.validateRecordMeta(Map.of("leavePaid", "yes")));
    }

    @Test
    void batchRejectsEmptyOversizedOrDuplicateIdsBeforeWriting() {
        var controller = new LedgerController(db, new ObjectMapper());
        when(auth.getPrincipal()).thenReturn(7L);
        assertThrows(ResponseStatusException.class, () -> controller.saveWorkRecords(auth, List.of()));
        assertThrows(ResponseStatusException.class, () -> controller.saveWorkRecords(auth,
            java.util.Collections.nCopies(LedgerController.MAX_BATCH + 1, Map.of("id", 1))));
        assertThrows(ResponseStatusException.class, () -> controller.saveWorkRecords(auth,
            List.of(Map.of("id", 1), Map.of("id", 1))));
        verifyNoInteractions(db);
    }
}
