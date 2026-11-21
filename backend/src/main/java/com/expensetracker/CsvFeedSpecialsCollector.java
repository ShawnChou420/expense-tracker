package com.expensetracker;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 排程用的供應者：從環境變數 SPECIALS_FEED_URL 設定的 CSV 資料源網址拉取（例如自己維護、
 * 發佈成 CSV 的 Google 試算表，或日後取得授權的資料供應者）。只接受 https，限制大小與逾時；
 * 需要憑證時用 SPECIALS_FEED_TOKEN（以 Bearer 標頭送出，不寫進紀錄）。
 */
@Component
class CsvFeedSpecialsCollector implements WoolworthsSpecialsCollector {
    static final int MAX_BYTES = 2 * 1024 * 1024;
    static final Duration TIMEOUT = Duration.ofSeconds(20);

    private final String url;
    private final String token;
    private final HttpClient http;

    @Autowired
    CsvFeedSpecialsCollector(@Value("${app.specials.feed-url:}") String url,
                             @Value("${app.specials.feed-token:}") String token) {
        this(url, token, HttpClient.newBuilder().connectTimeout(TIMEOUT)
            .followRedirects(HttpClient.Redirect.NORMAL).build());
    }

    CsvFeedSpecialsCollector(String url, String token, HttpClient http) {
        this.url = url == null ? "" : url.trim();
        this.token = token == null ? "" : token.trim();
        this.http = http;
    }

    /** 只接受 https；http 只允許本機（開發與測試用） */
    @Override
    public boolean configured() {
        return url.startsWith("https://") || url.startsWith("http://localhost:") || url.startsWith("http://127.0.0.1:");
    }

    /** 給紀錄與狀態頁看的來源名稱：只有主機，不含路徑與查詢字串（可能含金鑰） */
    String sourceName() {
        try {
            return "feed:" + URI.create(url).getHost();
        } catch (RuntimeException exception) {
            return "feed";
        }
    }

    @Override
    public Collected collect() throws IOException, InterruptedException {
        if (!configured()) throw new IllegalStateException("尚未設定 SPECIALS_FEED_URL（必須是 https）");
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(url)).timeout(TIMEOUT)
            .header("Accept", "text/csv, text/plain;q=0.9, */*;q=0.1")
            .header("User-Agent", "expense-tracker-specials-sync/1.0");
        if (!token.isEmpty()) request.header("Authorization", "Bearer " + token);
        HttpResponse<InputStream> response = http.send(request.GET().build(), HttpResponse.BodyHandlers.ofInputStream());
        try (InputStream body = response.body()) {
            if (response.statusCode() != 200) throw new IOException("資料源回應 HTTP " + response.statusCode());
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int read;
            while ((read = body.read(buffer)) != -1) {
                if (out.size() + read > MAX_BYTES) throw new IOException("資料源超過 2 MB 上限");
                out.write(buffer, 0, read);
            }
            return CsvSpecialsCollector.parse(out.toString(StandardCharsets.UTF_8), "FEED", sourceName());
        }
    }
}
