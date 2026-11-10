package com.expensetracker;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 把雲端平台提供的 {@code postgresql://user:password@host:port/db} 連線字串
 * 轉成 Spring 需要的 JDBC URL、帳號、密碼。
 *
 * <p>Render 的 Blueprint 只能把資料庫的 connectionString 注入成 {@code DATABASE_URL}，
 * 格式不是 JDBC。只有在沒設定 {@code DB_URL} 時才會使用它，本機開發方式不變。
 */
final class DatabaseUrl {
    private DatabaseUrl() {}

    /** 依環境變數決定要覆寫的 Spring 設定；沒有需要時回傳空 Map。 */
    static Map<String, String> springProperties(Map<String, String> env) {
        String jdbcUrl = env.get("DB_URL");
        String databaseUrl = env.get("DATABASE_URL");
        if ((jdbcUrl != null && !jdbcUrl.isBlank()) || databaseUrl == null || databaseUrl.isBlank())
            return Map.of();
        return fromConnectionString(databaseUrl);
    }

    static Map<String, String> fromConnectionString(String connectionString) {
        URI uri;
        try {
            uri = URI.create(connectionString.trim());
        } catch (IllegalArgumentException exception) {
            // 不把原始字串放進錯誤訊息，避免密碼出現在 log
            throw new IllegalStateException("DATABASE_URL 格式無效");
        }
        String scheme = uri.getScheme();
        if (!"postgres".equals(scheme) && !"postgresql".equals(scheme))
            throw new IllegalStateException("DATABASE_URL 必須是 postgres:// 或 postgresql:// 開頭");
        String host = uri.getHost();
        String path = uri.getRawPath();
        if (host == null || path == null || path.length() <= 1)
            throw new IllegalStateException("DATABASE_URL 缺少主機或資料庫名稱");

        StringBuilder jdbc = new StringBuilder("jdbc:postgresql://").append(host);
        if (uri.getPort() != -1) jdbc.append(':').append(uri.getPort());
        jdbc.append(path);
        if (uri.getRawQuery() != null) jdbc.append('?').append(uri.getRawQuery());

        Map<String, String> properties = new LinkedHashMap<>();
        properties.put("spring.datasource.url", jdbc.toString());
        String userInfo = uri.getRawUserInfo();
        if (userInfo != null) {
            int separator = userInfo.indexOf(':');
            String user = separator == -1 ? userInfo : userInfo.substring(0, separator);
            properties.put("spring.datasource.username", decode(user));
            if (separator != -1)
                properties.put("spring.datasource.password", decode(userInfo.substring(separator + 1)));
        }
        return properties;
    }

    private static String decode(String value) {
        return URLDecoder.decode(value, StandardCharsets.UTF_8);
    }
}
