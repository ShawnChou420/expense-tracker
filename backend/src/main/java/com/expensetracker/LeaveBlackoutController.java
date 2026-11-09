package com.expensetracker;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;
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

@RestController
@RequestMapping("/api/leave-blackouts")
public class LeaveBlackoutController {
    private final JdbcTemplate db;

    LeaveBlackoutController(JdbcTemplate db) {
        this.db = db;
    }

    private static LocalDate parseDate(String value) {
        try {
            LocalDate date = LocalDate.parse(value);
            if (!date.toString().equals(value)) throw new IllegalArgumentException();
            return date;
        } catch (DateTimeParseException | IllegalArgumentException exception) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "無效日期");
        }
    }

    @GetMapping
    List<Map<String, String>> list(Authentication auth) {
        return db.query("""
            SELECT block_date, reason FROM leave_blackout
            WHERE user_seq = ? ORDER BY block_date
            """, (rs, row) -> Map.of(
                "date", rs.getDate("block_date").toLocalDate().toString(),
                "reason", rs.getString("reason")), LedgerController.owner(auth));
    }

    @PutMapping("/{date}")
    Map<String, String> save(Authentication auth, @PathVariable String date,
                             @RequestBody Map<String, Object> body) {
        LocalDate blockDate = parseDate(date);
        Object rawReason = body.get("reason");
        if (rawReason != null && !(rawReason instanceof String))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "無效禁休說明");
        String reason = rawReason == null ? "" : ((String) rawReason).trim();
        if (reason.length() > 240)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "禁休說明不可超過 240 字");
        db.update("""
            INSERT INTO leave_blackout(user_seq, block_date, reason) VALUES (?, ?, ?)
            ON CONFLICT (user_seq, block_date) DO UPDATE SET reason = EXCLUDED.reason,
              updated_at = now()
            """, LedgerController.owner(auth), blockDate, reason);
        return Map.of("date", date, "reason", reason);
    }

    @DeleteMapping("/{date}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void delete(Authentication auth, @PathVariable String date) {
        db.update("DELETE FROM leave_blackout WHERE user_seq = ? AND block_date = ?",
            LedgerController.owner(auth), parseDate(date));
    }
}
