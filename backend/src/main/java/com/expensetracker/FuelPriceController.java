package com.expensetracker;

import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 首頁油價卡（訪客與會員都可用）：NSW 公開油價，不含任何會員資料。
 * 外部呼叫次數由 {@link FuelPriceService} 的快取控制，與使用人數無關。
 */
@RestController
class FuelPriceController {
    private final FuelPriceService fuel;

    FuelPriceController(FuelPriceService fuel) {
        this.fuel = fuel;
    }

    @GetMapping("/api/fuel-prices/nearby")
    ResponseEntity<?> nearby(@RequestParam(defaultValue = "E10") String fuelType,
                             @RequestParam(required = false) Double lat,
                             @RequestParam(required = false) Double lng,
                             @RequestParam(required = false) String postcode,
                             @RequestParam(defaultValue = "5") double radiusKm,
                             @RequestParam(defaultValue = "5") int limit) {
        try {
            return ResponseEntity.ok(fuel.nearby(new FuelPriceService.Query(
                fuelType.trim().toUpperCase(java.util.Locale.ROOT), lat, lng,
                postcode == null ? null : postcode.trim(), radiusKm, limit)));
        } catch (IllegalArgumentException exception) {
            return ResponseEntity.badRequest().body(Map.of("message", exception.getMessage()));
        } catch (FuelPriceService.Unavailable exception) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of("message", exception.getMessage()));
        }
    }
}
