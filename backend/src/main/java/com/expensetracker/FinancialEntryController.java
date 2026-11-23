package com.expensetracker;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
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
 * 通用手動交易（financial_entry）：一般收入、資金移轉、外幣單次支出。
 * AUD 支出（含週期性）仍走 /api/expenses；薪資只來自班表與 Payslip 入帳，這裡不接受薪資分類。
 *
 * <p>多幣別：保存原始金額（最小貨幣單位）與幣別；換算後的 AUD cents 由後端依 fx_rate 計算
 * （四捨五入），外幣沒有匯率時 converted_aud_cents 為 null，不可併入 AUD 合計。
 */
@RestController
@RequestMapping("/api/financial-entries")
public class FinancialEntryController {
    static final List<String> TYPES = List.of("INCOME", "EXPENSE", "TRANSFER");
    static final List<String> STATUSES = List.of("SETTLED", "PLANNED");
    static final List<String> CURRENCIES = List.of("AUD", "TWD", "USD");
    static final List<String> FX_SOURCES = List.of("MANUAL", "OPEN_ER_API");
    static final List<String> INCOME_CATEGORIES = List.of(
        "SIDE_JOB", "SECONDHAND_SALE", "BONUS", "GIFT", "REFUND", "INVESTMENT_GAIN", "OTHER_INCOME");
    /** 與前端 src/domain/expenses.js 的小類一致；已實現投資虧損仍只能記在既有支出（AUD）。 */
    static final Set<String> EXPENSE_CATEGORIES = Set.of(
        "RENT", "UTILITIES", "GROCERIES", "DINING", "COFFEE", "FUEL", "CAR", "TRANSIT",
        "FITNESS", "PHONE", "SHOPPING", "TRAVEL", "FUN", "HEALTH_INSURANCE", "CAR_INSURANCE",
        "OTHER_INSURANCE", "LOAN", "OTHER");
    static final long MAX_AMOUNT_MINOR = 100_000_000_000L; // 10 億（原幣）
    static final int FX_SCALE = 10;

    private final JdbcTemplate db;
    /** 活動事件紀錄；單元測試可以不提供 */
    private final ActivityLog activity;

    FinancialEntryController(JdbcTemplate db) {
        this(db, null);
    }

    @org.springframework.beans.factory.annotation.Autowired
    FinancialEntryController(JdbcTemplate db, ActivityLog activity) {
        this.db = db;
        this.activity = activity;
    }

    /** 驗證後的一筆交易 */
    record Entry(String id, LocalDate date, String type, String classification, String status,
                 String category, String title, String note, long amountMinor, String currency,
                 Long convertedAudCents, BigDecimal fxRate, LocalDate fxRateDate, String fxSource) {
        Map<String, Object> toJson() {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("id", id);
            out.put("date", date.toString());
            out.put("type", type);
            out.put("classification", classification);
            out.put("status", status);
            out.put("category", category);
            out.put("title", title == null ? "" : title);
            out.put("note", note == null ? "" : note);
            out.put("amountMinor", amountMinor);
            out.put("currency", currency);
            out.put("convertedAudCents", convertedAudCents);
            out.put("fxRate", fxRate == null ? null : fxRate.stripTrailingZeros().toPlainString());
            out.put("fxRateDate", fxRateDate == null ? null : fxRateDate.toString());
            out.put("fxSource", fxSource);
            return out;
        }
    }

    static ResponseStatusException bad(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }

    /** 分類 → 口徑。投資獲利、退款、移轉都不是一般收入。 */
    static String classificationOf(String type, String category) {
        if ("TRANSFER".equals(type)) return "TRANSFER";
        if ("INVESTMENT_GAIN".equals(category)) return "INVESTMENT_PNL";
        if ("REFUND".equals(category)) return "REFUND";
        return "NORMAL";
    }

    static String optionalText(Map<String, Object> body, String name, int max) {
        Object value = body.get(name);
        if (value == null) return null;
        if (!(value instanceof String string)) throw bad("無效欄位：" + name);
        String trimmed = string.trim();
        if (trimmed.length() > max) throw bad(name + " 不可超過 " + max + " 字");
        return trimmed.isEmpty() ? null : trimmed;
    }

    static LocalDate strictDate(Object value, String name) {
        try {
            LocalDate date = LocalDate.parse(String.valueOf(value));
            if (!date.toString().equals(value)) throw new IllegalArgumentException();
            return date;
        } catch (Exception exception) {
            throw bad("無效日期：" + name);
        }
    }

    /** 原始金額 × 匯率，四捨五入成 AUD cents（與前端 src/domain/fx.js 相同規則）。 */
    static long convert(long amountMinor, BigDecimal fxRate) {
        return BigDecimal.valueOf(amountMinor).multiply(fxRate)
            .setScale(0, RoundingMode.HALF_UP).longValueExact();
    }

