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

    /** 例如：用到別人已使用的 UUID。只記錯誤類型，不記 SQL 內容 */
    @ExceptionHandler(DuplicateKeyException.class)
    ResponseEntity<Map<String, String>> duplicate(DuplicateKeyException exception) {
        log.warn("資料衝突：{}", exception.getClass().getSimpleName());
        return body(HttpStatus.CONFLICT, "資料衝突，請重新整理後再試");
    }

    /** 外鍵、檢查條件不符：多半是引用了不屬於自己的資料或數值不合理 */
    @ExceptionHandler(DataIntegrityViolationException.class)
    ResponseEntity<Map<String, String>> integrity(DataIntegrityViolationException exception) {
        log.warn("資料不符合限制：{}", exception.getClass().getSimpleName());
        return body(HttpStatus.BAD_REQUEST, "資料不正確，請檢查後再試");
    }

    /** 前端送來的欄位型別不對（例如數字欄位傳了文字） */
    @ExceptionHandler({ ClassCastException.class, NumberFormatException.class })
    ResponseEntity<Map<String, String>> badInput(RuntimeException exception) {
        log.warn("輸入格式錯誤：{}", exception.getClass().getSimpleName());
        return body(HttpStatus.BAD_REQUEST, "請檢查輸入資料");
    }

    private static ResponseEntity<Map<String, String>> body(HttpStatus status, String detail) {
        return ResponseEntity.status(status).body(Map.of("detail", detail));
    }
}
