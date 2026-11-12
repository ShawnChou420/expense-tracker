package com.expensetracker;

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
import tools.jackson.databind.ObjectMapper;

/** 會員的工作設定（薪資設定狀態、班別、每週排班、Smoko）。內容格式由前端定義。 */
@RestController
@RequestMapping("/api/work-profile")
public class WorkProfileController {
    static final int MAX_PROFILE_CHARS = 20_000;
    private final JdbcTemplate db;
    private final ObjectMapper json;

    WorkProfileController(JdbcTemplate db, ObjectMapper json) {
        this.db = db;
        this.json = json;
    }

    /** 尚未設定時回傳 {"profile": null}，前端據此判斷是否為舊會員或新使用者 */
    @GetMapping
    Map<String, Object> get(Authentication auth) {
        var rows = db.query("SELECT profile_json::text FROM work_profile WHERE user_seq = ?",
            (rs, row) -> json.readValue(rs.getString(1), Map.class), LedgerController.owner(auth));
        java.util.HashMap<String, Object> result = new java.util.HashMap<>();
        result.put("profile", rows.isEmpty() ? null : rows.get(0));
        return result;
    }

    @PutMapping
    Map<String, Object> save(Authentication auth, @RequestBody Map<String, Object> body) {
        String text = validate(body, json.writeValueAsString(body));
        db.update("""
            INSERT INTO work_profile(user_seq, profile_json) VALUES (?, ?::jsonb)
            ON CONFLICT (user_seq) DO UPDATE SET profile_json = EXCLUDED.profile_json, updated_at = now()
            """, LedgerController.owner(auth), text);
        return Map.of("profile", body);
    }

    static String validate(Map<String, Object> body, String text) {
        if (body == null || body.isEmpty() || text.length() > MAX_PROFILE_CHARS)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "工作設定格式無效");
        Object status = body.get("payStatus");
        if (status != null && !Map.of("NOT_CONFIGURED", 1, "MANUAL_CONFIRMED", 1, "PAYSLIP_CONFIRMED", 1)
                .containsKey(String.valueOf(status)))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "工作設定格式無效");
        return text;
    }
}