    static Entry validate(String rawId, Map<String, Object> body) {
        String id = LedgerController.clientId(rawId);
        if (body == null || !id.equals(String.valueOf(body.get("id")))) throw bad("紀錄 ID 不一致");
        LocalDate date = strictDate(body.get("date"), "date");
        String type = String.valueOf(body.get("type"));
        if (!TYPES.contains(type)) throw bad("無效交易類型");
        String status = String.valueOf(body.get("status"));
        if (!STATUSES.contains(status)) throw bad("無效交易狀態");
        String currency = String.valueOf(body.get("currency"));
        if (!CURRENCIES.contains(currency)) throw bad("目前只支援 AUD、TWD、USD");
        String category = String.valueOf(body.get("category"));
        switch (type) {
            case "INCOME" -> {
                if (!INCOME_CATEGORIES.contains(category)) throw bad("無效收入分類");
            }
            case "EXPENSE" -> {
                if (!EXPENSE_CATEGORIES.contains(category)) throw bad("無效支出分類");
                if ("AUD".equals(currency)) throw bad("AUD 支出請用支出頁記錄");
            }
            default -> {
                if (!"TRANSFER".equals(category)) throw bad("資金移轉的分類必須是 TRANSFER");
            }
        }
        String classification = classificationOf(type, category);
        if (body.get("classification") != null && !classification.equals(body.get("classification")))
            throw bad("交易口徑與分類不一致");
        long amount = LedgerController.cents(body.get("amountMinor"), false);
        if (amount > MAX_AMOUNT_MINOR) throw bad("金額過大");
        String title = optionalText(body, "title", 120);
        String note = optionalText(body, "note", 500);

        Long converted;
        BigDecimal fxRate = null;
        LocalDate fxRateDate = null;
        String fxSource = null;
        if ("AUD".equals(currency)) {
            converted = amount;
        } else if (body.get("fxRate") == null || "".equals(body.get("fxRate"))) {
            converted = null; // 沒有匯率：不換算、不併入 AUD 合計
        } else {
            try {
                fxRate = new BigDecimal(String.valueOf(body.get("fxRate")));
            } catch (NumberFormatException exception) {
                throw bad("無效匯率");
            }
            if (fxRate.signum() <= 0 || fxRate.compareTo(BigDecimal.valueOf(1000)) > 0) throw bad("無效匯率");
            if (fxRate.stripTrailingZeros().scale() > FX_SCALE) throw bad("匯率最多 10 位小數");
            fxSource = String.valueOf(body.get("fxSource"));
            if (!FX_SOURCES.contains(fxSource)) throw bad("無效匯率來源");
            fxRateDate = body.get("fxRateDate") == null ? null : strictDate(body.get("fxRateDate"), "fxRateDate");
            converted = convert(amount, fxRate);
        }
        return new Entry(id, date, type, classification, status, category, title, note, amount,
            currency, converted, fxRate, fxRateDate, fxSource);
    }

    @GetMapping
    List<Map<String, Object>> list(Authentication auth) {
        return db.query("""
            SELECT client_id, entry_date, entry_type, classification, status, category, title, note,
              original_amount_minor, currency, converted_aud_cents, fx_rate, fx_rate_date, fx_source
            FROM financial_entry WHERE user_seq = ? ORDER BY entry_date, created_at, client_id
            """, (rs, row) -> new Entry(
                rs.getString("client_id"), rs.getDate("entry_date").toLocalDate(),
                rs.getString("entry_type"), rs.getString("classification"), rs.getString("status"),
                rs.getString("category"), rs.getString("title"), rs.getString("note"),
                rs.getLong("original_amount_minor"), rs.getString("currency"),
                (Long) rs.getObject("converted_aud_cents", Long.class), rs.getBigDecimal("fx_rate"),
                rs.getDate("fx_rate_date") == null ? null : rs.getDate("fx_rate_date").toLocalDate(),
                rs.getString("fx_source")).toJson(), LedgerController.owner(auth));
    }

    /** 以 client id upsert：訪客資料在登入合併時重送也不會重複。 */
    @PutMapping("/{id}")
    Map<String, Object> save(Authentication auth, @PathVariable String id,
                             @RequestBody Map<String, Object> body) {
        Entry entry = validate(id, body);
        long owner = LedgerController.owner(auth);
        Boolean inserted = db.queryForObject("""
            INSERT INTO financial_entry(user_seq, client_id, entry_date, entry_type, classification,
              status, category, title, note, original_amount_minor, currency, converted_aud_cents,
              fx_rate, fx_rate_date, fx_source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (user_seq, client_id) DO UPDATE SET
              entry_date=EXCLUDED.entry_date, entry_type=EXCLUDED.entry_type,
              classification=EXCLUDED.classification, status=EXCLUDED.status,
              category=EXCLUDED.category, title=EXCLUDED.title, note=EXCLUDED.note,
              original_amount_minor=EXCLUDED.original_amount_minor, currency=EXCLUDED.currency,
              converted_aud_cents=EXCLUDED.converted_aud_cents, fx_rate=EXCLUDED.fx_rate,
              fx_rate_date=EXCLUDED.fx_rate_date, fx_source=EXCLUDED.fx_source, updated_at=now()
            RETURNING (xmax = 0) AS inserted
            """, Boolean.class, owner, entry.id(), entry.date(), entry.type(), entry.classification(),
            entry.status(), entry.category(), entry.title(), entry.note(), entry.amountMinor(),
            entry.currency(), entry.convertedAudCents(), entry.fxRate(), entry.fxRateDate(), entry.fxSource());
        if (activity != null)
            activity.success(owner, Boolean.TRUE.equals(inserted) ? "FINANCE_ENTRY_CREATED" : "FINANCE_ENTRY_UPDATED",
                Map.of("type", entry.type(), "currency", entry.currency()));
        return entry.toJson();
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void delete(Authentication auth, @PathVariable String id) {
        db.update("DELETE FROM financial_entry WHERE user_seq = ? AND client_id = ?",
            LedgerController.owner(auth), LedgerController.clientId(id));
    }
}
