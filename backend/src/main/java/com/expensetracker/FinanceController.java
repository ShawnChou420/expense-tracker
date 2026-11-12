package com.expensetracker;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
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

@RestController
@RequestMapping("/api")
public class FinanceController {
    private final JdbcTemplate db;

    FinanceController(JdbcTemplate db) {
        this.db = db;
    }

    private static long signedCents(Object value) {
        try {
            return new BigDecimal(String.valueOf(value)).longValueExact();
        } catch (Exception exception) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "無效金額");
        }
    }

    private static BigDecimal rate(Object value, BigDecimal max) {
        try {
            BigDecimal result = new BigDecimal(String.valueOf(value));
            if (result.signum() < 0 || result.compareTo(max) > 0 || result.scale() > 4)
                throw new IllegalArgumentException();
            return result;
        } catch (Exception exception) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "無效薪資費率");
        }
    }

    /**
     * 加成費率：前端從薪資單確認過的實際費率優先；沒有提供時沿用「基本時薪 × 預設倍率」。
     */
    static BigDecimal derivedRate(Map<String, Object> body, String key, BigDecimal base, String multiplier) {
        Object value = body.get(key);
        return value == null ? base.multiply(new BigDecimal(multiplier)) : rate(value, new BigDecimal("1000"));
    }

    @GetMapping("/salary-rates")
    Map<String, Object> salaryRates(Authentication auth) {
        var rows = db.query("""
            SELECT base_rate, casual_loading_rate, shift_loading_rate, saturday_ord_loading_rate,
              sunday_loading_rate, time_half_rate, double_rate, ppe_allowance, withholding_tax_rate
            FROM salary_setting_info WHERE user_seq=?
            """, (rs, row) -> {
                Map<String, Object> rates = new HashMap<>();
                rates.put("baseRate", rs.getBigDecimal("base_rate"));
                rates.put("casualLoadingRate", rs.getBigDecimal("casual_loading_rate"));
                rates.put("shiftLoadingRate", rs.getBigDecimal("shift_loading_rate"));
                rates.put("saturdayOrdLoadingRate", rs.getBigDecimal("saturday_ord_loading_rate"));
                rates.put("sundayLoadingRate", rs.getBigDecimal("sunday_loading_rate"));
                rates.put("timeHalfRate", rs.getBigDecimal("time_half_rate"));
                rates.put("doubleRate", rs.getBigDecimal("double_rate"));
                rates.put("ppeAllowance", rs.getBigDecimal("ppe_allowance"));
                rates.put("withholdingTaxRate", rs.getBigDecimal("withholding_tax_rate"));
                return rates;
            },
            LedgerController.owner(auth));
        return rows.isEmpty() ? Map.of() : rows.get(0);
    }

    @PutMapping("/salary-rates")
    Map<String, Object> saveSalaryRates(Authentication auth, @RequestBody Map<String, Object> body) {
        BigDecimal base = rate(body.get("baseRate"), new BigDecimal("1000"));
        BigDecimal ppe = rate(body.get("ppeAllowance"), new BigDecimal("1000"));
        BigDecimal tax = rate(body.get("withholdingTaxRate"), BigDecimal.ONE);
        BigDecimal casual = derivedRate(body, "casualLoadingRate", base, "0.25");
        BigDecimal shift = derivedRate(body, "shiftLoadingRate", base, "0.25");
        BigDecimal saturday = derivedRate(body, "saturdayOrdLoadingRate", base, "0.5");
        BigDecimal sunday = derivedRate(body, "sundayLoadingRate", base, "0.75");
        BigDecimal timeHalf = derivedRate(body, "timeHalfRate", base, "1.5");
        BigDecimal doubleTime = derivedRate(body, "doubleRate", base, "2.0");
        db.update("""
            INSERT INTO salary_setting_info(user_seq, base_rate, casual_loading_rate,
              shift_loading_rate, saturday_ord_loading_rate, sunday_loading_rate,
              time_half_rate, double_rate, ppe_allowance, withholding_tax_rate, currency)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'AUD')
            ON CONFLICT (user_seq) DO UPDATE SET base_rate=EXCLUDED.base_rate,
              casual_loading_rate=EXCLUDED.casual_loading_rate,
              shift_loading_rate=EXCLUDED.shift_loading_rate,
              saturday_ord_loading_rate=EXCLUDED.saturday_ord_loading_rate,
              sunday_loading_rate=EXCLUDED.sunday_loading_rate,
              time_half_rate=EXCLUDED.time_half_rate, double_rate=EXCLUDED.double_rate,
              ppe_allowance=EXCLUDED.ppe_allowance,
              withholding_tax_rate=EXCLUDED.withholding_tax_rate, update_time=now()
            """, LedgerController.owner(auth), base, casual, shift, saturday, sunday,
            timeHalf, doubleTime, ppe, tax);
        return Map.of("baseRate", base, "ppeAllowance", ppe, "withholdingTaxRate", tax);
    }

    @GetMapping("/dashboard-settings")
    Map<String, Object> dashboardSettings(Authentication auth) {
        long owner = LedgerController.owner(auth);
        Map<String, Object> result = new HashMap<>();
        var currencies = db.query("SELECT display_currency FROM user_preferences WHERE user_seq=?",
            (rs, row) -> rs.getString(1), owner);
        result.put("displayCurrency", currencies.isEmpty() ? "AUD" : currencies.get(0).trim());
        var targets = db.query("SELECT work_day_target FROM user_preferences WHERE user_seq=?",
            (rs, row) -> rs.getObject(1), owner);
        result.put("workDayTarget", targets.isEmpty() ? null : targets.get(0));
        var goals = db.query("""
            SELECT name, target_cents, initial_cents, start_date, end_date FROM saving_goal
            WHERE user_seq=?
            """, (rs, row) -> {
                Map<String, Object> goal = new HashMap<>();
                goal.put("name", rs.getString("name"));
                goal.put("targetCents", rs.getLong("target_cents"));
                goal.put("initialCents", rs.getLong("initial_cents"));
                goal.put("startDate", rs.getDate("start_date").toLocalDate().toString());
                goal.put("endDate", rs.getDate("end_date") == null ? null :
                    rs.getDate("end_date").toLocalDate().toString());
                return goal;
            }, owner);
        result.put("savingGoal", goals.isEmpty() ? null : goals.get(0));
        return result;
    }

    @PutMapping("/dashboard-settings/display-currency")
    Map<String, String> saveDisplayCurrency(Authentication auth, @RequestBody Map<String, Object> body) {
        String currency = LedgerController.text(body, "currency");
        if (!List.of("AUD", "TWD", "NZD", "CNY", "KRW", "THB", "VND", "USD", "CAD").contains(currency))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "不支援的顯示幣別");
        db.update("""
            INSERT INTO user_preferences(user_seq, display_currency) VALUES (?, ?)
            ON CONFLICT (user_seq) DO UPDATE SET display_currency=EXCLUDED.display_currency,
              updated_at=now()
            """, LedgerController.owner(auth), currency);
        return Map.of("currency", currency);
    }

    @PutMapping("/dashboard-settings/work-day-target")
    Map<String, Object> saveWorkDayTarget(Authentication auth, @RequestBody Map<String, Object> body) {
        Object raw = body.get("target");
        Long value = raw == null ? null : LedgerController.cents(raw, false);
        if (value != null && value > 100000)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "追蹤目標過大");
        db.update("""
            INSERT INTO user_preferences(user_seq, work_day_target) VALUES (?, ?)
            ON CONFLICT (user_seq) DO UPDATE SET work_day_target=EXCLUDED.work_day_target,
              updated_at=now()
            """, LedgerController.owner(auth), value);
        return Map.of("target", value == null ? 0 : value);
    }

    @PutMapping("/dashboard-settings/saving-goal")
    Map<String, Object> saveGoal(Authentication auth, @RequestBody Map<String, Object> body) {
        String name = LedgerController.text(body, "name").trim();
        if (name.length() > 80) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "目標名稱過長");
        long target = LedgerController.cents(body.get("targetCents"), false);
        long initial = signedCents(body.get("initialCents"));
        LocalDate start = LedgerController.date(body, "startDate");
        LocalDate end = body.get("endDate") == null ? null : LedgerController.date(body, "endDate");
        if (end != null && end.isBefore(start))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "截止日期不可早於開始日期");
        db.update("""
            INSERT INTO saving_goal(user_seq, name, target_cents, initial_cents, currency,
              start_date, end_date) VALUES (?, ?, ?, ?, 'AUD', ?, ?)
            ON CONFLICT (user_seq) DO UPDATE SET name=EXCLUDED.name,
              target_cents=EXCLUDED.target_cents, initial_cents=EXCLUDED.initial_cents,
              start_date=EXCLUDED.start_date, end_date=EXCLUDED.end_date, updated_at=now()
            """, LedgerController.owner(auth), name, target, initial, start, end);
        return body;
    }

    @GetMapping("/salary-deposits")
    List<Map<String, Object>> salaryDeposits(Authentication auth) {
        return db.query("""
            SELECT deposit_id, paid_on, period_start, period_end, gross_cents, tax_cents,
              net_cents, source_ref FROM salary_deposit WHERE user_seq=? ORDER BY paid_on, deposit_id
            """, (rs, row) -> {
                Map<String, Object> item = new HashMap<>();
                item.put("id", rs.getObject("deposit_id", UUID.class).toString());
                item.put("paidAt", rs.getDate("paid_on").toLocalDate().toString());
                item.put("periodStart", rs.getDate("period_start") == null ? null : rs.getDate("period_start").toLocalDate().toString());
                item.put("periodEnd", rs.getDate("period_end") == null ? null : rs.getDate("period_end").toLocalDate().toString());
                item.put("grossCents", rs.getObject("gross_cents"));
                item.put("taxCents", rs.getObject("tax_cents"));
                item.put("amountCents", rs.getLong("net_cents"));
                item.put("sourceRef", rs.getString("source_ref"));
                return item;
            }, LedgerController.owner(auth));
    }

    @PutMapping("/salary-deposits/{id}")
    @Transactional
    Map<String, Object> saveSalaryDeposit(Authentication auth, @PathVariable UUID id,
                                           @RequestBody Map<String, Object> body) {
        long owner = LedgerController.owner(auth);
        LocalDate paidOn = LedgerController.date(body, "paidAt");
        long net = LedgerController.cents(body.get("amountCents"), true);
        Long gross = body.get("grossCents") == null ? null : LedgerController.cents(body.get("grossCents"), true);
        Long tax = body.get("taxCents") == null ? null : LedgerController.cents(body.get("taxCents"), true);
        LocalDate start = body.get("periodStart") == null ? null : LedgerController.date(body, "periodStart");
        LocalDate end = body.get("periodEnd") == null ? null : LedgerController.date(body, "periodEnd");
        if (start != null && end != null && end.isBefore(start))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "薪資期間無效");
        String ref = body.get("sourceRef") == null ? null : String.valueOf(body.get("sourceRef"));
        int updated = db.update("""
            UPDATE salary_deposit SET paid_on=?, period_start=?, period_end=?, gross_cents=?,
              tax_cents=?, net_cents=?, source_ref=? WHERE user_seq=? AND deposit_id=?
            """, paidOn, start, end, gross, tax, net, ref, owner, id);
        if (updated == 0) db.update("""
            INSERT INTO salary_deposit(deposit_id, user_seq, paid_on, period_start, period_end,
              gross_cents, tax_cents, net_cents, source_ref, currency)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'AUD')
            """, id, owner, paidOn, start, end, gross, tax, net, ref);
        return body;
    }

    @DeleteMapping("/salary-deposits/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void deleteSalaryDeposit(Authentication auth, @PathVariable UUID id) {
        db.update("DELETE FROM salary_deposit WHERE user_seq=? AND deposit_id=?",
            LedgerController.owner(auth), id);
    }

    @PostMapping("/expenses/{id}/payments")
    @Transactional
    Map<String, Object> recordExpensePayment(Authentication auth, @PathVariable String id,
                                              @RequestBody Map<String, Object> body) {
        long owner = LedgerController.owner(auth);
        var expenses = db.query("SELECT seq, amount_cents FROM expense_record WHERE user_seq=? AND client_id=?",
            (rs, row) -> new long[] { rs.getLong(1), rs.getLong(2) }, owner, LedgerController.clientId(id));
        if (expenses.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "找不到支出");
        LocalDate occurrence = LedgerController.date(body, "occurrenceDate");
        LocalDate paidOn = LedgerController.date(body, "paidAt");
        long amount = LedgerController.cents(body.get("amountCents"), false);
        if (amount > expenses.get(0)[1])
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "付款不可超過預定金額");
        db.update("""
            INSERT INTO expense_payment(user_seq, expense_seq, occurrence_date, paid_on,
              amount_cents, currency) VALUES (?, ?, ?, ?, ?, 'AUD')
            ON CONFLICT (expense_seq, occurrence_date) DO UPDATE SET paid_on=EXCLUDED.paid_on,
              amount_cents=EXCLUDED.amount_cents
            """, owner, expenses.get(0)[0], occurrence, paidOn, amount);
        return body;
    }
}
