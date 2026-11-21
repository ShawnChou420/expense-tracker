package com.expensetracker;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionOperations;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

/**
 * 超市特價：查詢（公開）與 CSV 匯入（SUPER_ADMIN）。
 *
 * <p>資料來源只有管理員匯入的 CSV，不做自動擷取（Woolworths 網站條款禁止 robot／spider）。
 * 「今天」以 Australia/Sydney 判斷，因為特價期間是依 NSW 當地日期。
 */
@Service
class SupermarketService {
    static final String SUPERMARKET = "WOOLWORTHS";
    static final String DEFAULT_REGION = "NSW";
    static final ZoneId SYDNEY = ZoneId.of("Australia/Sydney");
    static final int MAX_PAGE_SIZE = 50;
    static final List<String> SORTS = List.of("discount", "price", "ending", "name");

    /** 半價：標記為 HALF_PRICE，或特價 × 2 ≤ 原價 + 1 分（容許四捨五入誤差）。與前端 isHalfPrice 一致 */
    static final String HALF_PRICE_SQL =
        "(p.promotion_type = 'HALF_PRICE' OR (p.regular_price_cents IS NOT NULL AND p.sale_price_cents * 2 <= p.regular_price_cents + 1))";

    private final JdbcTemplate db;
    private final TransactionOperations tx;
    private final Clock clock;

    @Autowired
    SupermarketService(JdbcTemplate db, TransactionTemplate tx) {
        this(db, tx, Clock.systemUTC());
    }

    SupermarketService(JdbcTemplate db, TransactionOperations tx, Clock clock) {
        this.db = db;
        this.tx = tx;
        this.clock = clock;
    }

    LocalDate today() {
        return LocalDate.now(clock.withZone(SYDNEY));
    }

