package com.expensetracker;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * 首頁自訂的驗證：模式只能是 PAY／LIFE；模組只存 ID 與是否顯示，順序即陣列順序。
 * 不限定模組清單（前端新增模組時不需改後端），但 ID 格式、數量、重複都要檢查。
 */
final class DashboardLayout {
    static final int MAX_MODULES = 30;
    private static final Pattern ID = Pattern.compile("^[a-z][a-z0-9-]{0,39}$");
    private static final Set<String> MODES = Set.of("PAY", "LIFE");

    private DashboardLayout() {
    }

    static Map<String, Object> validate(Map<String, Object> body) {
        Object mode = body == null ? null : body.get("mode");
        if (!(mode instanceof String text) || !MODES.contains(text)) throw bad("不支援的首頁模式");
        Object raw = body.get("modules");
        if (!(raw instanceof List<?> list) || list.size() > MAX_MODULES) throw bad("首頁模組格式不正確");
        List<Map<String, Object>> modules = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (Object item : list) {
            if (!(item instanceof Map<?, ?> module)) throw bad("首頁模組格式不正確");
            if (!(module.get("id") instanceof String id) || !ID.matcher(id).matches()) throw bad("首頁模組 ID 不正確");
            if (!(module.get("visible") instanceof Boolean visible)) throw bad("首頁模組格式不正確");
            if (!seen.add(id)) throw bad("首頁模組重複");
            Map<String, Object> clean = new LinkedHashMap<>();
            clean.put("id", id);
            clean.put("visible", visible);
            modules.add(clean);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("mode", text);
        result.put("modules", modules);
        return result;
    }

    private static ResponseStatusException bad(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}
