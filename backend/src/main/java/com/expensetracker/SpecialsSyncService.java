package com.expensetracker;

import java.io.IOException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionOperations;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

/**
 * 特價同步：供應者（Collector）→ 正規化（Normalizer）→ upsert 進資料庫，並寫同步紀錄（supermarket_import_run）。
 *
 * <ul>
 *   <li>同一商品以 (supermarket_code, external_product_id) 去重；同一商品同一地區同一期開始日只有一筆特價，
 *       重新同步時更新價格；不同期另存一筆，保留價格歷史。</li>
 *   <li>失敗時整批回滾、紀錄標成 FAILED，不刪除任何既有資料（採買清單的價格快照也不受影響）。</li>
 *   <li>避免重複執行：程序內旗標 ＋ 資料庫「30 分鐘內未結束的同步」檢查 ＋ 交易層級 advisory lock，
 *       部署交接時兩個 instance 同時觸發也不會重複寫入。</li>
 * </ul>
 */
@Service
class SpecialsSyncService {
    static final long LOCK_KEY = 0x5350_4543_4941_4CL; // "SPECIAL"
    static final Duration STALE_AFTER = Duration.ofDays(8);

    private final JdbcTemplate db;
    private final TransactionOperations tx;
    private final Clock clock;
    private final AtomicBoolean running = new AtomicBoolean(false);

    @Autowired
    SpecialsSyncService(JdbcTemplate db, TransactionTemplate tx) {
        this(db, tx, Clock.systemUTC());
    }

    SpecialsSyncService(JdbcTemplate db, TransactionOperations tx, Clock clock) {
        this.db = db;
        this.tx = tx;
        this.clock = clock;
    }

    /** 觸發方式：MANUAL（管理員）、SCHEDULED（排程）、EXTERNAL（外部排程呼叫受保護端點） */
    record Options(String trigger, String regionCode, boolean dryRun, String sourceReference, Long adminSeq) {}

    static final class Busy extends ResponseStatusException {
        Busy() {
            super(HttpStatus.CONFLICT, "另一個特價同步正在進行，請稍後再試");
        }
    }

    private static final class WriteFailed extends RuntimeException {
        WriteFailed(RuntimeException cause) {
            super(cause);
        }
    }

    Map<String, Object> sync(WoolworthsSpecialsCollector collector, Options options) {
        String region = SupermarketService.region(options.regionCode());
        String reference = options.sourceReference() == null || options.sourceReference().isBlank() ? null
            : options.sourceReference().trim().substring(0, Math.min(200, options.sourceReference().trim().length()));
        if (options.dryRun()) return preview(collector, region);
        if (!running.compareAndSet(false, true)) throw new Busy();
        try {
            return run(collector, options.trigger(), region, reference, options.adminSeq());
        } finally {
            running.set(false);
        }
    }

