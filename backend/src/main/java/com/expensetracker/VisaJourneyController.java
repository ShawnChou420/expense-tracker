package com.expensetracker;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * 會員的集簽追蹤設定。只保存使用者輸入的目標與簽證資料；
 * 進度由前端依班表即時估算（src/domain/visaJourney.js），這裡不保存任何「完成天數」。
 */
@RestController
@RequestMapping("/api/visa-journey")
public class VisaJourneyController {
    static final List<String> GOALS = List.of("SECOND", "THIRD", "NONE");
    static final List<String> SUBCLASSES = List.of("417", "462");
    static final List<String> STAGES = List.of("FIRST", "SECOND", "BRIDGING");
    private final JdbcTemplate db;

    VisaJourneyController(JdbcTemplate db) {
        this.db = db;
    }

    /** 尚未設定時回傳 {"journey": null}，前端據此顯示首次設定 */
    @GetMapping
    Map<String, Object> get(Authentication auth) {
        var rows = db.query("""
            SELECT goal, visa_subclass, visa_stage, stay_until, work_start, started, history_dismissed
            FROM visa_journey WHERE user_seq = ?
            """, (rs, row) -> {
                Map<String, Object> journey = new HashMap<>();
                journey.put("goal", rs.getString("goal"));
                journey.put("subclass", rs.getString("visa_subclass"));
                journey.put("stage", rs.getString("visa_stage"));
                var stayUntil = rs.getDate("stay_until");
                var workStart = rs.getDate("work_start");
                journey.put("stayUntil", stayUntil == null ? null : stayUntil.toLocalDate().toString());
                journey.put("workStart", workStart == null ? null : workStart.toLocalDate().toString());
                journey.put("started", rs.getBoolean("started"));
                journey.put("historyDismissed", rs.getBoolean("history_dismissed"));
                return journey;
            }, LedgerController.owner(auth));
        Map<String, Object> result = new HashMap<>();
        result.put("journey", rows.isEmpty() ? null : rows.get(0));
        return result;
    }

    @PutMapping
    Map<String, Object> save(Authentication auth, @RequestBody Map<String, Object> body) {
        Journey journey = validate(body);
        db.update("""
            INSERT INTO visa_journey(user_seq, goal, visa_subclass, visa_stage, stay_until, work_start,
              started, history_dismissed)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (user_seq) DO UPDATE SET goal = EXCLUDED.goal,
              visa_subclass = EXCLUDED.visa_subclass, visa_stage = EXCLUDED.visa_stage,
              stay_until = EXCLUDED.stay_until, work_start = EXCLUDED.work_start,
              started = EXCLUDED.started, history_dismissed = EXCLUDED.history_dismissed,
              updated_at = now()
            """, LedgerController.owner(auth), journey.goal, journey.subclass, journey.stage,
            journey.stayUntil, journey.workStart, journey.started, journey.historyDismissed);
        return get(auth);
    }

    record Journey(String goal, String subclass, String stage, LocalDate stayUntil, LocalDate workStart,
                   boolean started, boolean historyDismissed) {}

    static Journey validate(Map<String, Object> body) {
        if (body == null) throw bad("集簽設定格式無效");
        String goal = choice(body.get("goal"), GOALS, false, "請選擇集簽目標");
        boolean tracking = !"NONE".equals(goal);
        // 不集簽時其他欄位可以空白；集簽時只要求必要資料
        String subclass = choice(body.get("subclass"), SUBCLASSES, !tracking, "請選擇簽證類型（417 或 462）");
        String stage = choice(body.get("stage"), STAGES, !tracking, "請選擇目前的簽證階段");
        LocalDate stayUntil = date(body.get("stayUntil"), !tracking, "請輸入簽證 Stay until 日期");
        LocalDate workStart = date(body.get("workStart"), !tracking, "請輸入指定工作開始日期");
        if (stayUntil != null && workStart != null && workStart.isAfter(stayUntil))
            throw bad("指定工作開始日期不可晚於 Stay until");
        return new Journey(goal, subclass, stage, stayUntil, workStart,
            Boolean.TRUE.equals(body.get("started")), Boolean.TRUE.equals(body.get("historyDismissed")));
    }

    private static String choice(Object value, List<String> allowed, boolean optional, String message) {
        if (value == null && optional) return null;
        if (!(value instanceof String text) || !allowed.contains(text)) throw bad(message);
        return text;
    }

    private static LocalDate date(Object value, boolean optional, String message) {
        if (value == null && optional) return null;
        if (!(value instanceof String text)) throw bad(message);
        try {
            LocalDate date = LocalDate.parse(text);
            if (!date.toString().equals(text)) throw new IllegalArgumentException();
            return date;
        } catch (RuntimeException exception) {
            throw bad(message);
        }
    }

    private static ResponseStatusException bad(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}
