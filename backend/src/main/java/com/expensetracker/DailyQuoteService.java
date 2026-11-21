package com.expensetracker;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.random.RandomGenerator;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * 每日小語：每位會員每天一句，同一天重新整理不變，隔天換新；盡量避開最近 30 天看過的。
 * 目前只抽澳洲英文小句子（en-AU，V17），附中文翻譯與用法說明；V12 的中文小語保留在資料庫但不再抽。
 * <ul>
 *   <li>候選只取 id（約 100 筆），在程式裡隨機挑，不對整張表 ORDER BY random()。</li>
 *   <li>同時開兩個分頁：user_daily_quote 的 UNIQUE(user_seq, quote_date)＋ON CONFLICT 保證只有一筆。</li>
 *   <li>「換一句」每天最多 {@link #MAX_REFRESH} 次；換掉的句子也記在 user_quote_history，去重不受影響。</li>
 * </ul>
 */
@Service
public class DailyQuoteService {
    static final String LANGUAGE = "en-AU";
    static final int MAX_REFRESH = 10;
    static final int AVOID_DAYS = 30;
    static final int HISTORY_DAYS = 60;
    private final JdbcTemplate db;
    private final RandomGenerator random;

    @Autowired
    DailyQuoteService(JdbcTemplate db) {
        // SecureRandom 在 java.base，正式環境的精簡 JRE 一定有；
        // 預設的 L32X64MixRandom 在 jdk.random 模組，容器裡可能沒有，會讓整個服務啟動失敗
        this(db, new java.security.SecureRandom());
    }

    DailyQuoteService(JdbcTemplate db, RandomGenerator random) {
        this.db = db;
        this.random = random;
    }

    @Transactional
    public Map<String, Object> today(long owner, LocalDate date) {
        var current = current(owner, date);
        if (current != null) return current;
        long quoteId = pick(owner, date, null);
        int inserted = db.update("""
            INSERT INTO user_daily_quote(user_seq, quote_id, quote_date) VALUES (?, ?, ?)
            ON CONFLICT (user_seq, quote_date) DO NOTHING
            """, owner, quoteId, date);
        if (inserted > 0) remember(owner, quoteId, date);
        return current(owner, date); // 另一個分頁先寫入時，回傳那一句
    }

    @Transactional
    public Map<String, Object> refresh(long owner, LocalDate date) {
        var current = today(owner, date);
        long previous = ((Number) current.get("quoteId")).longValue();
        long next = pick(owner, date, previous);
        int updated = db.update("""
            UPDATE user_daily_quote SET quote_id = ?, refresh_count = refresh_count + 1, updated_at = now()
            WHERE user_seq = ? AND quote_date = ? AND refresh_count < ?
            """, next, owner, date, MAX_REFRESH);
        if (updated == 0)
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "今天已經換了很多句，明天再來看看新的一句吧");
        remember(owner, next, date);
        return current(owner, date);
    }

    /** 訪客：依日期固定一句，不寫資料庫。 */
    public Map<String, Object> sample(LocalDate date) {
        List<Long> ids = activeIds();
        if (ids.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "目前沒有小語");
        long id = ids.get(Math.floorMod(date.toEpochDay() * 31 + 7, ids.size()));
        var quote = quote(id);
        quote.put("quoteDate", date.toString());
        quote.put("refreshesLeft", 0);
        return quote;
    }

    /**
     * 依序放寬：避開最近 30 天看過的 → 最近 7 天 → 只避開目前這句 → 全部。
     * @param exclude 目前這一句（換一句時不能再抽到同一句）
     */
    long pick(long owner, LocalDate date, Long exclude) {
        List<Long> all = activeIds();
        if (all.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "目前沒有小語");
        for (int days : new int[] {AVOID_DAYS, 7, 0}) {
            List<Long> seen = days == 0 ? List.of() : db.queryForList("""
                SELECT DISTINCT quote_id FROM user_quote_history WHERE user_seq = ? AND shown_on > ?
                """, Long.class, owner, date.minusDays(days));
            List<Long> candidates = all.stream()
                .filter(id -> !seen.contains(id) && !id.equals(exclude)).toList();
            if (!candidates.isEmpty()) return candidates.get(random.nextInt(candidates.size()));
        }
        return all.get(random.nextInt(all.size()));
    }

    private List<Long> activeIds() {
        return db.queryForList("SELECT id FROM daily_quote WHERE is_active AND language = ? ORDER BY id",
            Long.class, LANGUAGE);
    }

    private void remember(long owner, long quoteId, LocalDate date) {
        db.update("""
            INSERT INTO user_quote_history(user_seq, quote_id, shown_on) VALUES (?, ?, ?) ON CONFLICT DO NOTHING
            """, owner, quoteId, date);
    }

    private Map<String, Object> current(long owner, LocalDate date) {
        var rows = db.query("""
            SELECT q.id, q.content, q.translation, q.note, q.category, q.language, q.author, q.source, q.source_type,
                u.refresh_count
            FROM user_daily_quote u JOIN daily_quote q ON q.id = u.quote_id
            WHERE u.user_seq = ? AND u.quote_date = ?
            """, (rs, row) -> {
                var quote = toQuote(rs);
                quote.put("refreshesLeft", Math.max(0, MAX_REFRESH - rs.getInt("refresh_count")));
                return quote;
            }, owner, date);
        if (rows.isEmpty()) return null;
        rows.get(0).put("quoteDate", date.toString());
        return rows.get(0);
    }

    private Map<String, Object> quote(long id) {
        return db.query("""
            SELECT id, content, translation, note, category, language, author, source, source_type
            FROM daily_quote WHERE id = ?
            """, (rs, row) -> toQuote(rs), id).get(0);
    }

    private static Map<String, Object> toQuote(java.sql.ResultSet rs) throws java.sql.SQLException {
        Map<String, Object> quote = new HashMap<>();
        quote.put("quoteId", rs.getLong("id"));
        quote.put("content", rs.getString("content"));
        quote.put("translation", rs.getString("translation"));
        quote.put("note", rs.getString("note"));
        quote.put("category", rs.getString("category"));
        quote.put("language", rs.getString("language"));
        quote.put("author", rs.getString("author"));
        quote.put("source", rs.getString("source"));
        quote.put("sourceType", rs.getString("source_type"));
        return quote;
    }

    /** 看過的紀錄只需要最近 30 天，保留 60 天後清除。 */
    @Scheduled(cron = "0 45 3 * * *", zone = "Australia/Sydney")
    public void purgeHistory() {
        db.update("DELETE FROM user_quote_history WHERE shown_on < CURRENT_DATE - ?", HISTORY_DAYS);
    }
}
