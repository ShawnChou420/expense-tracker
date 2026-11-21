package com.expensetracker;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 從一段 CSV 文字取得原始資料列（管理員上傳時使用；資料源網址拉回來的內容也交給這裡解析）。
 * 第一列必須是欄位名稱；欄位驗證與正規化交給 {@link WoolworthsProductNormalizer}。
 */
final class CsvSpecialsCollector implements WoolworthsSpecialsCollector {
    static final int MAX_ROWS = 2000;

    private final String csv;
    private final String sourceType;
    private final String sourceName;

    CsvSpecialsCollector(String csv, String sourceType, String sourceName) {
        this.csv = csv == null ? "" : csv;
        this.sourceType = sourceType;
        this.sourceName = sourceName;
    }

    @Override
    public Collected collect() {
        return parse(csv, sourceType, sourceName);
    }

    static Collected parse(String csv, String sourceType, String sourceName) {
        List<List<String>> rows = records(csv.replace("﻿", ""));
        if (rows.isEmpty()) return new Collected(sourceType, sourceName, List.of(), List.of("CSV 是空的"));
        List<String> header = rows.getFirst().stream().map(value -> value.trim().toLowerCase()).toList();
        List<String> errors = new ArrayList<>();
        for (String field : WoolworthsProductNormalizer.REQUIRED)
            if (!header.contains(field)) errors.add("缺少必要欄位：" + field);
        if (!errors.isEmpty()) return new Collected(sourceType, sourceName, List.of(), errors);
        Map<String, Integer> index = new HashMap<>();
        for (int i = 0; i < header.size(); i++) index.putIfAbsent(header.get(i), i);

        List<RawRecord> records = new ArrayList<>();
        for (int r = 1; r < rows.size(); r++) {
            List<String> values = rows.get(r);
            if (values.stream().allMatch(String::isBlank)) continue;
            if (records.size() >= MAX_ROWS) {
                errors.add("超過 " + MAX_ROWS + " 列上限，其餘未處理");
                break;
            }
            Map<String, String> fields = new LinkedHashMap<>();
            for (var entry : index.entrySet())
                if (entry.getValue() < values.size()) fields.put(entry.getKey(), values.get(entry.getValue()));
            records.add(new RawRecord(r + 1, fields));
        }
        return new Collected(sourceType, sourceName, records, errors);
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
