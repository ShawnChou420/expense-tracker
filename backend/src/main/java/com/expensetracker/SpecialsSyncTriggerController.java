package com.expensetracker;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * 給外部排程（例如 cron-job.org、GitHub Actions）觸發每週同步的端點，用於後端可能休眠的部署。
 * 不走會員登入；必須帶 X-Sync-Token，值與環境變數 SPECIALS_SYNC_TOKEN 相同（固定時間比較）。
 * 沒設定 SPECIALS_SYNC_TOKEN 時這個端點等於不存在（404）。
 */
@RestController
class SpecialsSyncTriggerController {
    private final SpecialsSyncJob job;
    private final byte[] token;

    SpecialsSyncTriggerController(SpecialsSyncJob job, @Value("${app.specials.sync-token:}") String token) {
        this.job = job;
        this.token = token == null ? new byte[0] : token.trim().getBytes(StandardCharsets.UTF_8);
    }

    @PostMapping("/api/internal/supermarkets/sync")
    Map<String, Object> trigger(@RequestHeader(value = "X-Sync-Token", required = false) String provided) {
        if (token.length < 24) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        byte[] given = provided == null ? new byte[0] : provided.trim().getBytes(StandardCharsets.UTF_8);
        if (!MessageDigest.isEqual(token, given)) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        Map<String, Object> result = job.run("EXTERNAL", 1);
        // 外部排程只需要知道結果，不回傳錯誤細節
        return Map.of("status", result.getOrDefault("status", "UNKNOWN"));
    }
}
