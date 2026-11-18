package com.expensetracker;

import com.zaxxer.hikari.HikariDataSource;
import com.zaxxer.hikari.HikariPoolMXBean;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.lang.management.ManagementFactory;
import java.util.Locale;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.servlet.HandlerMapping;
import org.springframework.web.util.ContentCachingResponseWrapper;

/**
 * P0 效能排查：每個 API 請求寫一行 TIMING log（Render → Logs 搜尋 "TIMING"）。
 *
 * <p>內容只有方法、路由樣板（例如 /api/expenses/{id}）、狀態碼、耗時、SQL 次數、連線池狀態與
 * JVM 已執行秒數（判斷是不是剛冷啟動），不含 Email、token、參數或回應內容。
 * 排在安全性 filter 之前，所以 token 驗證的 SQL 也算在內。
 *
 * <p>{@code app.server-timing.enabled=true} 時另外回傳 {@code Server-Timing} 標頭，讓瀏覽器
 * 開發者工具與前端量測看得到伺服器端拆解。預設關閉，只在量測期間暫時打開。
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 1)
public class RequestTimingFilter extends OncePerRequestFilter {
    private static final Logger log = LoggerFactory.getLogger("TIMING");
    private final boolean serverTimingHeader;
    private final ObjectProvider<DataSource> dataSource;
    private volatile HikariPoolMXBean pool;

    RequestTimingFilter(@Value("${app.server-timing.enabled:false}") boolean serverTimingHeader,
                        ObjectProvider<DataSource> dataSource) {
        this.serverTimingHeader = serverTimingHeader;
        this.dataSource = dataSource;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        // Render 健康檢查很頻繁，不記錄以免洗版
        return !request.getRequestURI().startsWith("/api/") || "/api/health".equals(request.getRequestURI());
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        long start = System.nanoTime();
        String requestId = requestId(request.getHeader("X-Request-Id"));
        response.setHeader("X-Request-Id", requestId);
        RequestTiming timing = RequestTiming.start(requestId);
        org.slf4j.MDC.put("requestId", requestId);
        ContentCachingResponseWrapper buffered =
            serverTimingHeader ? new ContentCachingResponseWrapper(response) : null;
        try {
            chain.doFilter(request, buffered == null ? response : buffered);
        } finally {
            long total = System.nanoTime() - start;
            RequestTiming.clear();
            org.slf4j.MDC.remove("requestId");
            if (buffered != null) {
                if (!buffered.isCommitted()) buffered.setHeader("Server-Timing", serverTiming(timing, total));
                buffered.copyBodyToResponse();
            }
            log.info(line(request, response.getStatus(), timing, total));
        }
    }

    static String serverTiming(RequestTiming timing, long totalNanos) {
        return String.format(Locale.ROOT, "app;dur=%.1f, db;dur=%.1f;desc=\"%d queries\", conn;dur=%.1f",
            RequestTiming.millis(totalNanos), RequestTiming.millis(timing.sqlNanos), timing.sqlCount,
            RequestTiming.millis(timing.checkoutNanos));
    }

    private String line(HttpServletRequest request, int status, RequestTiming timing, long totalNanos) {
        Object pattern = request.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE);
        // 沒有對應到 controller（例如 401 在安全性 filter 就被擋下）時路徑可能含 ID，只保留前兩段
        String route = pattern != null ? pattern.toString() : coarse(request.getRequestURI());
        return String.format(Locale.ROOT,
            "TIMING rid=%s %s %s status=%d total=%.1fms db=%.1fms queries=%d conn=%.1fms checkouts=%d pool=%s uptime=%ds",
            timing.requestId, request.getMethod(), route, status, RequestTiming.millis(totalNanos),
            RequestTiming.millis(timing.sqlNanos), timing.sqlCount, RequestTiming.millis(timing.checkoutNanos),
            timing.checkoutCount, poolState(), ManagementFactory.getRuntimeMXBean().getUptime() / 1000);
    }

    /** 前端帶來的 ID 格式正確就沿用，否則產生新的（只允許英數與連字號，避免寫入奇怪內容） */
    static String requestId(String header) {
        if (header != null && header.matches("[A-Za-z0-9-]{8,40}")) return header;
        return java.util.UUID.randomUUID().toString().substring(0, 13);
    }

    static String coarse(String uri) {
        String[] parts = uri.split("/");
        return parts.length <= 3 ? uri : String.join("/", parts[0], parts[1], parts[2], "…");
    }

    private String poolState() {
        HikariPoolMXBean bean = pool;
        if (bean == null) {
            try {
                DataSource source = dataSource.getIfAvailable();
                if (source != null && source.isWrapperFor(HikariDataSource.class))
                    bean = pool = source.unwrap(HikariDataSource.class).getHikariPoolMXBean();
            } catch (Exception ignored) {
                // 連線池還沒啟動或不是 Hikari，就不顯示
            }
        }
        if (bean == null) return "-";
        return "active:" + bean.getActiveConnections() + ",idle:" + bean.getIdleConnections()
            + ",waiting:" + bean.getThreadsAwaitingConnection() + ",total:" + bean.getTotalConnections();
    }
}
