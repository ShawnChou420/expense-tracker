package com.expensetracker;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/**
 * 管理後台 API。SecurityConfig 已限制 /api/admin/** 只有 SUPER_ADMIN 可進入；
 * 這裡每個方法再檢查一次（requireAdmin），避免設定被改錯時直接開放。
 *
 * <p>只回傳管理需要的非敏感資訊：不回傳密碼雜湊、token、薪資單原文、備註全文或完整請求內容。
 */
@RestController
@RequestMapping("/api/admin")
public class AdminController {
    static final int MAX_PAGE_SIZE = 100;

    private final JdbcTemplate db;
    private final AdminService admin;
    private final ActivityLog activity;
    private final ObjectMapper json;

    AdminController(JdbcTemplate db, AdminService admin, ActivityLog activity, ObjectMapper json) {
        this.db = db;
        this.admin = admin;
        this.activity = activity;
        this.json = json;
    }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Map<String, String>> safeError(ResponseStatusException exception) {
        return ResponseEntity.status(exception.getStatusCode())
            .body(Map.of("detail", exception.getReason() == null ? "請檢查輸入資料" : exception.getReason()));
    }

    /** 第二道防線：必須是 SUPER_ADMIN */
    static long requireAdmin(Authentication auth) {
        boolean ok = auth != null && auth.getPrincipal() instanceof Long
            && auth.getAuthorities().stream().anyMatch(a -> ("ROLE_" + AuthService.SUPER_ADMIN).equals(a.getAuthority()));
        if (!ok) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "需要管理員權限");
        return (Long) auth.getPrincipal();
    }

    static int pageSize(Integer size) {
        return size == null ? 20 : Math.max(1, Math.min(MAX_PAGE_SIZE, size));
    }

    static int page(Integer page) {
        return page == null ? 0 : Math.max(0, Math.min(10_000, page));
    }

    static LocalDate optionalDate(String value) {
        if (value == null || value.isBlank()) return null;
        try {
            return LocalDate.parse(value);
        } catch (RuntimeException exception) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "無效日期");
        }
    }

    /** LIKE 查詢用：跳脫 % 與 _ */
    static String likePattern(String text) {
        return "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
    }

    private Map<String, Object> details(String text) {
        try {
            return text == null ? Map.of() : json.readValue(text, Map.class);
        } catch (RuntimeException exception) {
            return Map.of();
        }
    }

    // ---------- 讀取 ----------

    @GetMapping("/overview")
    Map<String, Object> overview(Authentication auth) {
        requireAdmin(auth);
        Map<String, Object> users = db.queryForMap("""
            SELECT count(*) AS total,
              count(*) FILTER (WHERE account_status = 'ACTIVE') AS active,
              count(*) FILTER (WHERE account_status = 'DISABLED') AS disabled,
              count(*) FILTER (WHERE create_time > now() - interval '7 days') AS new_last_7_days,
              count(*) FILTER (WHERE last_login_at > now() - interval '7 days') AS active_last_7_days,
              (SELECT count(*) FROM user_role WHERE role = 'SUPER_ADMIN') AS admins
            FROM user_info
            """);
        Map<String, Object> events = db.queryForMap("""
            SELECT count(*) FILTER (WHERE occurred_at > now() - interval '24 hours') AS last_24h,
              count(*) FILTER (WHERE status = 'FAILURE' AND occurred_at > now() - interval '24 hours') AS failures_24h,
              count(*) FILTER (WHERE event_type = 'PAYSLIP_IMPORT_FAILED' AND occurred_at > now() - interval '7 days') AS payslip_failures_7d,
              count(*) FILTER (WHERE category IN ('API_ERROR', 'DATABASE') AND occurred_at > now() - interval '7 days') AS system_errors_7d
            FROM user_activity_event
            """);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("users", camel(users));
        result.put("events", camel(events));
        result.put("recentErrors", queryEvents(null, null, null, null, "FAILURE", null, 0, 10).get("items"));
        return result;
    }

    private static Map<String, Object> camel(Map<String, Object> row) {
        Map<String, Object> result = new LinkedHashMap<>();
        row.forEach((key, value) -> {
            StringBuilder name = new StringBuilder();
            boolean upper = false;
            for (char c : key.toCharArray()) {
                if (c == '_') upper = true;
                else {
                    name.append(upper ? Character.toUpperCase(c) : c);
                    upper = false;
                }
            }
            result.put(name.toString(), value);
        });
        return result;
    }

    private static final String USER_COLUMNS = """
        u.seq, u.email_normalized, u.nickname, u.account_status, u.create_time, u.last_login_at,
        u.email_verified_at IS NOT NULL AS email_verified,
        EXISTS (SELECT 1 FROM user_role r WHERE r.user_seq = u.seq AND r.role = 'SUPER_ADMIN') AS super_admin,
        (SELECT count(*) FROM work_shift_info w WHERE w.user_seq = u.seq) AS shift_count,
        (SELECT count(*) FROM expense_record e WHERE e.user_seq = u.seq) AS expense_count,
        (SELECT count(*) FROM payslip_import p WHERE p.user_seq = u.seq) AS payslip_count
        """;

    private static Map<String, Object> userRow(java.sql.ResultSet rs) throws java.sql.SQLException {
        Map<String, Object> user = new LinkedHashMap<>();
        user.put("seq", rs.getLong("seq"));
        user.put("email", rs.getString("email_normalized"));
        user.put("nickname", rs.getString("nickname"));
        user.put("status", rs.getString("account_status"));
        user.put("superAdmin", rs.getBoolean("super_admin"));
        user.put("emailVerified", rs.getBoolean("email_verified"));
        var created = rs.getTimestamp("create_time");
        var login = rs.getTimestamp("last_login_at");
        user.put("createdAt", created == null ? null : created.toInstant().toString());
        user.put("lastLoginAt", login == null ? null : login.toInstant().toString());
        user.put("shiftCount", rs.getLong("shift_count"));
        user.put("expenseCount", rs.getLong("expense_count"));
        user.put("payslipCount", rs.getLong("payslip_count"));
        return user;
    }

    @GetMapping("/users")
    Map<String, Object> users(Authentication auth, @RequestParam(required = false) String q,
                              @RequestParam(required = false) String status,
                              @RequestParam(required = false) Integer page,
                              @RequestParam(required = false) Integer size) {
        requireAdmin(auth);
        List<Object> args = new ArrayList<>();
        StringBuilder where = new StringBuilder(" WHERE 1=1");
        if (q != null && !q.isBlank()) {
            String text = q.strip();
            if (text.matches("\\d{1,18}")) {
                where.append(" AND (u.seq = ? OR u.email_normalized LIKE ? ESCAPE '\\')");
                args.add(Long.parseLong(text));
            } else where.append(" AND u.email_normalized LIKE ? ESCAPE '\\'");
            args.add(likePattern(text.toLowerCase(java.util.Locale.ROOT)));
        }
        if (status != null && List.of("ACTIVE", "DISABLED").contains(status)) {
            where.append(" AND u.account_status = ?");
            args.add(status);
        }
        int limit = pageSize(size);
        int offset = page(page) * limit;
        Long total = db.queryForObject("SELECT count(*) FROM user_info u" + where, Long.class, args.toArray());
        List<Object> pageArgs = new ArrayList<>(args);
        pageArgs.add(limit);
        pageArgs.add(offset);
        var items = db.query("SELECT " + USER_COLUMNS + " FROM user_info u" + where
            + " ORDER BY u.create_time DESC NULLS LAST, u.seq DESC LIMIT ? OFFSET ?", (rs, row) -> userRow(rs), pageArgs.toArray());
        return Map.of("items", items, "total", total == null ? 0 : total, "page", page(page), "size", limit);
    }

    @GetMapping("/users/{seq}")
    Map<String, Object> user(Authentication auth, @PathVariable long seq) {
        requireAdmin(auth);
        var rows = db.query("SELECT " + USER_COLUMNS + """
            , (SELECT goal FROM visa_journey v WHERE v.user_seq = u.seq) AS visa_goal,
              EXISTS (SELECT 1 FROM work_profile p WHERE p.user_seq = u.seq
                AND p.profile_json->>'scheduleStatus' = 'CONFIGURED') AS work_setup
            FROM user_info u WHERE u.seq = ?
            """, (rs, row) -> {
                Map<String, Object> user = userRow(rs);
                user.put("visaGoal", rs.getString("visa_goal"));
                user.put("workSetup", rs.getBoolean("work_setup"));
                return user;
            }, seq);
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "找不到這位會員");
        return rows.get(0);
    }

    @GetMapping("/users/{seq}/events")
    Map<String, Object> userEvents(Authentication auth, @PathVariable long seq,
                                   @RequestParam(required = false) Integer page,
                                   @RequestParam(required = false) Integer size) {
        requireAdmin(auth);
        return queryEvents(null, null, seq, null, null, null, page(page), pageSize(size));
    }

    @GetMapping("/events")
    Map<String, Object> events(Authentication auth,
                               @RequestParam(required = false) String from,
                               @RequestParam(required = false) String to,
                               @RequestParam(required = false) Long userSeq,
                               @RequestParam(required = false) String type,
                               @RequestParam(required = false) String status,
                               @RequestParam(required = false) String category,
                               @RequestParam(required = false) Integer page,
                               @RequestParam(required = false) Integer size) {
        requireAdmin(auth);
        return queryEvents(optionalDate(from), optionalDate(to), userSeq, type, status, category, page(page), pageSize(size));
    }

    private Map<String, Object> queryEvents(LocalDate from, LocalDate to, Long userSeq, String type, String status,
                                            String category, int page, int size) {
        List<Object> args = new ArrayList<>();
        StringBuilder where = new StringBuilder(" WHERE 1=1");
        // 日期以雪梨時間計算
        if (from != null) {
            where.append(" AND e.occurred_at >= (?::date)::timestamp AT TIME ZONE 'Australia/Sydney'");
            args.add(java.sql.Date.valueOf(from));
        }
        if (to != null) {
            where.append(" AND e.occurred_at < ((?::date) + 1)::timestamp AT TIME ZONE 'Australia/Sydney'");
            args.add(java.sql.Date.valueOf(to));
        }
        if (userSeq != null) {
            where.append(" AND e.user_seq = ?");
            args.add(userSeq);
        }
        if (type != null && type.matches("[A-Z_]{1,40}")) {
            where.append(" AND e.event_type = ?");
            args.add(type);
        }
        if (status != null && List.of("SUCCESS", "FAILURE").contains(status)) {
            where.append(" AND e.status = ?");
            args.add(status);
        }
        if (category != null && ActivityLog.CATEGORIES.contains(category)) {
            where.append(" AND e.category = ?");
            args.add(category);
        }
        Long total = db.queryForObject("SELECT count(*) FROM user_activity_event e" + where, Long.class, args.toArray());
        List<Object> pageArgs = new ArrayList<>(args);
        pageArgs.add(size);
        pageArgs.add(page * size);
        var items = db.query("""
            SELECT e.event_id, e.user_seq, u.email_normalized, e.category, e.event_type, e.status, e.error_code,
              e.request_id, e.details::text AS details, e.occurred_at
            FROM user_activity_event e LEFT JOIN user_info u ON u.seq = e.user_seq
            """ + where + " ORDER BY e.occurred_at DESC LIMIT ? OFFSET ?", (rs, row) -> {
                Map<String, Object> event = new LinkedHashMap<>();
                event.put("eventId", rs.getString("event_id"));
                long seq = rs.getLong("user_seq");
                event.put("userSeq", rs.wasNull() ? null : seq);
                event.put("email", rs.getString("email_normalized"));
                event.put("category", rs.getString("category"));
                event.put("type", rs.getString("event_type"));
                event.put("status", rs.getString("status"));
                event.put("errorCode", rs.getString("error_code"));
                event.put("requestId", rs.getString("request_id"));
                event.put("details", details(rs.getString("details")));
                event.put("occurredAt", rs.getTimestamp("occurred_at").toInstant().toString());
                return event;
            }, pageArgs.toArray());
        Map<String, Object> result = new HashMap<>();
        result.put("items", items);
        result.put("total", total == null ? 0 : total);
        result.put("page", page);
        result.put("size", size);
        return result;
    }

    @GetMapping("/audit")
    Map<String, Object> audit(Authentication auth, @RequestParam(required = false) Long targetSeq,
                              @RequestParam(required = false) Integer page,
                              @RequestParam(required = false) Integer size) {
        requireAdmin(auth);
        int limit = pageSize(size);
        int offset = page(page) * limit;
        String where = targetSeq == null ? "" : " WHERE a.target_seq = ?";
        Object[] countArgs = targetSeq == null ? new Object[0] : new Object[] { targetSeq };
        Long total = db.queryForObject("SELECT count(*) FROM admin_audit_log a" + where, Long.class, countArgs);
        List<Object> args = new ArrayList<>(List.of(countArgs));
        args.add(limit);
        args.add(offset);
        var items = db.query("""
            SELECT a.audit_id, a.admin_seq, admin.email_normalized AS admin_email, a.target_seq,
              target.email_normalized AS target_email, a.action, a.reason, a.result, a.details::text AS details,
              a.request_id, a.occurred_at
            FROM admin_audit_log a
            LEFT JOIN user_info admin ON admin.seq = a.admin_seq
            LEFT JOIN user_info target ON target.seq = a.target_seq
            """ + where + " ORDER BY a.occurred_at DESC LIMIT ? OFFSET ?", (rs, row) -> {
                Map<String, Object> entry = new LinkedHashMap<>();
                entry.put("auditId", rs.getString("audit_id"));
                long adminSeq = rs.getLong("admin_seq");
                entry.put("adminSeq", rs.wasNull() ? null : adminSeq);
                entry.put("adminEmail", rs.getString("admin_email"));
                long target = rs.getLong("target_seq");
                entry.put("targetSeq", rs.wasNull() ? null : target);
                entry.put("targetEmail", rs.getString("target_email"));
                entry.put("action", rs.getString("action"));
                entry.put("reason", rs.getString("reason"));
                entry.put("result", rs.getString("result"));
                entry.put("details", details(rs.getString("details")));
                entry.put("requestId", rs.getString("request_id"));
                entry.put("occurredAt", rs.getTimestamp("occurred_at").toInstant().toString());
                return entry;
            }, args.toArray());
        return Map.of("items", items, "total", total == null ? 0 : total, "page", page(page), "size", limit);
    }

    // ---------- 操作（需要原因；敏感操作需要再次輸入密碼） ----------

    record ProfileRequest(String nickname, String reason) {}
    record SensitiveRequest(String reason, String password) {}
    record RoleRequest(Boolean superAdmin, String reason, String password) {}
    record DeleteRequest(String reason, String password, String confirmEmail) {}

    @PutMapping("/users/{seq}/profile")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void updateProfile(Authentication auth, @PathVariable long seq, @RequestBody ProfileRequest body) {
        long adminSeq = requireAdmin(auth);
        if (body == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "請檢查輸入資料");
        admin.updateNickname(adminSeq, seq, body.nickname(), body.reason());
    }

    @PostMapping("/users/{seq}/disable")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void disable(Authentication auth, @PathVariable long seq, @RequestBody SensitiveRequest body) {
        long adminSeq = requireAdmin(auth);
        if (body == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "請檢查輸入資料");
        admin.setStatus(adminSeq, seq, false, body.reason(), body.password());
    }

    @PostMapping("/users/{seq}/enable")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void enable(Authentication auth, @PathVariable long seq, @RequestBody SensitiveRequest body) {
        long adminSeq = requireAdmin(auth);
        if (body == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "請檢查輸入資料");
        admin.setStatus(adminSeq, seq, true, body.reason(), body.password());
    }

    @PutMapping("/users/{seq}/role")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void role(Authentication auth, @PathVariable long seq, @RequestBody RoleRequest body) {
        long adminSeq = requireAdmin(auth);
        if (body == null || body.superAdmin() == null)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "請檢查輸入資料");
        admin.setSuperAdmin(adminSeq, seq, body.superAdmin(), body.reason(), body.password());
    }

    @PostMapping("/users/{seq}/delete")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void delete(Authentication auth, @PathVariable long seq, @RequestBody DeleteRequest body) {
        long adminSeq = requireAdmin(auth);
        if (body == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "請檢查輸入資料");
        admin.deleteUser(adminSeq, seq, body.reason(), body.password(), body.confirmEmail());
        activity.record(seq, "USER", "ACCOUNT_DELETED", true, null, Map.of("by", "ADMIN"));
    }
}
