package com.expensetracker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.web.server.ResponseStatusException;

class SpecialsSyncJobTest {
    private final SpecialsSyncService sync = mock(SpecialsSyncService.class);
    private final CsvFeedSpecialsCollector feed = mock(CsvFeedSpecialsCollector.class);
    private final TaskScheduler scheduler = mock(TaskScheduler.class);
    private final SpecialsSyncJob job = new SpecialsSyncJob(sync, feed, scheduler, "NSW", 3, 30);

    @Test
    void skipsWhenNoFeedConfigured() {
        when(feed.configured()).thenReturn(false);
        assertEquals("SKIPPED", job.run("SCHEDULED", 1).get("status"));
        verifyNoInteractions(sync, scheduler);
    }

    @Test
    void schedulesRetryForRetryableFailureUntilMaxAttempts() {
        when(feed.configured()).thenReturn(true);
        when(sync.sync(eq(feed), any())).thenReturn(Map.of("status", "FAILED", "retryable", true));
        var result = job.run("SCHEDULED", 1);
        verify(scheduler).schedule(any(Runnable.class), any(Instant.class));
        assertEquals(true, result.containsKey("nextRetryAt"));
    }

    @Test
    void noRetryOnLastAttemptManualRunOrDataError() {
        when(feed.configured()).thenReturn(true);
        when(sync.sync(eq(feed), any())).thenReturn(Map.of("status", "FAILED", "retryable", true));
        job.run("SCHEDULED", 3);
        job.run("MANUAL", 1, false);
        when(sync.sync(eq(feed), any())).thenReturn(Map.of("status", "FAILED", "retryable", false));
        job.run("SCHEDULED", 1);
        verify(scheduler, never()).schedule(any(Runnable.class), any(Instant.class));
    }

    @Test
    void triggerEndpointNeedsConfiguredAndMatchingToken() {
        when(feed.configured()).thenReturn(true);
        when(sync.sync(eq(feed), any())).thenReturn(Map.of("status", "SUCCESS"));
        var disabled = new SpecialsSyncTriggerController(job, "");
        assertEquals(HttpStatus.NOT_FOUND,
            assertThrows(ResponseStatusException.class, () -> disabled.trigger("anything")).getStatusCode());
        var controller = new SpecialsSyncTriggerController(job, "a-long-random-sync-token-123456");
        assertEquals(HttpStatus.FORBIDDEN,
            assertThrows(ResponseStatusException.class, () -> controller.trigger("wrong")).getStatusCode());
        assertEquals(HttpStatus.FORBIDDEN,
            assertThrows(ResponseStatusException.class, () -> controller.trigger(null)).getStatusCode());
        verifyNoInteractions(sync);
        assertEquals("SUCCESS", controller.trigger("a-long-random-sync-token-123456").get("status"));
    }
}
