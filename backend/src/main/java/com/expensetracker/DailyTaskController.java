package com.expensetracker;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * 每日待辦。重複待辦是一條規則（daily_task），每一天的那一次不預先產生資料列，
 * 由 {@link #occursOn} 即時推算；重複待辦的完成狀態以「哪一天」存在 daily_task_completion。
 * 所有查詢都以登入 token 的 user_seq 為範圍，不接受前端指定會員。
 */
@RestController
@RequestMapping("/api/daily-tasks")
public class DailyTaskController {
    static final List<String> REPEAT_TYPES = List.of("NONE", "DAILY", "WEEKLY", "MONTHLY");
    static final int MAX_TITLE = 80;
    static final int MAX_DESCRIPTION = 500;
    static final int MAX_TASKS = 500;
    private final JdbcTemplate db;

    DailyTaskController(JdbcTemplate db) {
        this.db = db;
    }

    /** 規則在某一天有沒有一次：每週同一個星期幾、每月同一天（該月沒有這天就用月底）。 */
    static boolean occursOn(String repeatType, LocalDate start, LocalDate date) {
        if (date.isBefore(start)) return false;
        return switch (repeatType) {
            case "DAILY" -> true;
            case "WEEKLY" -> date.getDayOfWeek() == start.getDayOfWeek();
            case "MONTHLY" -> date.getDayOfMonth() == Math.min(start.getDayOfMonth(), date.lengthOfMonth());
            default -> date.equals(start);
        };
    }

    @GetMapping
    List<Map<String, Object>> list(Authentication auth, @RequestParam String date) {
        return tasksFor(LedgerController.owner(auth), LocalDay.parse(date, "date"));
    }

    /** 今天以前還沒完成的單次待辦（不會自動刪除、不會自動改日期）。 */
    @GetMapping("/overdue")
    List<Map<String, Object>> overdue(Authentication auth, @RequestParam String today) {
        return overdueFor(LedgerController.owner(auth), LocalDay.parse(today, "today"));
    }

    List<Map<String, Object>> tasksFor(long owner, LocalDate date) {
        var rules = db.query("""
            SELECT id, title, description, task_date, repeat_type, is_completed, completed_at
            FROM daily_task
            WHERE user_seq = ? AND ((repeat_type = 'NONE' AND task_date = ?) OR (repeat_type <> 'NONE' AND task_date <= ?))
            ORDER BY created_at, id
            """, (rs, row) -> row(rs), owner, date, date);
        Set<Long> doneRecurring = new HashSet<>(db.queryForList(
            "SELECT task_id FROM daily_task_completion WHERE user_seq = ? AND occurrence_date = ?",
            Long.class, owner, date));
        List<Map<String, Object>> result = new ArrayList<>();
        for (var task : rules) {
            String repeat = (String) task.get("repeatType");
            if (!occursOn(repeat, LocalDate.parse((String) task.get("taskDate")), date)) continue;
            if (!"NONE".equals(repeat)) task.put("completed", doneRecurring.contains((Long) task.get("id")));
            task.put("occurrenceDate", date.toString());
            result.add(task);
        }
        return result;
    }

    List<Map<String, Object>> overdueFor(long owner, LocalDate today) {
        return db.query("""
            SELECT id, title, description, task_date, repeat_type, is_completed, completed_at
            FROM daily_task
            WHERE user_seq = ? AND repeat_type = 'NONE' AND is_completed = FALSE AND task_date < ?
            ORDER BY task_date, id LIMIT 50
            """, (rs, row) -> {
                var task = row(rs);
                task.put("occurrenceDate", task.get("taskDate"));
                return task;
            }, owner, today);
    }

    private static Map<String, Object> row(java.sql.ResultSet rs) throws java.sql.SQLException {
        Map<String, Object> task = new HashMap<>();
        task.put("id", rs.getLong("id"));
        task.put("title", rs.getString("title"));
        task.put("description", rs.getString("description"));
        task.put("taskDate", rs.getDate("task_date").toLocalDate().toString());
        task.put("repeatType", rs.getString("repeat_type"));
        task.put("completed", rs.getBoolean("is_completed"));
        var completedAt = rs.getTimestamp("completed_at");
        task.put("completedAt", completedAt == null ? null : completedAt.toInstant().toString());
        return task;
    }

    static String title(Object value) {
        if (!(value instanceof String text) || text.isBlank())
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "請輸入待辦內容");
        String trimmed = text.strip();
        if (trimmed.length() > MAX_TITLE)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "待辦內容最多 " + MAX_TITLE + " 個字");
        return trimmed;
    }

    static String description(Object value) {
        if (value == null) return "";
        if (!(value instanceof String text) || text.length() > MAX_DESCRIPTION)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "備註最多 " + MAX_DESCRIPTION + " 個字");
        return text.strip();
    }

    static String repeatType(Object value) {
        if (value == null) return "NONE";
        if (!(value instanceof String text) || !REPEAT_TYPES.contains(text))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "無效的重複設定");
        return text;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    Map<String, Object> create(Authentication auth, @RequestBody Map<String, Object> body) {
        long owner = LedgerController.owner(auth);
        String title = title(body.get("title"));
        String description = description(body.get("description"));
        LocalDate date = LocalDay.parse(body.get("taskDate"), "taskDate");
        String repeat = repeatType(body.get("repeatType"));
        Integer count = db.queryForObject("SELECT count(*) FROM daily_task WHERE user_seq = ?", Integer.class, owner);
        if (count != null && count >= MAX_TASKS)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "待辦已達上限，請先刪除不需要的項目");
        Long id = db.queryForObject("""
            INSERT INTO daily_task(user_seq, title, description, task_date, repeat_type)
            VALUES (?, ?, ?, ?, ?) RETURNING id
            """, Long.class, owner, title, description, date, repeat);
        return find(owner, id == null ? -1 : id, date);
    }

    /**
     * 修改內容、日期、重複設定，或勾選／取消完成。
     * 勾選重複待辦時需提供 occurrenceDate（只影響那一天）；單次待辦直接改本列。
     */
    @PatchMapping("/{id}")
    @Transactional
    Map<String, Object> update(Authentication auth, @PathVariable long id, @RequestBody Map<String, Object> body) {
        long owner = LedgerController.owner(auth);
        var current = find(owner, id, null);
        String repeat = (String) current.get("repeatType");
        LocalDate date = LocalDate.parse((String) current.get("taskDate"));
        if (body.containsKey("title") || body.containsKey("description") || body.containsKey("taskDate")
                || body.containsKey("repeatType")) {
            String title = body.containsKey("title") ? title(body.get("title")) : (String) current.get("title");
            String description = body.containsKey("description") ? description(body.get("description"))
                : (String) current.get("description");
            date = body.containsKey("taskDate") ? LocalDay.parse(body.get("taskDate"), "taskDate") : date;
            repeat = body.containsKey("repeatType") ? repeatType(body.get("repeatType")) : repeat;
            db.update("""
                UPDATE daily_task SET title = ?, description = ?, task_date = ?, repeat_type = ?, updated_at = now()
                WHERE id = ? AND user_seq = ?
                """, title, description, date, repeat, id, owner);
        }
        LocalDate occurrence = null;
        if (body.containsKey("completed")) {
            if (!(body.get("completed") instanceof Boolean completed))
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "completed 必須是 true 或 false");
            if ("NONE".equals(repeat)) {
                db.update("""
                    UPDATE daily_task SET is_completed = ?, completed_at = CASE WHEN ? THEN now() END, updated_at = now()
                    WHERE id = ? AND user_seq = ?
                    """, completed, completed, id, owner);
            } else {
                occurrence = LocalDay.parse(body.get("occurrenceDate"), "occurrenceDate");
                if (!occursOn(repeat, date, occurrence))
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "這個待辦在那一天沒有排定");
                if (completed) db.update("""
                    INSERT INTO daily_task_completion(task_id, user_seq, occurrence_date) VALUES (?, ?, ?)
                    ON CONFLICT DO NOTHING
                    """, id, owner, occurrence);
                else db.update("DELETE FROM daily_task_completion WHERE task_id = ? AND user_seq = ? AND occurrence_date = ?",
                    id, owner, occurrence);
            }
        }
        return find(owner, id, occurrence);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void delete(Authentication auth, @PathVariable long id) {
        long owner = LedgerController.owner(auth);
        // 刪除重複待辦會一併刪除它每一天的完成紀錄（FK cascade）
        if (db.update("DELETE FROM daily_task WHERE id = ? AND user_seq = ?", id, owner) == 0)
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "找不到這個待辦");
    }

    /** 只找得到自己的待辦；別人的 id 一律 404（不透露是否存在）。 */
    private Map<String, Object> find(long owner, long id, LocalDate occurrence) {
        var rows = db.query("""
            SELECT id, title, description, task_date, repeat_type, is_completed, completed_at
            FROM daily_task WHERE id = ? AND user_seq = ?
            """, (rs, row) -> row(rs), id, owner);
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "找不到這個待辦");
        var task = rows.get(0);
        if (occurrence != null && !"NONE".equals(task.get("repeatType"))) {
            Integer done = db.queryForObject("""
                SELECT count(*) FROM daily_task_completion WHERE task_id = ? AND user_seq = ? AND occurrence_date = ?
                """, Integer.class, id, owner, occurrence);
            task.put("completed", done != null && done > 0);
            task.put("occurrenceDate", occurrence.toString());
        }
        return task;
    }
}
