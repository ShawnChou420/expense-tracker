package com.expensetracker;

import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 每週特價同步排程：預設每週三 07:00（Australia/Sydney），從 SPECIALS_FEED_URL 拉取 CSV 資料源。
 * 沒設定資料源時直接跳過（不寫紀錄）。取得資料或寫入失敗時，每隔 retry-minutes 重試，最多 max-attempts 次。
 *
 * <p>後端服務若可能休眠，也可以用外部排程呼叫受保護端點 POST /api/internal/supermarkets/sync
 * （見 {@link SpecialsSyncTriggerController}）；重複觸發由 {@link SpecialsSyncService} 擋下。
 */
@Component
class SpecialsSyncJob {
    private static final Logger log = LoggerFactory.getLogger(SpecialsSyncJob.class);

    private final SpecialsSyncService sync;
    private final CsvFeedSpecialsCollector feed;
    private final TaskScheduler scheduler;
    private final String region;
    private final int maxAttempts;
    private final Duration retryDelay;

    SpecialsSyncJob(SpecialsSyncService sync, CsvFeedSpecialsCollector feed, TaskScheduler scheduler,
                    @Value("${app.specials.region:NSW}") String region,
                    @Value("${app.specials.max-attempts:3}") int maxAttempts,
                    @Value("${app.specials.retry-minutes:30}") int retryMinutes) {
        this.sync = sync;
        this.feed = feed;
        this.scheduler = scheduler;
        this.region = SupermarketService.region(region);
        this.maxAttempts = Math.max(1, maxAttempts);
        this.retryDelay = Duration.ofMinutes(Math.max(1, retryMinutes));
    }

    boolean configured() {
        return feed.configured();
    }

    @Scheduled(cron = "${app.specials.cron:0 0 7 * * WED}", zone = "Australia/Sydney")
    void weekly() {
        run("SCHEDULED", 1);
    }

    /**
     * 從資料源同步一次；失敗且可重試時排定下一次。手動觸發傳 retry=false，結果直接回給管理員。
     */
    Map<String, Object> run(String trigger, int attempt) {
        return run(trigger, attempt, true);
    }

    Map<String, Object> run(String trigger, int attempt, boolean retry) {
        if (!feed.configured()) {
            log.info("specials sync skipped: SPECIALS_FEED_URL not configured");
            Map<String, Object> skipped = new LinkedHashMap<>();
            skipped.put("status", "SKIPPED");
            skipped.put("message", "尚未設定特價資料源（SPECIALS_FEED_URL），請改用 CSV 上傳");
            return skipped;
        }
        Map<String, Object> result;
        try {
            result = sync.sync(feed, new SpecialsSyncService.Options(trigger, region, false, feed.sourceName(), null));
        } catch (SpecialsSyncService.Busy busy) {
            log.info("specials sync skipped: another sync is running");
            throw busy;
        }
        log.info("specials sync {} attempt {}: {}", trigger, attempt, result.get("status"));
        if (retry && "FAILED".equals(result.get("status")) && Boolean.TRUE.equals(result.get("retryable"))
            && attempt < maxAttempts) {
            Instant next = Instant.now().plus(retryDelay);
            scheduler.schedule(() -> {
                try {
                    run(trigger, attempt + 1, true);
                } catch (RuntimeException exception) {
                    log.warn("specials sync retry failed: {}", exception.getClass().getSimpleName());
                }
            }, next);
            result = new LinkedHashMap<>(result);
            result.put("nextRetryAt", next.toString());
        }
        return result;
    }
}
