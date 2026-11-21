package com.expensetracker;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * NSW 全部加油站的油價快照來源（正式環境為 {@link NswFuelApiClient}，測試可換成假的）。
 */
interface FuelPriceSource {
    /** 是否已設定 API Key／Secret；沒設定時不呼叫外部服務。 */
    boolean configured();

    /** 取回全部加油站與目前油價。失敗時丟出例外。 */
    Snapshot fetchAll();

    /** 加油站（code 為 FuelCheck 的 station code）。 */
    record Station(String code, String brand, String name, String address, double latitude, double longitude) {}

    /** 單一油種價格：priceTenths 為每公升「0.1 分」的整數，例如 189.9 c/L → 1899。 */
    record Price(String stationCode, String fuelType, int priceTenths, String lastUpdated) {}

    record Snapshot(Map<String, Station> stations, List<Price> prices, Instant fetchedAt) {}
}
