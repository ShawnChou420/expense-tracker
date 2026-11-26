package com.expensetracker;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 把供應者給的原始資料列驗證並正規化成特價資料（純函式，不碰資料庫）。
 *
 * <p>金額轉成整數 cents（AUD），不四捨五入，格式不對就整列拒絕，避免價格被默默改掉。
 * 無法確認的欄位保留 null，不自行產生價格。每一列獨立驗證：有錯的列放進 errors，不影響其他列。
 */
final class WoolworthsProductNormalizer {
    private WoolworthsProductNormalizer() {}

    static final List<String> REQUIRED = List.of(
        "external_product_id", "name", "sale_price", "promotion_start", "promotion_end");
    static final List<String> PROMOTION_TYPES = List.of("HALF_PRICE", "PRICE_DROP", "MULTI_BUY", "OTHER");

    record Special(int line, String externalProductId, String name, String brand, String packageSize,
                   String category, Integer regularPriceCents, int salePriceCents, String unitPriceText,
                   String promotionType, LocalDate promotionStart, LocalDate promotionEnd, String productUrl) {
        /** 折扣百分比（四捨五入到整數）；沒有原價時為 null。不另存，查詢時同樣即時計算 */
        Integer discountPercent() {
            if (regularPriceCents == null || regularPriceCents <= salePriceCents) return null;
            return Math.round((regularPriceCents - salePriceCents) * 100f / regularPriceCents);
        }
    }

    record Result(List<Special> specials, List<String> errors) {}

    static Result normalize(List<WoolworthsSpecialsCollector.RawRecord> records) {
        List<Special> specials = new ArrayList<>();
        List<String> errors = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (var record : records) {
            try {
                Special special = special(record.line(), record.fields());
                if (!seen.add(special.externalProductId() + "|" + special.promotionStart()))
                    throw new IllegalArgumentException("同一商品同一期重複出現");
                specials.add(special);
            } catch (IllegalArgumentException exception) {
                errors.add("第 " + record.line() + " 列：" + exception.getMessage());
            }
        }
        return new Result(specials, errors);
    }

    static Special special(int line, Map<String, String> fields) {
        String id = text(fields, "external_product_id", 40, true);
        if (!id.matches("[A-Za-z0-9_-]+")) throw new IllegalArgumentException("external_product_id 只能有英數字、- 或 _");
        String name = clip(text(fields, "name", Integer.MAX_VALUE, true), 200);
        Integer regular = price(fields, "regular_price", false);
        Integer sale = price(fields, "sale_price", true);
        if (regular != null && sale > regular) throw new IllegalArgumentException("特價不可高於原價");
        String type = text(fields, "promotion_type", 20, false);
        type = type == null ? "OTHER" : type.toUpperCase().replace(' ', '_');
        if (!PROMOTION_TYPES.contains(type)) throw new IllegalArgumentException("無效 promotion_type：" + type);
        LocalDate start = date(fields, "promotion_start");
        LocalDate end = date(fields, "promotion_end");
        if (end.isBefore(start)) throw new IllegalArgumentException("promotion_end 不可早於 promotion_start");
        String url = raw(fields, "product_url");
        if (url != null && !url.startsWith("https://www.woolworths.com.au/"))
            throw new IllegalArgumentException("product_url 必須是 https://www.woolworths.com.au/ 開頭");
        if (url != null && url.length() > 500) url = null; // 網址截斷就打不開，太長時不存
        return new Special(line, id, name, optional(fields, "brand", 100), optional(fields, "package_size", 60),
            optional(fields, "category", 60), regular, sale, optional(fields, "unit_price", 60), type, start, end, url);
    }

    private static String raw(Map<String, String> fields, String field) {
        String value = fields.get(field);
        if (value == null) return null;
        value = value.trim();
        return value.isEmpty() ? null : value;
    }

    /** 敘述類欄位：超過資料庫欄位長度時截斷（結尾加 …），不整列拒絕 */
    private static String optional(Map<String, String> fields, String field, int max) {
        String value = raw(fields, field);
        return value == null ? null : clip(value, max);
    }

    static String clip(String value, int max) {
        if (value.length() <= max) return value;
        int end = max - 1;
        if (Character.isHighSurrogate(value.charAt(end - 1))) end--; // 不切斷 emoji 等代理字元
        return value.substring(0, end).stripTrailing() + "…";
    }

    private static String text(Map<String, String> fields, String field, int max, boolean required) {
        String value = raw(fields, field);
        if (value == null && required) throw new IllegalArgumentException("缺少 " + field);
        if (value != null && value.length() > max) throw new IllegalArgumentException(field + " 超過 " + max + " 字");
        return value;
    }

    /** 「4.50」「$4.50」→ 450；最多兩位小數 */
    static Integer price(Map<String, String> fields, String field, boolean required) {
        String value = raw(fields, field);
        if (value == null) {
            if (required) throw new IllegalArgumentException("缺少 " + field);
            return null;
        }
        String cleaned = value.startsWith("$") ? value.substring(1) : value;
        if (!cleaned.matches("\\d{1,5}(\\.\\d{1,2})?")) throw new IllegalArgumentException(field + " 格式錯誤：" + value);
        int cents = new BigDecimal(cleaned).movePointRight(2).intValueExact();
        if (cents <= 0) throw new IllegalArgumentException(field + " 必須大於 0");
        return cents;
    }

    private static LocalDate date(Map<String, String> fields, String field) {
        String value = text(fields, field, 10, true);
        try {
            return LocalDay.parse(value, field);
        } catch (RuntimeException exception) {
            throw new IllegalArgumentException(field + " 必須是 YYYY-MM-DD");
        }
    }
}