    static String region(String value) {
        if (value == null || value.isBlank()) return DEFAULT_REGION;
        String region = value.trim().toUpperCase();
        if (!region.matches("[A-Z]{2,3}(-\\d{4})?"))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "地區代碼格式為 NSW 或 NSW-2000");
        return region;
    }

    record Query(String keyword, String category, boolean halfPriceOnly, int page, int size, String sort, String region) {
        static Query of(String keyword, String category, Boolean halfPriceOnly, Integer page, Integer size,
                        String sort, String region) {
            String k = keyword == null ? null : keyword.trim();
            if (k != null && k.length() > 60) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "關鍵字太長");
            String c = category == null || category.isBlank() ? null : category.trim();
            String s = sort == null || sort.isBlank() ? "discount" : sort;
            if (!SORTS.contains(s)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "無效排序");
            return new Query(k == null || k.isEmpty() ? null : k, c, Boolean.TRUE.equals(halfPriceOnly),
                page == null ? 0 : Math.max(0, Math.min(1000, page)),
                size == null ? 20 : Math.max(1, Math.min(MAX_PAGE_SIZE, size)), s, SupermarketService.region(region));
        }
    }

    static String escapeLike(String value) {
        return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    /** 同一商品同時有多筆有效特價時，只取開始日最新的那一筆 */
    private static final String CURRENT = """
        WITH cur AS (
          SELECT DISTINCT ON (p.product_seq) p.*, sp.external_product_id, sp.name, sp.brand,
            sp.package_size, sp.category, sp.product_url, sp.supermarket_code,
            %s AS half_price,
            CASE WHEN p.regular_price_cents IS NULL THEN NULL
              ELSE (p.regular_price_cents - p.sale_price_cents)::numeric / p.regular_price_cents END AS discount_ratio
          FROM supermarket_promotion p
          JOIN supermarket_product sp ON sp.seq = p.product_seq
          WHERE p.region_code = ? AND p.promotion_start <= ? AND p.promotion_end >= ?
          ORDER BY p.product_seq, p.promotion_start DESC, p.seq DESC
        )
        """.formatted(HALF_PRICE_SQL);

    Map<String, Object> search(Query query) {
        LocalDate today = today();
        List<Object> args = new ArrayList<>(List.of(query.region(), today, today));
        StringBuilder where = new StringBuilder(" WHERE TRUE");
        if (query.keyword() != null) {
            String like = "%" + escapeLike(query.keyword()) + "%";
            where.append(" AND (name ILIKE ? OR brand ILIKE ?)");
            args.add(like);
            args.add(like);
        }
        if (query.category() != null) {
            where.append(" AND category = ?");
            args.add(query.category());
        }
        if (query.halfPriceOnly()) where.append(" AND half_price");
        String order = switch (query.sort()) {
            case "price" -> "sale_price_cents, name";
            case "ending" -> "promotion_end, name";
            case "name" -> "name, seq";
            default -> "discount_ratio DESC NULLS LAST, name";
        };
        args.add(query.size());
        args.add(query.page() * query.size());
        List<Long> total = new ArrayList<>();
        List<Map<String, Object>> items = db.query(CURRENT + "SELECT cur.*, count(*) OVER () AS total FROM cur"
            + where + " ORDER BY " + order + " LIMIT ? OFFSET ?", (rs, row) -> {
                if (total.isEmpty()) total.add(rs.getLong("total"));
                return special(rs, today);
            }, args.toArray());
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("items", items);
        result.put("page", query.page());
        result.put("size", query.size());
        result.put("total", total.isEmpty() ? 0 : total.getFirst());
        result.put("regionCode", query.region());
        result.put("today", today.toString());
        result.put("lastImport", lastImport(query.region()));
        return result;
    }

    Map<String, Object> detail(long promotionSeq) {
        LocalDate today = today();
        List<Map<String, Object>> found = db.query("""
            SELECT p.*, sp.external_product_id, sp.name, sp.brand, sp.package_size, sp.category,
              sp.product_url, sp.supermarket_code, %s AS half_price, NULL::numeric AS discount_ratio
            FROM supermarket_promotion p JOIN supermarket_product sp ON sp.seq = p.product_seq
            WHERE p.seq = ?
            """.formatted(HALF_PRICE_SQL), (rs, row) -> special(rs, today), promotionSeq);
        if (found.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "找不到這筆特價");
        return found.getFirst();
    }

    List<String> categories(String region) {
        LocalDate today = today();
        return db.queryForList("""
            SELECT DISTINCT sp.category FROM supermarket_promotion p
            JOIN supermarket_product sp ON sp.seq = p.product_seq
            WHERE p.region_code = ? AND p.promotion_start <= ? AND p.promotion_end >= ?
              AND sp.category IS NOT NULL
            ORDER BY sp.category
            """, String.class, region(region), today, today);
    }

    private Map<String, Object> lastImport(String region) {
        List<Map<String, Object>> rows = db.query("""
            SELECT status, finished_at, imported_count, error_count FROM supermarket_import_run
            WHERE region_code = ? ORDER BY started_at DESC, seq DESC LIMIT 1
            """, (rs, row) -> {
                Map<String, Object> run = new LinkedHashMap<>();
                run.put("status", rs.getString("status"));
                run.put("finishedAt", rs.getTimestamp("finished_at") == null ? null
                    : rs.getTimestamp("finished_at").toInstant().toString());
                run.put("importedCount", rs.getInt("imported_count"));
                run.put("errorCount", rs.getInt("error_count"));
                return run;
            }, region);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    static Map<String, Object> special(ResultSet rs, LocalDate today) throws SQLException {
        Map<String, Object> item = new LinkedHashMap<>();
        LocalDate start = rs.getDate("promotion_start").toLocalDate();
        LocalDate end = rs.getDate("promotion_end").toLocalDate();
        item.put("id", rs.getLong("seq"));
        item.put("supermarket", rs.getString("supermarket_code"));
        item.put("productId", rs.getString("external_product_id"));
        item.put("name", rs.getString("name"));
        item.put("brand", rs.getString("brand"));
        item.put("packageSize", rs.getString("package_size"));
        item.put("category", rs.getString("category"));
        item.put("productUrl", rs.getString("product_url"));
        item.put("regionCode", rs.getString("region_code"));
        item.put("regularPriceCents", rs.getObject("regular_price_cents") == null ? null : rs.getInt("regular_price_cents"));
        item.put("salePriceCents", rs.getInt("sale_price_cents"));
        item.put("unitPriceText", rs.getString("unit_price_text"));
        item.put("promotionType", rs.getString("promotion_type"));
        item.put("halfPrice", rs.getBoolean("half_price"));
        item.put("promotionStart", start.toString());
        item.put("promotionEnd", end.toString());
        item.put("active", !start.isAfter(today) && !end.isBefore(today));
        item.put("fetchedAt", rs.getTimestamp("fetched_at").toInstant().toString());
        return item;
    }

    /** 給採買清單用：加入特價品時從資料庫取名稱與價格快照，不相信前端送來的價格 */
    record Snapshot(long promotionSeq, String name, String packageSize, int salePriceCents) {}

    Snapshot snapshot(long promotionSeq) {
        List<Snapshot> found = db.query("""
            SELECT p.seq, sp.name, sp.package_size, p.sale_price_cents
            FROM supermarket_promotion p JOIN supermarket_product sp ON sp.seq = p.product_seq
            WHERE p.seq = ?
            """, (rs, row) -> new Snapshot(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getInt(4)), promotionSeq);
        if (found.isEmpty()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "找不到這筆特價");
        return found.getFirst();
    }

    // ---------- CSV 匯入 ----------

    /**
     * 匯入 CSV。dryRun 只回傳解析結果，不寫資料庫。
     * 實際匯入時：先記一筆匯入紀錄，再在同一個交易內 upsert 所有有效列；交易失敗整批回滾，
     * 匯入紀錄標成 FAILED，既有特價與價格歷史都不受影響。
     */
    Map<String, Object> importCsv(String csv, String regionValue, boolean dryRun, String sourceReference, long adminSeq) {
        String region = region(regionValue);
        String reference = sourceReference == null || sourceReference.isBlank() ? null
            : sourceReference.trim().substring(0, Math.min(200, sourceReference.trim().length()));
        SupermarketCsv.Result parsed = SupermarketCsv.parse(csv);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("dryRun", dryRun);
        result.put("regionCode", region);
        result.put("rowCount", parsed.rowCount());
        result.put("validCount", parsed.rows().size());
        result.put("errors", parsed.errors().subList(0, Math.min(50, parsed.errors().size())));
        result.put("errorCount", parsed.errors().size());
        if (dryRun) {
            result.put("preview", parsed.rows().stream().limit(20).map(row -> Map.of(
                "productId", row.externalProductId(), "name", row.name(),
                "salePriceCents", row.salePriceCents(), "promotionEnd", row.promotionEnd().toString())).toList());
            return result;
        }
        Long runSeq = db.queryForObject("""
            INSERT INTO supermarket_import_run(supermarket_code, region_code, status, row_count,
              error_count, source_reference, imported_by)
            VALUES (?, ?, 'FAILED', ?, ?, ?, ?) RETURNING seq
            """, Long.class, SUPERMARKET, region, parsed.rowCount(), parsed.errors().size(), reference, adminSeq);
        String status;
        String summary = String.join("\n", parsed.errors());
        int imported = 0;
        if (parsed.rows().isEmpty()) {
            status = "FAILED";
        } else {
            try {
                Integer count = tx.execute(ignored -> {
                    for (SupermarketCsv.Row row : parsed.rows()) upsert(row, region, reference, runSeq);
                    return parsed.rows().size();
                });
                imported = count == null ? 0 : count;
                status = parsed.errors().isEmpty() ? "SUCCESS" : "PARTIAL";
            } catch (RuntimeException exception) {
                status = "FAILED";
                summary = "寫入資料庫失敗，整批未匯入" + (summary.isEmpty() ? "" : "\n" + summary);
            }
        }
        db.update("""
            UPDATE supermarket_import_run SET status = ?, imported_count = ?, error_summary = ?, finished_at = now()
            WHERE seq = ?
            """, status, imported, summary.isEmpty() ? null : summary.substring(0, Math.min(2000, summary.length())), runSeq);
        result.put("runId", runSeq);
        result.put("status", status);
        result.put("importedCount", imported);
        return result;
    }

    private void upsert(SupermarketCsv.Row row, String region, String reference, Long runSeq) {
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
            """, Long.class, SUPERMARKET, row.externalProductId(), row.name(), row.brand(),
            row.packageSize(), row.category(), row.productUrl());
        db.update("""
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
            """, productSeq, region, row.regularPriceCents(), row.salePriceCents(), row.unitPriceText(),
            row.promotionType(), row.promotionStart(), row.promotionEnd(), reference, runSeq);
    }

    List<Map<String, Object>> importRuns() {
        return db.query("""
            SELECT seq, region_code, status, row_count, imported_count, error_count, error_summary,
              source_reference, started_at, finished_at
            FROM supermarket_import_run ORDER BY started_at DESC, seq DESC LIMIT 20
            """, (rs, row) -> {
                Map<String, Object> run = new LinkedHashMap<>();
                run.put("id", rs.getLong("seq"));
                run.put("regionCode", rs.getString("region_code"));
                run.put("status", rs.getString("status"));
                run.put("rowCount", rs.getInt("row_count"));
                run.put("importedCount", rs.getInt("imported_count"));
                run.put("errorCount", rs.getInt("error_count"));
                run.put("errorSummary", rs.getString("error_summary"));
                run.put("sourceReference", rs.getString("source_reference"));
                run.put("startedAt", rs.getTimestamp("started_at").toInstant().toString());
                run.put("finishedAt", rs.getTimestamp("finished_at") == null ? null
                    : rs.getTimestamp("finished_at").toInstant().toString());
                return run;
            });
    }
}
