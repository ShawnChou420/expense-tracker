package com.expensetracker;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/**
 * 會員確認後的薪資單解析結果。PDF 在手機上解析，這裡只收到使用者確認過的數字；
 * 不保存原始檔案或密碼。可在同一個交易中一併建立薪資入帳。
 */
@RestController
@RequestMapping("/api/payslip-imports")
public class PayslipImportController {
    static final int MAX_ITEMS_CHARS = 20_000;
    private final JdbcTemplate db;
    private final ObjectMapper json;

    PayslipImportController(JdbcTemplate db, ObjectMapper json) {
        this.db = db;
        this.json = json;
    }

    @GetMapping
    List<Map<String, Object>> list(Authentication auth) {
        return db.query("""
            SELECT import_id, employer_name, employer_abn, pay_date, period_start, period_end,
              gross_cents, tax_cents, net_cents, super_cents, ytd_gross_cents, ytd_tax_cents,
              ytd_super_cents, items_json::text, deposit_id, file_sha256, created_at
            FROM payslip_import WHERE user_seq = ? ORDER BY pay_date DESC, created_at DESC
            """, (rs, row) -> {
                Map<String, Object> item = new HashMap<>();
                item.put("id", rs.getObject("import_id", UUID.class).toString());
                item.put("employerName", rs.getString("employer_name"));
                item.put("employerAbn", rs.getString("employer_abn"));
                item.put("payDate", rs.getDate("pay_date").toLocalDate().toString());
                item.put("periodStart", text(rs.getDate("period_start")));
                item.put("periodEnd", text(rs.getDate("period_end")));
                item.put("grossCents", rs.getObject("gross_cents"));
                item.put("taxCents", rs.getObject("tax_cents"));
                item.put("netCents", rs.getLong("net_cents"));
                item.put("superCents", rs.getObject("super_cents"));
                Map<String, Object> ytd = new HashMap<>();
                ytd.put("grossCents", rs.getObject("ytd_gross_cents"));
                ytd.put("taxCents", rs.getObject("ytd_tax_cents"));
                ytd.put("superCents", rs.getObject("ytd_super_cents"));
                item.put("ytd", ytd);
                item.put("items", json.readValue(rs.getString("items_json"), List.class));
                UUID deposit = rs.getObject("deposit_id", UUID.class);
                item.put("depositId", deposit == null ? null : deposit.toString());
                item.put("fileSha256", rs.getString("file_sha256"));
                return item;
            }, LedgerController.owner(auth));
    }

    private static String text(java.sql.Date date) {
        return date == null ? null : date.toLocalDate().toString();
    }

    static Long optionalCents(Map<String, Object> body, String key) {
        return body.get(key) == null ? null : LedgerController.cents(body.get(key), true);
    }

    static String fingerprint(Object value) {
        if (value == null) return null;
        String text = String.valueOf(value);
        if (!text.matches("[0-9a-f]{64}")) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "無效文件指紋");
        return text;
    }

    static String shortText(Object value, int max) {
        if (value == null) return null;
        String text = String.valueOf(value).trim();
        if (text.isEmpty()) return null;
        if (text.length() > max) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "欄位過長");
        return text;
    }

    @PostMapping
    @Transactional
    @ResponseStatus(HttpStatus.CREATED)
    @SuppressWarnings("unchecked")
    Map<String, Object> create(Authentication auth, @RequestBody Map<String, Object> body) {
        long owner = LedgerController.owner(auth);
        LocalDate payDate = LedgerController.date(body, "payDate");
        LocalDate start = body.get("periodStart") == null ? null : LedgerController.date(body, "periodStart");
        LocalDate end = body.get("periodEnd") == null ? null : LedgerController.date(body, "periodEnd");
        if (start != null && end != null && end.isBefore(start))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "薪資期間無效");
        long net = LedgerController.cents(body.get("netCents"), true);
        Long gross = optionalCents(body, "grossCents");
        Long tax = optionalCents(body, "taxCents");
        Long superCents = optionalCents(body, "superCents");
        Map<String, Object> ytd = body.get("ytd") instanceof Map<?, ?> map ? (Map<String, Object>) map : Map.of();
        Long ytdGross = optionalCents(ytd, "grossCents");
        Long ytdTax = optionalCents(ytd, "taxCents");
        Long ytdSuper = optionalCents(ytd, "superCents");
        String sha = fingerprint(body.get("fileSha256"));
        Object items = body.get("items") instanceof List<?> list ? list : List.of();
        String itemsJson = json.writeValueAsString(items);
        if (itemsJson.length() > MAX_ITEMS_CHARS)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "薪資項目過多");

        if (sha != null) {
            Integer existing = db.queryForObject(
                "SELECT count(*) FROM payslip_import WHERE user_seq = ? AND file_sha256 = ?",
                Integer.class, owner, sha);
            if (existing != null && existing > 0)
                throw new ResponseStatusException(HttpStatus.CONFLICT, "這份薪資單之前已經匯入過");
        }

        UUID depositId = null;
        if (Boolean.TRUE.equals(body.get("recordDeposit"))) {
            depositId = UUID.randomUUID();
            try {
                db.update("""
                    INSERT INTO salary_deposit(deposit_id, user_seq, paid_on, period_start, period_end,
                      gross_cents, tax_cents, net_cents, source_ref, currency)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'AUD')
                    """, depositId, owner, payDate, start, end, gross, tax, net,
                    sha == null ? null : "payslip:" + sha);
            } catch (DuplicateKeyException exception) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "這份薪資單的入帳已經記錄過");
            }
        }

        UUID importId = UUID.randomUUID();
        db.update("""
            INSERT INTO payslip_import(import_id, user_seq, employer_name, employer_abn, file_sha256,
              pay_date, period_start, period_end, gross_cents, tax_cents, net_cents, super_cents,
              ytd_gross_cents, ytd_tax_cents, ytd_super_cents, items_json, deposit_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?)
            """, importId, owner, shortText(body.get("employerName"), 120),
            shortText(body.get("employerAbn"), 20), sha, payDate, start, end, gross, tax, net,
            superCents, ytdGross, ytdTax, ytdSuper, itemsJson, depositId);

        Map<String, Object> result = new HashMap<>(body);
        result.put("id", importId.toString());
        result.put("depositId", depositId == null ? null : depositId.toString());
        result.remove("recordDeposit");
        return result;
    }

    /** 刪除匯入紀錄；同時建立的薪資入帳也一起刪除，避免首頁收入重複或殘留 */
    @DeleteMapping("/{id}")
    @Transactional
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void delete(Authentication auth, @PathVariable UUID id) {
        long owner = LedgerController.owner(auth);
        List<UUID> deposits = db.query(
            "SELECT deposit_id FROM payslip_import WHERE user_seq = ? AND import_id = ? AND deposit_id IS NOT NULL",
            (rs, row) -> rs.getObject(1, UUID.class), owner, id);
        db.update("DELETE FROM payslip_import WHERE user_seq = ? AND import_id = ?", owner, id);
        for (UUID deposit : deposits)
            db.update("DELETE FROM salary_deposit WHERE user_seq = ? AND deposit_id = ?", owner, deposit);
    }
}
