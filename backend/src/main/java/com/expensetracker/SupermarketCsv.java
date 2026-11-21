package com.expensetracker;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 特價 CSV 解析（純函式，不碰資料庫）。
 *
 * <p>第一列必須是欄位名稱；價格以「元」填寫（例如 4.50），轉成整數 cents。
 * 每一列獨立驗證：有錯的列放進 errors，不影響其他列。
 */
final class SupermarketCsv {
    private SupermarketCsv() {}

    static final int MAX_ROWS = 2000;
    static final List<String> REQUIRED = List.of(
        "external_product_id", "name", "sale_price", "promotion_start", "promotion_end");
    static final List<String> OPTIONAL = List.of(
        "brand", "package_size", "category", "regular_price", "unit_price", "promotion_type", "product_url");
    static final List<String> PROMOTION_TYPES = List.of("HALF_PRICE", "PRICE_DROP", "MULTI_BUY", "OTHER");

    record Row(int line, String externalProductId, String name, String brand, String packageSize,
               String category, Integer regularPriceCents, int salePriceCents, String unitPriceText,
               String promotionType, LocalDate promotionStart, LocalDate promotionEnd, String productUrl) {}

    record Result(List<Row> rows, List<String> errors, int rowCount) {}

    static Result parse(String csv) {
        List<String> errors = new ArrayList<>();
        List<List<String>> records = records(csv == null ? "" : csv.replace("﻿", ""));
        if (records.isEmpty()) return new Result(List.of(), List.of("CSV 是空的"), 0);
        List<String> header = records.getFirst().stream().map(value -> value.trim().toLowerCase()).toList();
        for (String field : REQUIRED)
            if (!header.contains(field)) errors.add("缺少必要欄位：" + field);
        if (!errors.isEmpty()) return new Result(List.of(), errors, 0);
        Map<String, Integer> index = new HashMap<>();
        for (int i = 0; i < header.size(); i++) index.putIfAbsent(header.get(i), i);

        List<Row> rows = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        int rowCount = 0;
        for (int r = 1; r < records.size(); r++) {
            List<String> values = records.get(r);
            if (values.stream().allMatch(String::isBlank)) continue;
            rowCount++;
            int line = r + 1;
            if (rowCount > MAX_ROWS) {
                errors.add("超過 " + MAX_ROWS + " 列上限，其餘未處理");
                break;
            }
            try {
                Row row = row(line, values, index);
                String key = row.externalProductId() + "|" + row.promotionStart();
                if (!seen.add(key)) throw new IllegalArgumentException("同一商品同一期重複出現");
                rows.add(row);
            } catch (IllegalArgumentException exception) {
                errors.add("第 " + line + " 列：" + exception.getMessage());
            }
        }
        return new Result(rows, errors, rowCount);
    }

    private static Row row(int line, List<String> values, Map<String, Integer> index) {
        String id = text(values, index, "external_product_id", 40, true);
        if (!id.matches("[A-Za-z0-9_-]+")) throw new IllegalArgumentException("external_product_id 只能有英數字、- 或 _");
        String name = text(values, index, "name", 200, true);
        Integer regular = price(values, index, "regular_price", false);
        Integer sale = price(values, index, "sale_price", true);
        if (regular != null && sale > regular) throw new IllegalArgumentException("特價不可高於原價");
        String type = text(values, index, "promotion_type", 20, false);
        type = type == null ? "OTHER" : type.toUpperCase();
        if (!PROMOTION_TYPES.contains(type)) throw new IllegalArgumentException("無效 promotion_type：" + type);
        LocalDate start = date(values, index, "promotion_start");
        LocalDate end = date(values, index, "promotion_end");
        if (end.isBefore(start)) throw new IllegalArgumentException("promotion_end 不可早於 promotion_start");
        String url = text(values, index, "product_url", 500, false);
        if (url != null && !url.startsWith("https://www.woolworths.com.au/"))
            throw new IllegalArgumentException("product_url 必須是 https://www.woolworths.com.au/ 開頭");
        return new Row(line, id, name, text(values, index, "brand", 100, false),
            text(values, index, "package_size", 60, false), text(values, index, "category", 60, false),
            regular, sale, text(values, index, "unit_price", 60, false), type, start, end, url);
    }

    private static String raw(List<String> values, Map<String, Integer> index, String field) {
        Integer i = index.get(field);
        if (i == null || i >= values.size()) return null;
        String value = values.get(i).trim();
        return value.isEmpty() ? null : value;
    }

    private static String text(List<String> values, Map<String, Integer> index, String field, int max, boolean required) {
        String value = raw(values, index, field);
        if (value == null && required) throw new IllegalArgumentException("缺少 " + field);
        if (value != null && value.length() > max) throw new IllegalArgumentException(field + " 超過 " + max + " 字");
        return value;
    }

    /** 「4.50」「$4.50」→ 450；最多兩位小數，不做四捨五入，避免價格被默默改掉 */
    static Integer price(List<String> values, Map<String, Integer> index, String field, boolean required) {
        String value = raw(values, index, field);
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

    private static LocalDate date(List<String> values, Map<String, Integer> index, String field) {
        String value = text(values, index, field, 10, true);
        try {
            return LocalDay.parse(value, field);
        } catch (RuntimeException exception) {
            throw new IllegalArgumentException(field + " 必須是 YYYY-MM-DD");
        }
    }

    /** 最小的 RFC 4180 解析：支援雙引號、引號內逗號與換行、"" 跳脫 */
    static List<List<String>> records(String csv) {
        List<List<String>> records = new ArrayList<>();
        List<String> current = new ArrayList<>();
        StringBuilder field = new StringBuilder();
        boolean quoted = false;
        for (int i = 0; i < csv.length(); i++) {
            char c = csv.charAt(i);
            if (quoted) {
                if (c == '"' && i + 1 < csv.length() && csv.charAt(i + 1) == '"') {
                    field.append('"');
                    i++;
                } else if (c == '"') quoted = false;
                else field.append(c);
            } else if (c == '"' && field.isEmpty()) quoted = true;
            else if (c == ',') {
                current.add(field.toString());
                field.setLength(0);
            } else if (c == '\n' || c == '\r') {
                if (c == '\r' && i + 1 < csv.length() && csv.charAt(i + 1) == '\n') i++;
                current.add(field.toString());
                field.setLength(0);
                records.add(current);
                current = new ArrayList<>();
            } else field.append(c);
        }
        if (!field.isEmpty() || !current.isEmpty()) {
            current.add(field.toString());
            records.add(current);
        }
        return records;
    }
}
