package com.expensetracker;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * 每日備註與心情（每人每天一筆）。這是私人紀錄：
 * 只能由本人讀寫、不寫進活動紀錄或伺服器 log、管理後台不提供查看、不傳給任何外部服務。
 */
@RestController
@RequestMapping("/api/daily-journal")
public class DailyJournalController {
    static final List<String> MOODS = List.of("GREAT", "OKAY", "TIRED", "LOW", "STRESSED");
    static final int MAX_CONTENT = 2000;
    private final JdbcTemplate db;

    DailyJournalController(JdbcTemplate db) {
        this.db = db;
    }

    @GetMapping
    Map<String, Object> get(Authentication auth, @RequestParam String date) {
        return find(LedgerController.owner(auth), LocalDay.parse(date, "date"));
    }

    /** 只更新有傳的欄位：只點心情不會清掉備註，只存備註也不會清掉心情。mood 傳 null 代表取消選擇。 */
    @PutMapping("/{date}")
    @Transactional
    Map<String, Object> save(Authentication auth, @PathVariable String date, @RequestBody Map<String, Object> body) {
        long owner = LedgerController.owner(auth);
        LocalDate day = LocalDay.parse(date, "date");
        if (!body.containsKey("content") && !body.containsKey("mood"))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "沒有要保存的內容");
        var current = find(owner, day);
        String content = body.containsKey("content") ? content(body.get("content")) : (String) current.get("content");
        String mood = body.containsKey("mood") ? mood(body.get("mood")) : (String) current.get("mood");
        db.update("""
            INSERT INTO daily_journal(user_seq, journal_date, content, mood) VALUES (?, ?, ?, ?)
            ON CONFLICT (user_seq, journal_date) DO UPDATE SET content = EXCLUDED.content, mood = EXCLUDED.mood,
              updated_at = now()
            """, owner, day, content, mood);
        return find(owner, day);
    }

    static String content(Object value) {
        if (value == null) return "";
        if (!(value instanceof String text))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "備註格式不正確");
        if (text.length() > MAX_CONTENT)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "備註最多 " + MAX_CONTENT + " 個字");
        return text;
    }

    static String mood(Object value) {
        if (value == null) return null;
        if (!(value instanceof String text) || !MOODS.contains(text))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "無效的心情選項");
        return text;
    }

    /** 沒有紀錄時回傳空內容（saved = false），不回 404，前端直接顯示空白輸入。 */
    Map<String, Object> find(long owner, LocalDate date) {
        var rows = db.query("""
            SELECT content, mood, updated_at FROM daily_journal WHERE user_seq = ? AND journal_date = ?
            """, (rs, row) -> {
                Map<String, Object> journal = new HashMap<>();
                journal.put("content", rs.getString("content"));
                journal.put("mood", rs.getString("mood"));
                journal.put("updatedAt", rs.getTimestamp("updated_at").toInstant().toString());
                journal.put("saved", true);
                return journal;
            }, owner, date);
        Map<String, Object> journal = rows.isEmpty() ? new HashMap<>() : rows.get(0);
        if (rows.isEmpty()) {
            journal.put("content", "");
            journal.put("mood", null);
            journal.put("updatedAt", null);
            journal.put("saved", false);
        }
        journal.put("date", date.toString());
        return journal;
    }
}
