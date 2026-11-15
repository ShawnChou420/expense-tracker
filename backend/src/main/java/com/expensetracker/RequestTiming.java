package com.expensetracker;

/**
 * 單一請求的效能計數（同一個執行緒內累加）：SQL 執行時間與次數、從連線池取得連線的等待時間。
 * 只記錄時間與次數，不記錄 SQL 內容或參數，避免把會員資料寫進 log。
 * 由 {@link RequestTimingFilter} 在請求開始時重設、結束時讀取。
 */
final class RequestTiming {
    private static final ThreadLocal<RequestTiming> CURRENT = new ThreadLocal<>();

    long sqlNanos;
    int sqlCount;
    long checkoutNanos;
    int checkoutCount;

    private RequestTiming() {}

    static RequestTiming start() {
        RequestTiming timing = new RequestTiming();
        CURRENT.set(timing);
        return timing;
    }

    static void clear() {
        CURRENT.remove();
    }

    /** 不在請求內（例如啟動時的 Flyway）就不記錄 */
    static void addSql(long nanos) {
        RequestTiming timing = CURRENT.get();
        if (timing == null) return;
        timing.sqlNanos += nanos;
        timing.sqlCount++;
    }

    static void addCheckout(long nanos) {
        RequestTiming timing = CURRENT.get();
        if (timing == null) return;
        timing.checkoutNanos += nanos;
        timing.checkoutCount++;
    }

    static double millis(long nanos) {
        return Math.round(nanos / 100_000.0) / 10.0;
    }
}
