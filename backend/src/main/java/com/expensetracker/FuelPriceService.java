package com.expensetracker;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * 首頁油價卡：從快取的「NSW 全部油價」找出附近（或指定郵遞區號）最便宜的加油站。
 *
 * <p>api.nsw 每個 app 每月 2500 次呼叫，所以不幫每位使用者各呼叫一次「附近油價」，
 * 而是最多每小時抓一次全部油價放在記憶體，附近的計算都在伺服器端完成。
 * 外部服務失敗時 10 分鐘內不再重試，有舊資料就先回舊資料（stale = true）。
 * 這裡只用到使用者傳來的座標或郵遞區號做計算，不儲存、不寫紀錄。
 */
@Service
class FuelPriceService {
    static final Set<String> FUEL_TYPES = Set.of("E10", "U91", "P95", "P98", "DL", "PDL", "LPG");
    static final Duration REFRESH_AFTER = Duration.ofHours(1);
    static final Duration RETRY_AFTER_FAILURE = Duration.ofMinutes(10);
    private static final Pattern POSTCODE = Pattern.compile("\\d{4}");

    private final FuelPriceSource source;
    private final Clock clock;
    private FuelPriceSource.Snapshot snapshot;
    private Instant lastFailureAt;

    @Autowired
    FuelPriceService(FuelPriceSource source) {
        this(source, Clock.systemUTC());
    }

    FuelPriceService(FuelPriceSource source, Clock clock) {
        this.source = source;
        this.clock = clock;
    }

    record Query(String fuelType, Double latitude, Double longitude, String postcode, double radiusKm, int limit) {}

    record Station(String name, String brand, String address, int priceTenths, Double distanceKm, String lastUpdated) {}

    record Result(String fuelType, Instant fetchedAt, boolean stale, List<Station> stations) {}

    /** 找不到資料或服務未設定時丟出 {@link Unavailable}。 */
    Result nearby(Query query) {
        validate(query);
        Snapshot current = currentSnapshot();
        boolean byLocation = query.latitude() != null && query.longitude() != null;
        Comparator<Station> order = Comparator.comparingInt(Station::priceTenths);
        if (byLocation) order = order.thenComparing(station -> station.distanceKm() == null ? 0 : station.distanceKm());
        List<Station> stations = current.snapshot().prices().stream()
            .filter(price -> price.fuelType().equals(query.fuelType()))
            .flatMap(price -> Optional.ofNullable(current.snapshot().stations().get(price.stationCode()))
                .map(station -> toStation(station, price, query, byLocation)).stream())
            .filter(station -> station != null)
            .sorted(order)
            .limit(query.limit())
            .toList();
        return new Result(query.fuelType(), current.snapshot().fetchedAt(), current.stale(), stations);
    }

    private Station toStation(FuelPriceSource.Station station, FuelPriceSource.Price price, Query query,
                              boolean byLocation) {
        Double distance = null;
        if (byLocation) {
            double km = distanceKm(query.latitude(), query.longitude(), station.latitude(), station.longitude());
            if (km > query.radiusKm()) return null;
            distance = Math.round(km * 10) / 10.0;
        } else if (!matchesPostcode(station.address(), query.postcode())) {
            return null;
        }
        return new Station(station.name(), station.brand(), station.address(), price.priceTenths(), distance,
            price.lastUpdated());
    }

    private record Snapshot(FuelPriceSource.Snapshot snapshot, boolean stale) {}

    private synchronized Snapshot currentSnapshot() {
        if (!source.configured()) throw new Unavailable("油價服務尚未設定");
        Instant now = clock.instant();
        boolean fresh = snapshot != null && snapshot.fetchedAt().plus(REFRESH_AFTER).isAfter(now);
        if (fresh) return new Snapshot(snapshot, false);
        boolean coolingDown = lastFailureAt != null && lastFailureAt.plus(RETRY_AFTER_FAILURE).isAfter(now);
        if (!coolingDown) {
            try {
                FuelPriceSource.Snapshot next = source.fetchAll();
                snapshot = new FuelPriceSource.Snapshot(next.stations(), next.prices(), now);
                lastFailureAt = null;
                return new Snapshot(snapshot, false);
            } catch (RuntimeException exception) {
                lastFailureAt = now;
            }
        }
        if (snapshot != null) return new Snapshot(snapshot, true);
        throw new Unavailable("暫時取不到油價，請稍後再試");
    }

    private static void validate(Query query) {
        if (!FUEL_TYPES.contains(query.fuelType())) throw new IllegalArgumentException("不支援的油種");
        boolean byLocation = query.latitude() != null && query.longitude() != null;
        if (byLocation) {
            if (Math.abs(query.latitude()) > 90 || Math.abs(query.longitude()) > 180)
                throw new IllegalArgumentException("位置無效");
        } else if (query.postcode() == null || !POSTCODE.matcher(query.postcode()).matches()) {
            throw new IllegalArgumentException("請提供位置或 4 位數郵遞區號");
        }
        if (query.radiusKm() <= 0 || query.radiusKm() > 25) throw new IllegalArgumentException("搜尋半徑需在 1–25 公里");
        if (query.limit() < 1 || query.limit() > 10) throw new IllegalArgumentException("筆數需在 1–10");
    }

    /** 地址結尾通常是「SUBURB NSW 2000」 */
    static boolean matchesPostcode(String address, String postcode) {
        return address != null && address.trim().matches(".*\\D" + postcode + "$");
    }

    /** 兩點間距離（公里，haversine） */
    static double distanceKm(double lat1, double lon1, double lat2, double lon2) {
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
            + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    static class Unavailable extends RuntimeException {
        Unavailable(String message) {
            super(message);
        }
    }
}
