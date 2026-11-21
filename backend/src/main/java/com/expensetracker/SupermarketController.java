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
 * 超市本週特價。查詢是公開資料（訪客也能看，SecurityConfig 已開放 GET）；
 * 匯入只限 SUPER_ADMIN（/api/admin/** 由 SecurityConfig 擋，這裡再檢查一次）。
 */
@RestController
class SupermarketController {
    private final SupermarketService service;

    SupermarketController(SupermarketService service) {
        this.service = service;
    }

    @GetMapping("/api/supermarkets/specials")
    Map<String, Object> specials(@RequestParam(required = false) String keyword,
                                 @RequestParam(required = false) String category,
                                 @RequestParam(required = false) Boolean halfPriceOnly,
                                 @RequestParam(required = false) Integer page,
                                 @RequestParam(required = false) Integer size,
                                 @RequestParam(required = false) String sort,
                                 @RequestParam(required = false) String region) {
        return service.search(SupermarketService.Query.of(keyword, category, halfPriceOnly, page, size, sort, region));
    }

    @GetMapping("/api/supermarkets/specials/{id}")
    Map<String, Object> special(@PathVariable long id) {
        return service.detail(id);
    }

    @GetMapping("/api/supermarkets/categories")
    List<String> categories(@RequestParam(required = false) String region) {
        return service.categories(region);
    }

    @PostMapping("/api/admin/supermarkets/import")
    Map<String, Object> importCsv(Authentication auth, @RequestBody Map<String, Object> body) {
        long admin = AdminController.requireAdmin(auth);
        if (!(body.get("csv") instanceof String csv) || csv.isBlank())
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "請提供 CSV 內容");
        Object region = body.get("regionCode");
        Object reference = body.get("sourceReference");
        return service.importCsv(csv, region instanceof String value ? value : null,
            !Boolean.FALSE.equals(body.get("dryRun")), reference instanceof String value ? value : null, admin);
    }

    @GetMapping("/api/admin/supermarkets/import-runs")
    List<Map<String, Object>> importRuns(Authentication auth) {
        AdminController.requireAdmin(auth);
        return service.importRuns();
    }
}
