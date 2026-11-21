package com.expensetracker;

import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * 超市本週特價。查詢與同步狀態是公開資料（訪客也能看，SecurityConfig 已開放 GET）；
 * 同步只限 SUPER_ADMIN（/api/admin/** 由 SecurityConfig 擋，這裡再檢查一次）。
 */
@RestController
class SupermarketController {
    private final SupermarketService service;
    private final SpecialsSyncService sync;
    private final SpecialsSyncJob job;

    SupermarketController(SupermarketService service, SpecialsSyncService sync, SpecialsSyncJob job) {
        this.service = service;
        this.sync = sync;
        this.job = job;
    }

    @GetMapping("/api/supermarkets/specials")
    Map<String, Object> specials(@RequestParam(required = false) String keyword,
                                 @RequestParam(required = false) String category,
                                 @RequestParam(required = false) Boolean halfPriceOnly,
                                 @RequestParam(required = false) String supermarket,
                                 @RequestParam(required = false) String storeCode,
                                 @RequestParam(required = false) String region,
                                 @RequestParam(required = false) Integer page,
                                 @RequestParam(required = false) Integer size,
                                 @RequestParam(required = false) String sort) {
        SupermarketService.supermarket(supermarket);
        return service.search(SupermarketService.Query.of(keyword, category, halfPriceOnly, page, size, sort,
            storeCode != null && !storeCode.isBlank() ? storeCode : region));
    }

    /** 最後同步時間、目前特價的有效日期、是否可能過期 */
    @GetMapping("/api/supermarkets/specials/status")
    Map<String, Object> status(@RequestParam(required = false) String storeCode) {
        return sync.status(storeCode, job.configured());
    }

    @GetMapping("/api/supermarkets/specials/{id}")
    Map<String, Object> special(@PathVariable long id) {
        return service.detail(id);
    }

    @GetMapping("/api/supermarkets/categories")
    List<String> categories(@RequestParam(required = false) String region) {
        return service.categories(region);
    }

    /**
     * 管理員手動同步：body 有 csv 時用上傳的 CSV（dryRun 預設 true，只預覽）；
     * 沒有 csv 時從設定的資料源網址拉取並直接寫入（失敗不自動重試，結果直接回報）。
     */
    @PostMapping({ "/api/admin/supermarkets/sync", "/api/admin/supermarkets/import" })
    Map<String, Object> adminSync(Authentication auth, @RequestBody(required = false) Map<String, Object> body) {
        long admin = AdminController.requireAdmin(auth);
        Map<String, Object> request = body == null ? Map.of() : body;
        Object csv = request.get("csv");
        if (csv == null) return job.run("MANUAL", 1, false);
        if (!(csv instanceof String text) || text.isBlank())
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "請提供 CSV 內容");
        Object region = request.get("regionCode");
        Object reference = request.get("sourceReference");
        return sync.sync(new CsvSpecialsCollector(text, "CSV", "upload"), new SpecialsSyncService.Options("MANUAL",
            region instanceof String value ? value : null, !Boolean.FALSE.equals(request.get("dryRun")),
            reference instanceof String value ? value : null, admin));
    }

    @GetMapping({ "/api/admin/supermarkets/sync-logs", "/api/admin/supermarkets/import-runs" })
    List<Map<String, Object>> syncLogs(Authentication auth) {
        AdminController.requireAdmin(auth);
        return sync.runs();
    }
}
