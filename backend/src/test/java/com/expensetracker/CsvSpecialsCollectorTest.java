package com.expensetracker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class CsvSpecialsCollectorTest {
    @Test
    void reportsMissingRequiredColumnsAndKeepsLineNumbers() {
        var missing = CsvSpecialsCollector.parse("name,sale_price\nMilk,1\n", "CSV", "x");
        assertTrue(missing.records().isEmpty());
        assertTrue(missing.errors().contains("缺少必要欄位：external_product_id"));
        var ok = CsvSpecialsCollector.parse(WoolworthsProductNormalizerTest.HEADER
            + "\n1,Milk,,,,,1,,,2026-11-19,2026-11-25,\n", "CSV", "x");
        assertEquals(3, ok.records().getFirst().line());
    }

    @Test
    void handlesQuotesAndCrlf() {
        var records = CsvSpecialsCollector.records("a,b\r\n\"x \"\"y\"\"\",\"line\nbreak\"\r\n");
        assertEquals(List.of("a", "b"), records.get(0));
        assertEquals(List.of("x \"y\"", "line\nbreak"), records.get(1));
    }

    @Test
    void feedOnlyAcceptsHttpsOrLocalhostAndHidesPathInSourceName() {
        assertFalse(new CsvFeedSpecialsCollector("", "", null).configured());
        assertFalse(new CsvFeedSpecialsCollector("http://example.com/a.csv", "", null).configured());
        var feed = new CsvFeedSpecialsCollector("https://docs.example.com/sheet/pub?key=secret", "", null);
        assertTrue(feed.configured());
        assertEquals("feed:docs.example.com", feed.sourceName());
    }

    @Test
    void feedDownloadsCsvAndSendsBearerToken() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicReference<String> auth = new AtomicReference<>();
        server.createContext("/specials.csv", exchange -> {
            auth.set(exchange.getRequestHeaders().getFirst("Authorization"));
            byte[] body = (WoolworthsProductNormalizerTest.HEADER + "1,Milk,,,,,1,,,2026-11-19,2026-11-25,\n")
                .getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.createContext("/missing.csv", exchange -> {
            exchange.sendResponseHeaders(404, -1);
            exchange.close();
        });
        server.start();
        try {
            String base = "http://127.0.0.1:" + server.getAddress().getPort();
            var collected = new CsvFeedSpecialsCollector(base + "/specials.csv", "feed-secret").collect();
            assertEquals("FEED", collected.sourceType());
            assertEquals(1, collected.records().size());
            assertEquals("Bearer feed-secret", auth.get());
            var error = org.junit.jupiter.api.Assertions.assertThrows(java.io.IOException.class,
                () -> new CsvFeedSpecialsCollector(base + "/missing.csv", "").collect());
            assertEquals("資料源回應 HTTP 404", error.getMessage());
        } finally {
            server.stop(0);
        }
    }
}
