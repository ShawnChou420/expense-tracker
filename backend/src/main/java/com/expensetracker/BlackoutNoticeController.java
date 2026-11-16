package com.expensetracker;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * 禁休公告（期間＋主管公告全文）。只是提醒，不影響薪資或集簽天數。
 * 所有查詢都以驗證身分的 user_seq 限定，不接受前端傳來的會員編號。
 */
@RestController
@RequestMapping("/api/blackout-notices")
public class BlackoutNoticeController {
    static final int TITLE_MAX = 120;
    static final int BODY_MAX = 5000;
    private final JdbcTemplate db;

    BlackoutNoticeController(JdbcTemplate db) {
        this.db = db;
    }

    @GetMapping
    List<Map<String, String>> list(Authentication auth) {
        return db.query("""
            SELECT client_id, start_date, end_date, title, body FROM leave_blackout_notice
            WHERE user_seq = ? ORDER BY start_date, client_id
            """, (rs, row) -> Map.of(
                "id", rs.getString("client_id"),
                "startDate", rs.getDate("start_date").toLocalDate().toString(),
                "endDate", rs.getDate("end_date").toLocalDate().toString(),
                "title", rs.getString("title"),
                "body", rs.getString("body")), LedgerController.owner(auth));
    }

    @PutMapping("/{id}")
    Map<String, String> save(Authentication auth, @PathVariable String id, @RequestBody Map<String, Object> body) {
        String clientId = LedgerController.clientId(id);
        if (body == null) throw bad("公告格式無效");
        LocalDate start = date(body.get("startDate"), "請選擇禁休開始日");
        LocalDate end = date(body.get("endDate"), "請選擇禁休結束日");
        if (end.isBefore(start)) throw bad("禁休結束日不可早於開始日");
        String title = text(body.get("title"), TITLE_MAX, "公告標題不可超過 " + TITLE_MAX + " 字");
        String content = text(body.get("body"), BODY_MAX, "公告全文不可超過 " + BODY_MAX + " 字");
        db.update("""
            INSERT INTO leave_blackout_notice(user_seq, client_id, start_date, end_date, title, body)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (user_seq, client_id) DO UPDATE SET start_date = EXCLUDED.start_date,
              end_date = EXCLUDED.end_date, title = EXCLUDED.title, body = EXCLUDED.body, updated_at = now()
            """, LedgerController.owner(auth), clientId, start, end, title, content);
        return Map.of("id", clientId, "startDate", start.toString(), "endDate", end.toString(),
            "title", title, "body", content);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void delete(Authentication auth, @PathVariable String id) {
        db.update("DELETE FROM leave_blackout_notice WHERE user_seq = ? AND client_id = ?",
            LedgerController.owner(auth), LedgerController.clientId(id));
    }

    private static LocalDate date(Object value, String message) {
        if (!(value instanceof String text)) throw bad(message);
        try {
            LocalDate date = LocalDate.parse(text);
            if (!date.toString().equals(text)) throw new IllegalArgumentException();
            return date;
        } catch (RuntimeException exception) {
            throw bad(message);
        }
    }

    private static String text(Object value, int max, String message) {
        if (value == null) return "";
        if (!(value instanceof String text)) throw bad("公告格式無效");
        String trimmed = text.replace("\r\n", "\n").trim();
        if (trimmed.length() > max) throw bad(message);
        return trimmed;
    }

    private static ResponseStatusException bad(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}