    private Map<String, Object> preview(WoolworthsSpecialsCollector collector, String region) {
        WoolworthsSpecialsCollector.Collected collected;
        try {
            collected = collector.collect();
        } catch (Exception exception) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "取得資料失敗：" + safeMessage(exception));
        }
        var normalized = WoolworthsProductNormalizer.normalize(collected.records());
        Map<String, Object> result = base(true, region, collected, normalized);
        result.put("preview", normalized.specials().stream().limit(20).map(special -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("productId", special.externalProductId());
            row.put("name", special.name());
            row.put("salePriceCents", special.salePriceCents());
            row.put("regularPriceCents", special.regularPriceCents());
            row.put("discountPercent", special.discountPercent());
            row.put("promotionEnd", special.promotionEnd().toString());
            return row;
        }).toList());
        return result;
    }

    private Map<String, Object> run(WoolworthsSpecialsCollector collector, String trigger, String region,
                                    String reference, Long adminSeq) {
        String sourceType = collector instanceof CsvFeedSpecialsCollector ? "FEED" : "CSV";
        List<Long> started = db.query("""
            INSERT INTO supermarket_import_run(supermarket_code, region_code, source_type, trigger_type, status,
              source_reference, imported_by)
            SELECT ?, ?, ?, ?, 'FAILED', ?, ?
            WHERE NOT EXISTS (
              SELECT 1 FROM supermarket_import_run
              WHERE finished_at IS NULL AND started_at > now() - interval '30 minutes')
            RETURNING seq
            """, (rs, row) -> rs.getLong(1), SupermarketService.SUPERMARKET, region, sourceType, trigger,
            reference, adminSeq);
        if (started.isEmpty()) throw new Busy();
        long runSeq = started.getFirst();

        WoolworthsSpecialsCollector.Collected collected;
        try {
            collected = collector.collect();
        } catch (Exception exception) {
            String message = "取得資料失敗：" + safeMessage(exception);
            finish(runSeq, "FAILED", 0, 0, 0, 0, message);
            return failure(runSeq, trigger, region, message, true);
        }
        var normalized = WoolworthsProductNormalizer.normalize(collected.records());
        List<String> errors = new java.util.ArrayList<>(collected.errors());
        errors.addAll(normalized.errors());
        String summary = String.join("\n", errors);
        int rowCount = collected.records().size();
        Map<String, Object> result = base(false, region, collected, normalized);
        result.put("runId", runSeq);
        result.put("trigger", trigger);
        if (normalized.specials().isEmpty()) {
            finish(runSeq, "FAILED", rowCount, 0, 0, errors.size(), summary.isEmpty() ? "沒有可匯入的資料" : summary);
            result.put("status", "FAILED");
            result.put("retryable", false);
            return result;
        }
        int[] counts;
        try {
            counts = tx.execute(status -> {
                Boolean locked = db.queryForObject("SELECT pg_try_advisory_xact_lock(?)", Boolean.class, LOCK_KEY);
                if (!Boolean.TRUE.equals(locked)) throw new Busy();
                int inserted = 0;
                int updated = 0;
                for (var special : normalized.specials()) {
                    try {
                        if (upsert(special, region, reference, runSeq)) inserted++;
                        else updated++;
                    } catch (RuntimeException exception) {
                        throw new WriteFailed(exception);
                    }
                }
                return new int[] { inserted, updated };
            });
        } catch (Busy busy) {
            finish(runSeq, "FAILED", rowCount, 0, 0, errors.size(), "另一個特價同步正在進行，這次未寫入");
            throw busy;
        } catch (RuntimeException exception) {
            String message = "寫入資料庫失敗，整批未匯入（既有資料不受影響）" + (summary.isEmpty() ? "" : "\n" + summary);
            finish(runSeq, "FAILED", rowCount, 0, 0, errors.size(), message);
            return failure(runSeq, trigger, region, message, true);
        }
        int inserted = counts == null ? 0 : counts[0];
        int updated = counts == null ? 0 : counts[1];
        String status = errors.isEmpty() ? "SUCCESS" : "PARTIAL";
        finish(runSeq, status, rowCount, inserted, updated, errors.size(), summary.isEmpty() ? null : summary);
        result.put("status", status);
        result.put("importedCount", inserted + updated);
        result.put("insertedCount", inserted);
        result.put("updatedCount", updated);
        result.put("retryable", false);
        return result;
    }

    private static Map<String, Object> base(boolean dryRun, String region, WoolworthsSpecialsCollector.Collected collected,
                                            WoolworthsProductNormalizer.Result normalized) {
        List<String> errors = new java.util.ArrayList<>(collected.errors());
        errors.addAll(normalized.errors());
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("dryRun", dryRun);
        result.put("regionCode", region);
        result.put("sourceType", collected.sourceType());
        result.put("sourceName", collected.sourceName());
        result.put("rowCount", collected.records().size());
        result.put("validCount", normalized.specials().size());
        result.put("errorCount", errors.size());
        result.put("errors", errors.subList(0, Math.min(50, errors.size())));
        return result;
    }

    private static Map<String, Object> failure(long runSeq, String trigger, String region, String message, boolean retryable) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("dryRun", false);
        result.put("runId", runSeq);
        result.put("trigger", trigger);
        result.put("regionCode", region);
        result.put("status", "FAILED");
        result.put("importedCount", 0);
        result.put("errors", List.of(message));
        result.put("errorCount", 1);
        result.put("retryable", retryable);
        return result;
    }

    /** 錯誤訊息只留我們自己寫的說明或例外類型，避免把資料源網址或憑證寫進紀錄 */
    static String safeMessage(Exception exception) {
        String message = exception instanceof IOException || exception instanceof IllegalStateException
            ? exception.getMessage() : null;
        if (message == null || message.isBlank()) message = exception.getClass().getSimpleName();
        if (message.contains("://")) message = exception.getClass().getSimpleName();
        return message.substring(0, Math.min(300, message.length()));
    }

    private void finish(long runSeq, String status, int rowCount, int inserted, int updated, int errorCount, String summary) {
        db.update("""
            UPDATE supermarket_import_run SET status = ?, row_count = ?, imported_count = ?, inserted_count = ?,
              updated_count = ?, error_count = ?, error_summary = ?, finished_at = now()
            WHERE seq = ?
            """, status, rowCount, inserted + updated, inserted, updated, errorCount,
            summary == null ? null : summary.substring(0, Math.min(2000, summary.length())), runSeq);
    }

    /** @return true 表示新增了一期特價，false 表示更新既有那一期 */
    private boolean upsert(WoolworthsProductNormalizer.Special special, String region, String reference, long runSeq) {
        Long productSeq = db.queryForObject("""
            INSERT INTO supermarket_product(supermarket_code, external_product_id, name, brand,
              package_size, category, product_url)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (supermarket_code, external_product_id) DO UPDATE SET
              name = EXCLUDED.name,
              brand = COALESCE(EXCLUDED.brand, supermarket_product.brand),
              package_size = COALESCE(EXCLUDED.package_size, supermarket_product.package_size),
              category = COALESCE(EXCLUDED.category, supermarket_product.category),
              product_url = COALESCE(EXCLUDED.product_url, supermarket_product.product_url),
              updated_at = now()
            RETURNING seq
            """, Long.class, SupermarketService.SUPERMARKET, special.externalProductId(), special.name(),
            special.brand(), special.packageSize(), special.category(), special.productUrl());
        Boolean inserted = db.queryForObject("""
            INSERT INTO supermarket_promotion(product_seq, region_code, regular_price_cents,
              sale_price_cents, unit_price_text, promotion_type, promotion_start, promotion_end,
              source_reference, import_run_seq)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (product_seq, region_code, promotion_start) DO UPDATE SET
              regular_price_cents = EXCLUDED.regular_price_cents,
              sale_price_cents = EXCLUDED.sale_price_cents,
              unit_price_text = EXCLUDED.unit_price_text,
              promotion_type = EXCLUDED.promotion_type,
              promotion_end = EXCLUDED.promotion_end,
              source_reference = EXCLUDED.source_reference,
              import_run_seq = EXCLUDED.import_run_seq,
              fetched_at = now()
            RETURNING (xmax = 0)
            """, Boolean.class, productSeq, region, special.regularPriceCents(), special.salePriceCents(),
            special.unitPriceText(), special.promotionType(), special.promotionStart(), special.promotionEnd(),
            reference, runSeq);
        return Boolean.TRUE.equals(inserted);
    }

    // ---------- 狀態與紀錄 ----------

    /** 公開狀態：最後成功同步時間、目前特價的有效日期範圍、是否可能過期。不含任何設定或憑證 */
    Map<String, Object> status(String regionValue, boolean autoSyncConfigured) {
        String region = SupermarketService.region(regionValue);
        LocalDate today = LocalDate.now(clock.withZone(SupermarketService.SYDNEY));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("supermarket", SupermarketService.SUPERMARKET);
        result.put("regionCode", region);
        result.put("today", today.toString());
        result.put("autoSync", autoSyncConfigured);
        Instant lastSuccess = db.query("""
            SELECT max(finished_at) FROM supermarket_import_run
            WHERE region_code = ? AND status IN ('SUCCESS', 'PARTIAL')
            """, rs -> rs.next() && rs.getTimestamp(1) != null ? rs.getTimestamp(1).toInstant() : null, region);
        result.put("lastSuccessAt", lastSuccess == null ? null : lastSuccess.toString());
        Map<String, Object> lastRun = db.query("""
            SELECT status, trigger_type, started_at, finished_at FROM supermarket_import_run
            WHERE region_code = ? ORDER BY started_at DESC, seq DESC LIMIT 1
            """, rs -> {
                if (!rs.next()) return null;
                Map<String, Object> run = new LinkedHashMap<>();
                boolean finished = rs.getTimestamp("finished_at") != null;
                run.put("status", finished ? rs.getString("status") : "RUNNING");
                run.put("trigger", rs.getString("trigger_type"));
                run.put("startedAt", rs.getTimestamp("started_at").toInstant().toString());
                run.put("finishedAt", finished ? rs.getTimestamp("finished_at").toInstant().toString() : null);
                return run;
            }, region);
        result.put("lastRun", lastRun);
        Map<String, Object> period = db.query("""
            SELECT min(promotion_start), max(promotion_end), count(*) FROM supermarket_promotion
            WHERE region_code = ? AND promotion_start <= ? AND promotion_end >= ?
            """, rs -> {
                rs.next();
                Map<String, Object> range = new LinkedHashMap<>();
                range.put("validFrom", rs.getDate(1) == null ? null : rs.getDate(1).toLocalDate().toString());
                range.put("validTo", rs.getDate(2) == null ? null : rs.getDate(2).toLocalDate().toString());
                range.put("activeCount", rs.getLong(3));
                return range;
            }, region, today, today);
        result.putAll(period);
        boolean lastFailed = lastRun != null && "FAILED".equals(lastRun.get("status"));
        boolean old = lastSuccess == null || lastSuccess.isBefore(Instant.now(clock).minus(STALE_AFTER));
        result.put("stale", old || lastFailed || ((Number) period.get("activeCount")).longValue() == 0);
        return result;
    }

    List<Map<String, Object>> runs() {
        return db.query("""
            SELECT seq, region_code, source_type, trigger_type, status, row_count, imported_count, inserted_count,
              updated_count, error_count, error_summary, source_reference, started_at, finished_at
            FROM supermarket_import_run ORDER BY started_at DESC, seq DESC LIMIT 20
            """, (rs, row) -> {
                Map<String, Object> run = new LinkedHashMap<>();
                boolean finished = rs.getTimestamp("finished_at") != null;
                run.put("id", rs.getLong("seq"));
                run.put("regionCode", rs.getString("region_code"));
                run.put("sourceType", rs.getString("source_type"));
                run.put("trigger", rs.getString("trigger_type"));
                run.put("status", finished ? rs.getString("status") : "RUNNING");
                run.put("rowCount", rs.getInt("row_count"));
                run.put("importedCount", rs.getInt("imported_count"));
                run.put("insertedCount", rs.getInt("inserted_count"));
                run.put("updatedCount", rs.getInt("updated_count"));
                run.put("errorCount", rs.getInt("error_count"));
                run.put("errorSummary", rs.getString("error_summary"));
                run.put("sourceReference", rs.getString("source_reference"));
                run.put("startedAt", rs.getTimestamp("started_at").toInstant().toString());
                run.put("finishedAt", finished ? rs.getTimestamp("finished_at").toInstant().toString() : null);
                return run;
            });
    }
}
