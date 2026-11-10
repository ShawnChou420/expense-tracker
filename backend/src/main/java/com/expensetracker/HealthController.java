package com.expensetracker;

import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 給 Render 健康檢查用的公開端點：只回報程式是否在運作，不含任何會員或設定資訊。
 * 資料庫連不上時程式在啟動階段（Flyway）就會失敗，新版本不會上線。
 */
@RestController
public class HealthController {
    @GetMapping("/api/health")
    Map<String, String> health() {
        return Map.of("status", "ok");
    }
}
