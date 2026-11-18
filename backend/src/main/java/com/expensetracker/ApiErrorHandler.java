package com.expensetracker;

import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * 全域錯誤處理：資料庫衝突、輸入格式錯誤不再回 500，也不把 SQL 或例外細節回給前端。
 * 各 Controller 自己處理的 ResponseStatusException 不受影響。
 */
@RestControllerAdvice
public class ApiErrorHandler {
    private static final Logger log = LoggerFactory.getLogger(ApiErrorHandler.class);
    private ActivityLog activity;

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    void setActivity(ActivityLog activity) {
        this.activity = activity;
    }

    /** 目前登入的會員（沒有登入時是 null），只用來把錯誤事件對到會員 */
    private static Long currentUser() {
        var auth = org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication();
        return auth != null && auth.getPrincipal() instanceof Long seq ? seq : null;
    }

    private void record(String category, String type, Exception exception) {
        if (activity != null) activity.failure(currentUser(), category, type, errorCode(exception), null);
    }

    /** 例外類別 → 錯誤代碼，例如 DataAccessResourceFailureException → DATA_ACCESS_RESOURCE_FAILURE_EXCEPTION */
    static String errorCode(Exception exception) {
        String code = exception.getClass().getSimpleName().replaceAll("([a-z0-9])([A-Z])", "$1_$2").toUpperCase(java.util.Locale.ROOT);
        return code.length() > 60 ? code.substring(0, 60) : code;
    }

    /** 例如：用到別人已使用的 UUID。只記錯誤類型，不記 SQL 內容 */
    @ExceptionHandler(DuplicateKeyException.class)
    ResponseEntity<Map<String, String>> duplicate(DuplicateKeyException exception) {
        log.warn("資料衝突：{}", exception.getClass().getSimpleName());
        record("DATABASE", "DB_CONSTRAINT_VIOLATION", exception);
        return body(HttpStatus.CONFLICT, "資料衝突，請重新整理後再試");
    }

    /** 外鍵、檢查條件不符：多半是引用了不屬於自己的資料或數值不合理 */
    @ExceptionHandler(DataIntegrityViolationException.class)
    ResponseEntity<Map<String, String>> integrity(DataIntegrityViolationException exception) {
        log.warn("資料不符合限制：{}", exception.getClass().getSimpleName());
        record("DATABASE", "DB_CONSTRAINT_VIOLATION", exception);
        return body(HttpStatus.BAD_REQUEST, "資料不正確，請檢查後再試");
    }

    /** 前端送來的欄位型別不對（例如數字欄位傳了文字） */
    @ExceptionHandler({ ClassCastException.class, NumberFormatException.class })
    ResponseEntity<Map<String, String>> badInput(RuntimeException exception) {
        log.warn("輸入格式錯誤：{}", exception.getClass().getSimpleName());
        return body(HttpStatus.BAD_REQUEST, "請檢查輸入資料");
    }

    /** Controller 主動回傳的錯誤（4xx 等）：照原本的狀態碼與訊息 */
    @ExceptionHandler(org.springframework.web.server.ResponseStatusException.class)
    ResponseEntity<Map<String, String>> status(org.springframework.web.server.ResponseStatusException exception) {
        return ResponseEntity.status(exception.getStatusCode())
            .body(Map.of("detail", exception.getReason() == null ? "請檢查輸入資料" : exception.getReason()));
    }

    /** 資料庫連線或查詢失敗：記錄事件，回傳可重試的訊息與 request id */
    @ExceptionHandler(org.springframework.dao.DataAccessException.class)
    ResponseEntity<Map<String, String>> database(org.springframework.dao.DataAccessException exception) {
        log.error("資料庫操作失敗 rid={}", RequestTiming.currentRequestId(), exception);
        record("DATABASE", "DB_ERROR", exception);
        return withRequestId(HttpStatus.SERVICE_UNAVAILABLE, "資料庫暫時無法使用，請稍後再試");
    }

    /**
     * 其他未預期的錯誤：Stack trace 只寫在伺服器 log（用 request id 查），
     * 資料庫只存錯誤代碼，前端只看到安全的訊息與 request id。
     */
    @ExceptionHandler(Exception.class)
    ResponseEntity<Map<String, String>> unexpected(Exception exception) throws Exception {
        // Spring 自己的 4xx（格式錯誤、方法不支援、找不到路徑）照原本的狀態回傳
        if (exception instanceof org.springframework.web.ErrorResponse error && error.getStatusCode().is4xxClientError())
            return ResponseEntity.status(error.getStatusCode()).body(Map.of("detail", "請求格式不正確"));
        if (exception instanceof org.springframework.security.access.AccessDeniedException
            || exception instanceof org.springframework.security.core.AuthenticationException) throw exception;
        log.error("未預期的錯誤 rid={}", RequestTiming.currentRequestId(), exception);
        record("API_ERROR", "API_ERROR", exception);
        return withRequestId(HttpStatus.INTERNAL_SERVER_ERROR, "系統發生錯誤，請稍後再試");
    }

    private static ResponseEntity<Map<String, String>> withRequestId(HttpStatus status, String detail) {
        String rid = RequestTiming.currentRequestId();
        return ResponseEntity.status(status).body(rid == null ? Map.of("detail", detail)
            : Map.of("detail", detail + "（錯誤代碼 " + rid + "）", "requestId", rid));
    }

    private static ResponseEntity<Map<String, String>> body(HttpStatus status, String detail) {
        return ResponseEntity.status(status).body(Map.of("detail", detail));
    }
}
