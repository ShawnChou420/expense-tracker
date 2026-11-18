package com.expensetracker;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

/**
 * 使用者活動與系統錯誤事件（user_activity_event）。只存非敏感摘要：
 * 事件類型、成功／失敗、錯誤代碼、request id 與少量數字或短代碼。
 * 絕不存密碼、token、PDF 密碼、薪資單原文、銀行資料、地址或備註全文。
 *
 * <p>寫入使用獨立交易：原本的操作失敗回滾時，「失敗」事件仍會留下；
 * 寫入本身失敗也只記 log，不影響使用者的請求。
 */
@Service
public class ActivityLog {
    private static final Logger log = LoggerFactory.getLogger(ActivityLog.class);
    /** 事件保留天數，超過後每天自動清除 */
    static final int RETENTION_DAYS = 180;
    static final int MAX_DETAIL_ENTRIES = 8;
    static final int MAX_DETAIL_TEXT = 40;
    private static final Pattern KEY = Pattern.compile("[A-Za-z][A-Za-z0-9]{0,29}");
    private static final Pattern CODE = Pattern.compile("[A-Z][A-Z0-9_]{0,59}");
    static final List<String> CATEGORIES = List.of("USER", "API_ERROR", "PAYSLIP", "DATABASE", "ADMIN_SECURITY");

    private final JdbcTemplate db;
    private final ObjectMapper json;
    private final TransactionTemplate separate;

    ActivityLog(JdbcTemplate db, ObjectMapper json, PlatformTransactionManager transactions) {
        this.db = db;
        this.json = json;
        this.separate = new TransactionTemplate(transactions);
        this.separate.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    void success(Long userSeq, String type, Map<String, ?> details) {
        record(userSeq, "USER", type, true, null, details);
    }

    void failure(Long userSeq, String category, String type, String errorCode, Map<String, ?> details) {
        record(userSeq, category, type, false, errorCode, details);
    }

    void record(Long userSeq, String category, String type, boolean ok, String errorCode, Map<String, ?> details) {
        try {
            if (!CATEGORIES.contains(category) || type == null || !CODE.matcher(type).matches()) return;
            String code = errorCode != null && CODE.matcher(errorCode).matches() ? errorCode : null;
            String detailJson = json.writeValueAsString(sanitize(details));
            separate.executeWithoutResult(status -> db.update("""
                INSERT INTO user_activity_event(user_seq, category, event_type, status, error_code, request_id, details)
                VALUES (?, ?, ?, ?, ?, ?, ?::jsonb)
                """, userSeq, category, type, ok ? "SUCCESS" : "FAILURE", code, RequestTiming.currentRequestId(), detailJson));
        } catch (RuntimeException exception) {
            log.warn("事件紀錄寫入失敗：{} {}", type, exception.getClass().getSimpleName());
        }
    }

    /**
     * 只保留安全的值：數字、布林、短代碼文字（最多 40 字），最多 8 個欄位。
     * 鍵名只能是英數字；其他內容一律丟棄，避免把個資或原文寫進事件。
     */
    static Map<String, Object> sanitize(Map<String, ?> details) {
        Map<String, Object> safe = new LinkedHashMap<>();
        if (details == null) return safe;
        for (var entry : details.entrySet()) {
            if (safe.size() >= MAX_DETAIL_ENTRIES) break;
            if (entry.getKey() == null || !KEY.matcher(entry.getKey()).matches()) continue;
            Object value = entry.getValue();
            if (value instanceof Number || value instanceof Boolean) safe.put(entry.getKey(), value);
            else if (value instanceof String text && text.length() <= MAX_DETAIL_TEXT && !text.contains("@"))
                safe.put(entry.getKey(), text);
        }
        return safe;
    }

    /** 每天清除超過保留期限的事件 */
    @Scheduled(cron = "0 30 3 * * *", zone = "Australia/Sydney")
    void purgeExpired() {
        int removed = db.update("DELETE FROM user_activity_event WHERE occurred_at < now() - (? * interval '1 day')", RETENTION_DAYS);
        if (removed > 0) log.info("已清除 {} 筆超過 {} 天的活動事件", removed, RETENTION_DAYS);
    }
}
