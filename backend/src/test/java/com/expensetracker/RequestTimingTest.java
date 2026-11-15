package com.expensetracker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.PrintWriter;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.util.ArrayList;
import java.util.List;
import java.util.logging.Logger;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.support.StaticListableBeanFactory;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/** P0 效能量測：只計時、不改變行為，也不把 SQL 或個資寫進 log。 */
class RequestTimingTest {
    /** 假的 DataSource：記錄被呼叫的方法，回傳假的連線與 Statement */
    static final class FakeDataSource implements DataSource {
        final List<String> calls = new ArrayList<>();

        @Override
        public Connection getConnection() {
            calls.add("getConnection");
            PreparedStatement statement = (PreparedStatement) Proxy.newProxyInstance(getClass().getClassLoader(),
                new Class<?>[] { PreparedStatement.class }, (proxy, method, args) -> {
                    calls.add(method.getName());
                    return method.getName().equals("executeUpdate") ? 3 : null;
                });
            return (Connection) Proxy.newProxyInstance(getClass().getClassLoader(),
                new Class<?>[] { Connection.class }, (proxy, method, args) -> {
                    calls.add(method.getName());
                    return method.getName().equals("prepareStatement") ? statement : null;
                });
        }

        @Override public Connection getConnection(String u, String p) { return getConnection(); }
        @Override public PrintWriter getLogWriter() { return null; }
        @Override public void setLogWriter(PrintWriter out) {}
        @Override public void setLoginTimeout(int seconds) {}
        @Override public int getLoginTimeout() { return 0; }
        @Override public Logger getParentLogger() { return null; }
        @Override public <T> T unwrap(Class<T> type) { return null; }
        @Override public boolean isWrapperFor(Class<?> type) { return false; }
    }

    @Test
    void countsSqlAndCheckoutsInsideRequestWithoutChangingResults() throws Exception {
        var fake = new FakeDataSource();
        var timed = new TimedDataSource(fake);
        RequestTiming timing = RequestTiming.start();
        try {
            Connection connection = timed.getConnection();
            PreparedStatement statement = connection.prepareStatement("UPDATE x SET y = 1");
            assertEquals(3, statement.executeUpdate());
            statement.close();
            connection.close();
        } finally {
            RequestTiming.clear();
        }
        assertEquals(1, timing.checkoutCount);
        assertEquals(1, timing.sqlCount);
        assertTrue(timing.sqlNanos >= 0);
        // 每個呼叫都原封不動轉給底層
        assertEquals(List.of("getConnection", "prepareStatement", "executeUpdate", "close", "close"), fake.calls);
    }

    @Test
    void connectionProxyKeepsIdentitySemantics() throws Exception {
        Connection connection = new TimedDataSource(new FakeDataSource()).getConnection();
        assertTrue(connection.equals(connection));
        assertFalse(connection.equals(new TimedDataSource(new FakeDataSource()).getConnection()));
        assertEquals(System.identityHashCode(connection), connection.hashCode());
    }

    @Test
    void ignoresSqlOutsideRequests() throws Exception {
        // 例如啟動時的 Flyway：沒有請求計數器，不應拋錯
        Connection connection = new TimedDataSource(new FakeDataSource()).getConnection();
        connection.prepareStatement("SELECT 1").executeUpdate();
    }

    private static RequestTimingFilter filter(boolean header) {
        return new RequestTimingFilter(header, new StaticListableBeanFactory().getBeanProvider(DataSource.class));
    }

    @Test
    void serverTimingHeaderIsOffByDefault() throws Exception {
        var response = new MockHttpServletResponse();
        filter(false).doFilter(new MockHttpServletRequest("GET", "/api/expenses"), response, new MockFilterChain());
        assertNull(response.getHeader("Server-Timing"));
    }

    @Test
    void serverTimingHeaderWhenEnabledKeepsBody() throws Exception {
        var response = new MockHttpServletResponse();
        var chain = new MockFilterChain(new jakarta.servlet.http.HttpServlet() {
            @Override
            protected void doGet(jakarta.servlet.http.HttpServletRequest req,
                                 jakarta.servlet.http.HttpServletResponse res) throws java.io.IOException {
                res.setContentType("application/json");
                res.getWriter().write("[]");
            }
        });
        filter(true).doFilter(new MockHttpServletRequest("GET", "/api/expenses"), response, chain);
        String header = response.getHeader("Server-Timing");
        assertNotNull(header);
        assertTrue(header.startsWith("app;dur="));
        assertTrue(header.contains("db;dur=") && header.contains("conn;dur="));
        assertEquals("[]", response.getContentAsString());
    }

    @Test
    void skipsHealthChecksAndStaticFiles() throws Exception {
        var health = new MockHttpServletResponse();
        filter(true).doFilter(new MockHttpServletRequest("GET", "/api/health"), health, new MockFilterChain());
        assertNull(health.getHeader("Server-Timing"));
        var other = new MockHttpServletResponse();
        filter(true).doFilter(new MockHttpServletRequest("GET", "/index.html"), other, new MockFilterChain());
        assertNull(other.getHeader("Server-Timing"));
    }

    @Test
    void unmatchedRoutesAreTruncatedSoIdsDoNotReachLogs() {
        assertEquals("/api/expenses/…", RequestTimingFilter.coarse("/api/expenses/abc-123/payments"));
        assertEquals("/api/auth", RequestTimingFilter.coarse("/api/auth"));
    }

    @Test
    void wrapsOnlyOnce() {
        var processor = PerformanceDiagnostics.timedDataSourcePostProcessor();
        Object wrapped = processor.postProcessAfterInitialization(new FakeDataSource(), "dataSource");
        assertTrue(wrapped instanceof TimedDataSource);
        assertSame(wrapped, processor.postProcessAfterInitialization(wrapped, "dataSource"));
        Object other = new Object();
        assertSame(other, processor.postProcessAfterInitialization(other, "x"));
    }
}
