package com.expensetracker;

import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * App 開啟時等待用的公開端點：確認後端和資料庫都已經可以回應（Neon 免費方案閒置後也要喚醒）。
 * 不含任何會員或設定資訊。和 /api/health 分開，Render 健康檢查不受資料庫暫時喚醒影響。
 */
@RestController
public class ReadyController {
    private final JdbcTemplate db;

    ReadyController(JdbcTemplate db) {
        this.db = db;
    }

    @GetMapping("/api/ready")
    ResponseEntity<Map<String, String>> ready() {
        try {
            db.queryForObject("SELECT 1", Integer.class);
            return ResponseEntity.ok(Map.of("status", "ready"));
        } catch (RuntimeException exception) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of("status", "starting"));
        }
    }
}
