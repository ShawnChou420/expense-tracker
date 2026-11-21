package com.expensetracker;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * api.nsw FuelCheck v1（NSW 油價）。
 *
 * <p>流程：用 API Key／Secret（Basic）換 OAuth access token，再以 token＋apikey 呼叫
 * 「Get All Prices」取回全部加油站與油價。端點網址與標頭依 FuelCheck v1 的格式，
 * 需以 api.nsw 官方文件（Postman collection）確認；base URL 可用 NSW_FUEL_API_BASE_URL 覆寫。
 *
 * <p>API Key／Secret 只從環境變數讀取（NSW_FUEL_API_KEY、NSW_FUEL_API_SECRET），不寫進程式或紀錄。
 */
@Component
class NswFuelApiClient implements FuelPriceSource {
    private static final DateTimeFormatter REQUEST_TIMESTAMP =
        DateTimeFormatter.ofPattern("dd/MM/yyyy hh:mm:ss a", Locale.ENGLISH).withZone(ZoneOffset.UTC);
    private static final Duration TIMEOUT = Duration.ofSeconds(20);

    private final String baseUrl;
    private final String apiKey;
    private final String apiSecret;
    private final ObjectMapper json;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(TIMEOUT).build();

    private String accessToken;
    private Instant tokenExpiresAt = Instant.EPOCH;

    NswFuelApiClient(@Value("${NSW_FUEL_API_BASE_URL:https://api.onegov.nsw.gov.au}") String baseUrl,
                     @Value("${NSW_FUEL_API_KEY:}") String apiKey,
                     @Value("${NSW_FUEL_API_SECRET:}") String apiSecret,
                     ObjectMapper json) {
        this.baseUrl = baseUrl.replaceAll("/+$", "");
        this.apiKey = apiKey.trim();
        this.apiSecret = apiSecret.trim();
        this.json = json;
    }

    @Override
    public boolean configured() {
        return !apiKey.isEmpty() && !apiSecret.isEmpty();
    }

    @Override
    public synchronized Snapshot fetchAll() {
        if (!configured()) throw new IllegalStateException("油價服務尚未設定");
        HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + "/FuelPriceCheck/v1/fuel/prices"))
            .timeout(TIMEOUT)
            .header("Authorization", "Bearer " + token())
            .header("apikey", apiKey)
            .header("transactionid", UUID.randomUUID().toString())
            .header("requesttimestamp", REQUEST_TIMESTAMP.format(Instant.now()))
            .header("Content-Type", "application/json; charset=utf-8")
            .GET()
            .build();
        return parseAllPrices(send(request), Instant.now());
    }

    private String token() {
        if (accessToken != null && Instant.now().isBefore(tokenExpiresAt)) return accessToken;
        String basic = Base64.getEncoder()
            .encodeToString((apiKey + ":" + apiSecret).getBytes(StandardCharsets.UTF_8));
        HttpRequest request = HttpRequest.newBuilder(
                URI.create(baseUrl + "/oauth/client_credential/accesstoken?grant_type=client_credentials"))
            .timeout(TIMEOUT)
            .header("Authorization", "Basic " + basic)
            .GET()
            .build();
        JsonNode body = json.readTree(send(request));
        String token = body.path("access_token").asString("");
        if (token.isEmpty()) throw new IllegalStateException("油價服務驗證失敗");
        long expiresIn = Math.max(60, body.path("expires_in").asLong(3600));
        accessToken = token;
        // 提早一分鐘換新，避免剛好在呼叫途中過期
        tokenExpiresAt = Instant.now().plusSeconds(expiresIn - 60);
        return token;
    }

    private String send(HttpRequest request) {
        try {
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() == 401) {
                accessToken = null; // 下次重新換 token
            }
            if (response.statusCode() / 100 != 2) {
                // 不把回應內容寫進例外，避免外洩任何驗證資訊
                throw new IllegalStateException("油價服務回應 " + response.statusCode());
            }
            return response.body();
        } catch (java.io.IOException exception) {
            throw new IllegalStateException("無法連線油價服務", exception);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("油價服務請求被中斷", exception);
        }
    }

    /** 解析 Get All Prices 回應：{ stations: [...], prices: [...] }。 */
    Snapshot parseAllPrices(String body, Instant fetchedAt) {
        JsonNode root = json.readTree(body);
        Map<String, Station> stations = new LinkedHashMap<>();
        for (JsonNode node : root.path("stations")) {
            String code = node.path("code").asString("");
            JsonNode location = node.path("location");
            if (code.isEmpty() || location.isMissingNode()) continue;
            stations.put(code, new Station(code,
                node.path("brand").asString(""),
                node.path("name").asString(""),
                node.path("address").asString(""),
                location.path("latitude").asDouble(),
                location.path("longitude").asDouble()));
        }
        List<Price> prices = new ArrayList<>();
        for (JsonNode node : root.path("prices")) {
            String stationCode = node.path("stationcode").asString("");
            double price = node.path("price").asDouble(-1);
            if (stationCode.isEmpty() || price <= 0) continue;
            prices.add(new Price(stationCode,
                node.path("fueltype").asString(""),
                (int) Math.round(price * 10),
                node.path("lastupdated").asString("")));
        }
        return new Snapshot(stations, prices, fetchedAt);
    }
}
