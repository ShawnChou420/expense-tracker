package com.expensetracker;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * 只有前端知道的事件（例如薪資單 PDF 在瀏覽器解析失敗、填滿本月完成）。
 * 只接受白名單事件與非敏感細節（ActivityLog.sanitize），每位會員每小時最多 60 筆。
 */
@RestController
@RequestMapping("/api/events")
public class ClientEventController {
    /** 事件類型 → 分類 */
    static final Map<String, String> ALLOWED = Map.of(
        "PAYSLIP_IMPORT_FAILED", "PAYSLIP",
        "FILL_MONTH_COMPLETED", "USER");
    static final int MAX_PER_HOUR = 60;

    private final ActivityLog activity;
    private final Map<Long, int[]> counts = new ConcurrentHashMap<>();
    private volatile Instant window = Instant.now();

    ClientEventController(ActivityLog activity) {
        this.activity = activity;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.ACCEPTED)
    @SuppressWarnings("unchecked")
    void record(Authentication auth, @RequestBody Map<String, Object> body) {
        long owner = LedgerController.owner(auth);
        String type = body == null ? null : String.valueOf(body.get("type"));
        String category = ALLOWED.get(type);
        if (category == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "不支援的事件");
        if (!allow(owner)) throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "事件太多，請稍後再試");
        boolean ok = !"FAILURE".equals(body.get("status"));
        Object errorCode = body.get("errorCode");
        Map<String, Object> details = body.get("details") instanceof Map<?, ?> map ? (Map<String, Object>) map : Map.of();
        activity.record(owner, category, type, ok, errorCode instanceof String code ? code : null, details);
    }

    private boolean allow(long owner) {
        if (window.isBefore(Instant.now().minus(1, ChronoUnit.HOURS))) {
            counts.clear();
            window = Instant.now();
        }
        int[] count = counts.computeIfAbsent(owner, key -> new int[1]);
        synchronized (count) {
            return ++count[0] <= MAX_PER_HOUR;
        }
    }
}
