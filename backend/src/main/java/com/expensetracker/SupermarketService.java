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
import org.springframework.web.server.ResponseStatusException;

/**
 * 超市特價查詢（公開資料）。資料由 {@link SpecialsSyncService} 同步進來。
 *
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
    private final Clock clock;

    @Autowired
    SupermarketService(JdbcTemplate db) {
        this(db, Clock.systemUTC());
    }

    SupermarketService(JdbcTemplate db, Clock clock) {
        this.db = db;
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

    /** 目前只有 Woolworths；supermarket 參數其他值一律拒絕，避免以為查得到其他超市 */
    static void supermarket(String value) {
        if (value != null && !value.isBlank() && !SUPERMARKET.equalsIgnoreCase(value.trim()))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "目前只支援 WOOLWORTHS");
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
            WHERE region_code = ? AND finished_at IS NOT NULL ORDER BY started_at DESC, seq DESC LIMIT 1
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
}
