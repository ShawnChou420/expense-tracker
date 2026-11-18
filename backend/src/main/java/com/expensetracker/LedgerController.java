package com.expensetracker;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.ArrayList;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

@RestController
@RequestMapping("/api")
public class LedgerController {
    private final JdbcTemplate db;
    private final ObjectMapper json;

    /** 活動事件紀錄；單元測試可以不提供 */
    private final ActivityLog activity;

    LedgerController(JdbcTemplate db, ObjectMapper json) {
        this(db, json, null);
    }

    @org.springframework.beans.factory.annotation.Autowired
    LedgerController(JdbcTemplate db, ObjectMapper json, ActivityLog activity) {
        this.db = db;
        this.json = json;
        this.activity = activity;
    }

    private void event(long userSeq, String type, Map<String, ?> details) {
        if (activity != null) activity.success(userSeq, type, details);
    }

    static long owner(Authentication auth) {
        return (Long) auth.getPrincipal();
    }

    static String clientId(String id) {
        if (id == null || !id.matches("[A-Za-z0-9_-]{1,100}"))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "無效紀錄 ID");
        return id;
    }

    static String text(Map<String, Object> body, String name) {
        Object value = body.get(name);
        if (!(value instanceof String string) || string.isBlank())
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "缺少必要欄位：" + name);
        return string;
    }

    static LocalDate date(Map<String, Object> body, String name) {
        try {
            return LocalDate.parse(text(body, name));
        } catch (Exception exception) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "無效日期：" + name);
        }
    }

    static long cents(Object value, boolean allowZero) {
        try {
            long amount = new BigDecimal(String.valueOf(value)).longValueExact();
            if (amount < 0 || (!allowZero && amount == 0)) throw new ArithmeticException();
            return amount;
        } catch (Exception exception) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "無效金額");
        }
    }

    static long dollarsToCents(Object value) {
        try {
            return new BigDecimal(String.valueOf(value)).multiply(BigDecimal.valueOf(100))
                .setScale(0, RoundingMode.HALF_UP).longValueExact();
        } catch (Exception exception) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "無效薪資金額");
        }
    }

    @GetMapping("/work-records")
    List<Map> workRecords(Authentication auth) {
        return db.query("SELECT record_json::text FROM work_shift_info WHERE user_seq = ? AND record_json IS NOT NULL ORDER BY work_date, seq",
            (rs, row) -> json.readValue(rs.getString(1), Map.class), owner(auth));
    }

    /** 請假類型與資料來源：只接受已知值，避免任意字串寫進紀錄 */
    static final List<String> LEAVE_TYPES = List.of("PERSONAL", "SICK", "HOLIDAY", "UNPAID_OTHER", "REST_DAY");
    static final List<String> RECORD_SOURCES = List.of("HISTORICAL_USER_CONFIRMED");
    /** 一次批次保存的上限（另有 256 KB 請求大小限制） */
    static final int MAX_BATCH = 200;

    static void validateRecordMeta(Map<String, Object> body) {
        Object leaveType = body.get("leaveType");
        if (leaveType != null && !LEAVE_TYPES.contains(leaveType))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "無效請假類型");
        Object source = body.get("source");
        if (source != null && !RECORD_SOURCES.contains(source))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "無效紀錄來源");
    }

    @PutMapping("/work-records/{id}")
    @Transactional
    Map<String, Object> saveWorkRecord(Authentication auth, @PathVariable String id,
                                       @RequestBody Map<String, Object> body) {
        boolean created = upsertWorkRecord(owner(auth), id, body);
        event(owner(auth), created ? "SHIFT_CREATED" : "SHIFT_UPDATED", Map.of("count", 1));
        return body;
    }

    /**
     * 批次保存班表（例如補登歷史班表）。整批在同一個交易內：任何一筆無效就全部不寫入。
     * 每筆的驗證與單筆保存完全相同。
     */
    @PostMapping("/work-records/batch")
    @Transactional
    Map<String, Object> saveWorkRecords(Authentication auth, @RequestBody List<Map<String, Object>> records) {
        if (records == null || records.isEmpty() || records.size() > MAX_BATCH)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "一次最多保存 " + MAX_BATCH + " 筆班表");
        long userSeq = owner(auth);
        var ids = new java.util.HashSet<String>();
        for (Map<String, Object> record : records) {
            if (record == null || !ids.add(String.valueOf(record.get("id"))))
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "批次中有重複的紀錄 ID");
        }
        int created = 0;
        for (Map<String, Object> record : records)
            if (upsertWorkRecord(userSeq, String.valueOf(record.get("id")), record)) created += 1;
        // 全部是補登的歷史班表 → 記成集簽補登；其他批次記新增／更新筆數
        boolean history = records.stream().allMatch(record -> "HISTORICAL_USER_CONFIRMED".equals(record.get("source")));
        if (history) event(userSeq, "VISA_HISTORY_IMPORTED", Map.of("count", records.size(), "created", created));
        else {
            if (created > 0) event(userSeq, "SHIFT_CREATED", Map.of("count", created));
            if (records.size() > created) event(userSeq, "SHIFT_UPDATED", Map.of("count", records.size() - created));
        }
        return Map.of("saved", records.size());
    }

    /** 新增或更新一筆班表；回傳是否為新增 */
    private boolean upsertWorkRecord(long userSeq, String rawId, Map<String, Object> body) {
        String id = clientId(rawId);
        if (body == null || !id.equals(String.valueOf(body.get("id"))))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "紀錄 ID 不一致");
        validateRecordMeta(body);
        LocalDate workDate = date(body, "workDate");
        LocalTime start;
        LocalTime end;
        try {
            start = LocalTime.parse(text(body, "startTime"));
            end = LocalTime.parse(text(body, "endTime"));
        } catch (Exception exception) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "無效班別時間");
        }
        long grossCents = dollarsToCents(body.get("grossPay"));
        if (grossCents < 0) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "薪資不可為負");
        int totalMinutes = ((Number) body.getOrDefault("totalMinutes", 0)).intValue();
        int smokoCount = ((Number) body.getOrDefault("smokoCount", 0)).intValue();
        Boolean inserted = db.queryForObject("""
            INSERT INTO work_shift_info(user_seq, client_id, work_date, start_time, end_time,
              total_minutes, smoko_count, gross_pay, gross_cents, record_json, designated_work, currency)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, 'AUD')
            ON CONFLICT (user_seq, client_id) WHERE client_id IS NOT NULL DO UPDATE SET
              work_date=EXCLUDED.work_date, start_time=EXCLUDED.start_time,
              end_time=EXCLUDED.end_time, total_minutes=EXCLUDED.total_minutes,
              smoko_count=EXCLUDED.smoko_count, gross_pay=EXCLUDED.gross_pay,
              gross_cents=EXCLUDED.gross_cents, record_json=EXCLUDED.record_json,
              designated_work=EXCLUDED.designated_work, update_time=now()
            RETURNING (xmax = 0) AS inserted
            """, Boolean.class, userSeq, id, workDate, start, end, totalMinutes, smokoCount,
            BigDecimal.valueOf(grossCents, 2), grossCents, json.writeValueAsString(body),
            Boolean.TRUE.equals(body.get("designatedWork")));
        return Boolean.TRUE.equals(inserted);
    }

    @DeleteMapping("/work-records/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void deleteWorkRecord(Authentication auth, @PathVariable String id) {
        db.update("DELETE FROM work_shift_info WHERE user_seq = ? AND client_id = ?", owner(auth), clientId(id));
    }

    @GetMapping("/expenses")
    List<Map> expenses(Authentication auth) {
        long userSeq = owner(auth);
        // 一次讀出此會員所有付款紀錄再分組，不再每筆支出各查一次（N+1），也不會同時占用兩條連線
        Map<Long, List<Map<String, Object>>> paymentsByExpense = new java.util.HashMap<>();
        db.query("""
            SELECT expense_seq, occurrence_date, paid_on, amount_cents FROM expense_payment
            WHERE user_seq = ? ORDER BY expense_seq, occurrence_date
            """, (org.springframework.jdbc.core.RowCallbackHandler) paymentRs ->
                paymentsByExpense.computeIfAbsent(paymentRs.getLong("expense_seq"), key -> new ArrayList<>())
                    .add(Map.<String, Object>of(
                        "occurrenceDate", paymentRs.getDate("occurrence_date").toLocalDate().toString(),
                        "paidAt", paymentRs.getDate("paid_on").toLocalDate().toString(),
                        "amountCents", paymentRs.getLong("amount_cents"))), userSeq);
        return db.query("SELECT seq, record_json::text FROM expense_record WHERE user_seq = ? AND record_json IS NOT NULL ORDER BY expense_date, seq",
            (rs, row) -> {
                Map record = json.readValue(rs.getString("record_json"), Map.class);
                var payments = paymentsByExpense.getOrDefault(rs.getLong("seq"), List.of());
                record.put("payments", payments);
                if (!"NONE".equals(record.get("frequency"))) {
                    record.put("paidDates", payments.stream().map(payment -> payment.get("occurrenceDate")).toList());
                } else {
                    record.put("status", payments.isEmpty() ? "PLANNED" : "PAID");
                }
                return record;
            }, userSeq);
    }

    @PutMapping("/expenses/{id}")
    @Transactional
    Map<String, Object> saveExpense(Authentication auth, @PathVariable String id,
                                     @RequestBody Map<String, Object> body) {
        id = clientId(id);
        if (!id.equals(String.valueOf(body.get("id"))))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "紀錄 ID 不一致");
        LocalDate expenseDate = date(body, "date");
        long amount = cents(body.get("amountCents"), false);
        String category = text(body, "category");
        String group = text(body, "group");
        String status = text(body, "status");
        String frequency = text(body, "frequency");
        if (!List.of("PAID", "PLANNED").contains(status) ||
            !List.of("NONE", "WEEKLY", "BIWEEKLY", "MONTHLY", "CUSTOM").contains(frequency))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "無效支出狀態或頻率");
        Object[] saved = db.queryForObject("""
            INSERT INTO expense_record(user_seq, client_id, expense_date, category, amount,
              amount_cents, group_code, status_code, frequency_code, record_json, remark, currency)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, 'AUD')
            ON CONFLICT (user_seq, client_id) WHERE client_id IS NOT NULL DO UPDATE SET
              expense_date=EXCLUDED.expense_date, category=EXCLUDED.category,
              amount=EXCLUDED.amount, amount_cents=EXCLUDED.amount_cents,
              group_code=EXCLUDED.group_code, status_code=EXCLUDED.status_code,
              frequency_code=EXCLUDED.frequency_code, record_json=EXCLUDED.record_json,
              remark=EXCLUDED.remark, update_time=now()
            RETURNING seq, (xmax = 0) AS inserted
            """, (rs, row) -> new Object[] { rs.getLong(1), rs.getBoolean(2) }, owner(auth), id, expenseDate, category, BigDecimal.valueOf(amount, 2),
            amount, group, status, frequency, json.writeValueAsString(body), body.get("note"));
        Long expenseSeq = (Long) saved[0];
        event(owner(auth), Boolean.TRUE.equals(saved[1]) ? "EXPENSE_CREATED" : "EXPENSE_UPDATED",
            Map.of("frequency", frequency, "status", status));
        List<LocalDate> desired = new ArrayList<>();
        if (frequency.equals("NONE")) {
            if (status.equals("PAID")) desired.add(expenseDate);
        } else if (body.get("paidDates") instanceof List<?> dates) {
            for (Object value : dates) {
                try { desired.add(LocalDate.parse(String.valueOf(value))); }
                catch (Exception exception) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "無效付款日期");
                }
            }
        }
        for (LocalDate occurrence : desired) {
            LocalDate paidOn = occurrence.equals(expenseDate) && body.get("paidAt") != null
                ? date(body, "paidAt") : occurrence;
            db.update("""
                INSERT INTO expense_payment(user_seq, expense_seq, occurrence_date, paid_on,
                  amount_cents, currency) VALUES (?, ?, ?, ?, ?, 'AUD')
                ON CONFLICT (expense_seq, occurrence_date) DO NOTHING
                """, owner(auth), expenseSeq, occurrence, paidOn, amount);
            if (occurrence.equals(expenseDate) && body.get("paidAt") != null) {
                db.update("""
                    UPDATE expense_payment SET paid_on=? WHERE user_seq=? AND expense_seq=?
                      AND occurrence_date=?
                    """, paidOn, owner(auth), expenseSeq, occurrence);
            }
        }
        var stored = db.query("SELECT occurrence_date FROM expense_payment WHERE user_seq=? AND expense_seq=?",
            (rs, row) -> rs.getDate(1).toLocalDate(), owner(auth), expenseSeq);
        for (LocalDate occurrence : stored) {
            if (!desired.contains(occurrence)) {
                db.update("DELETE FROM expense_payment WHERE user_seq=? AND expense_seq=? AND occurrence_date=?",
                    owner(auth), expenseSeq, occurrence);
            }
        }
        return body;
    }

    @DeleteMapping("/expenses/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void deleteExpense(Authentication auth, @PathVariable String id) {
        db.update("DELETE FROM expense_record WHERE user_seq = ? AND client_id = ?", owner(auth), clientId(id));
    }
}
