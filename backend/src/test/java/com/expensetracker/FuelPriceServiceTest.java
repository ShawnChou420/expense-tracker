package com.expensetracker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

/** 首頁油價卡：快取（控制 api.nsw 呼叫次數）、附近／郵遞區號篩選與回應解析。 */
class FuelPriceServiceTest {
    /** 雪梨市中心附近 */
    private static final double LAT = -33.8688;
    private static final double LNG = 151.2093;

    static class FakeSource implements FuelPriceSource {
        boolean configured = true;
        boolean fail;
        int calls;

        @Override
        public boolean configured() {
            return configured;
        }

        @Override
        public Snapshot fetchAll() {
            calls++;
            if (fail) throw new IllegalStateException("down");
            return new Snapshot(Map.of(
                "1", new Station("1", "BP", "BP City", "1 George St, Sydney NSW 2000", -33.8700, 151.2070),
                "2", new Station("2", "Ampol", "Ampol Surry Hills", "2 Crown St, Surry Hills NSW 2010", -33.8840, 151.2110),
                "3", new Station("3", "Shell", "Shell Parramatta", "3 Church St, Parramatta NSW 2150", -33.8150, 151.0010)),
                List.of(
                    new Price("1", "E10", 1899, "21/11/2026 08:00:00"),
                    new Price("2", "E10", 1859, "21/11/2026 08:10:00"),
                    new Price("3", "E10", 1799, "21/11/2026 07:00:00"),
                    new Price("1", "U91", 1959, "21/11/2026 08:00:00")),
                Instant.EPOCH);
        }
    }

    static class MutableClock extends Clock {
        Instant now = Instant.parse("2026-11-21T00:00:00Z");

        @Override
        public java.time.ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }

    private static FuelPriceService.Query near(String fuelType) {
        return new FuelPriceService.Query(fuelType, LAT, LNG, null, 5, 5);
    }

    @Test
    void nearbyCheapestFirstWithinRadius() {
        var service = new FuelPriceService(new FakeSource(), new MutableClock());
        var result = service.nearby(near("E10"));
        // Parramatta 約 20 公里外，不在 5 公里內
        assertEquals(List.of("Ampol Surry Hills", "BP City"),
            result.stations().stream().map(FuelPriceService.Station::name).toList());
        assertEquals(1859, result.stations().get(0).priceTenths());
        assertTrue(result.stations().get(0).distanceKm() < 3);
        assertFalse(result.stale());
    }

    @Test
    void filtersByPostcodeAndFuelType() {
        var service = new FuelPriceService(new FakeSource(), new MutableClock());
        var result = service.nearby(new FuelPriceService.Query("E10", null, null, "2150", 5, 5));
        assertEquals(1, result.stations().size());
        assertEquals("Shell Parramatta", result.stations().get(0).name());
        assertEquals(null, result.stations().get(0).distanceKm());
        assertEquals(1, service.nearby(new FuelPriceService.Query("U91", LAT, LNG, null, 5, 5)).stations().size());
    }

    @Test
    void callsTheApiAtMostOncePerHour() {
        var source = new FakeSource();
        var clock = new MutableClock();
        var service = new FuelPriceService(source, clock);
        service.nearby(near("E10"));
        service.nearby(near("U91"));
        clock.now = clock.now.plus(Duration.ofMinutes(59));
        service.nearby(near("E10"));
        assertEquals(1, source.calls);
        clock.now = clock.now.plus(Duration.ofMinutes(2));
        service.nearby(near("E10"));
        assertEquals(2, source.calls);
    }

    @Test
    void servesStaleDataAndBacksOffWhenTheApiFails() {
        var source = new FakeSource();
        var clock = new MutableClock();
        var service = new FuelPriceService(source, clock);
        service.nearby(near("E10"));
        source.fail = true;
        clock.now = clock.now.plus(Duration.ofHours(2));
        assertTrue(service.nearby(near("E10")).stale());
        clock.now = clock.now.plus(Duration.ofMinutes(5));
        service.nearby(near("E10"));
        assertEquals(2, source.calls); // 失敗後 10 分鐘內不重試
    }

    @Test
    void unavailableWhenNotConfiguredOrNoDataYet() {
        var source = new FakeSource();
        source.configured = false;
        assertThrows(FuelPriceService.Unavailable.class,
            () -> new FuelPriceService(source, new MutableClock()).nearby(near("E10")));
        assertEquals(0, source.calls);

        var failing = new FakeSource();
        failing.fail = true;
        assertThrows(FuelPriceService.Unavailable.class,
            () -> new FuelPriceService(failing, new MutableClock()).nearby(near("E10")));
    }

    @Test
    void rejectsInvalidQueries() {
        var service = new FuelPriceService(new FakeSource(), new MutableClock());
        assertThrows(IllegalArgumentException.class, () -> service.nearby(near("WATER")));
        assertThrows(IllegalArgumentException.class,
            () -> service.nearby(new FuelPriceService.Query("E10", null, null, "20", 5, 5)));
        assertThrows(IllegalArgumentException.class,
            () -> service.nearby(new FuelPriceService.Query("E10", LAT, LNG, null, 100, 5)));
        assertThrows(IllegalArgumentException.class,
            () -> service.nearby(new FuelPriceService.Query("E10", LAT, LNG, null, 5, 50)));
    }

    @Test
    void postcodeMatchesOnlyTheEndOfTheAddress() {
        assertTrue(FuelPriceService.matchesPostcode("3 Church St, Parramatta NSW 2150", "2150"));
        assertFalse(FuelPriceService.matchesPostcode("2150 Great Western Hwy, Somewhere NSW 2770", "2150"));
    }

    @Test
    void parsesAllPricesResponse() {
        var client = new NswFuelApiClient("https://example.invalid", "", "", JsonMapper.builder().build());
        assertFalse(client.configured());
        var snapshot = client.parseAllPrices("""
            {"stations":[{"brandid":"1","stationid":"9","brand":"BP","code":1234,"name":"BP Test",
              "address":"1 Test St, Sydney NSW 2000","location":{"latitude":-33.87,"longitude":151.2}}],
             "prices":[{"stationcode":1234,"fueltype":"E10","price":189.9,"lastupdated":"21/11/2026 08:00:00"},
                       {"stationcode":1234,"fueltype":"U91","price":0}]}
            """, Instant.EPOCH);
        assertEquals("BP Test", snapshot.stations().get("1234").name());
        assertEquals(1, snapshot.prices().size());
        assertEquals(1899, snapshot.prices().get(0).priceTenths());
        assertEquals("1234", snapshot.prices().get(0).stationCode());
    }
}
