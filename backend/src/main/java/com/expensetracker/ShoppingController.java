package com.expensetracker;

import java.math.BigDecimal;
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
@RequestMapping("/api/shopping-items")
public class ShoppingController {
    private final JdbcTemplate db;

    ShoppingController(JdbcTemplate db) {
        this.db = db;
    }

    private static int quantity(Object value, boolean allowZero) {
        try {
            int result = new BigDecimal(String.valueOf(value)).intValueExact();
            if (result < (allowZero ? 0 : 1) || result > 999) throw new IllegalArgumentException();
            return result;
        } catch (Exception exception) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "數量需為 0–999 的整數");
        }
    }

    private static String option(Map<String, Object> body, String field, List<String> choices) {
        String value = LedgerController.text(body, field);
        if (!choices.contains(value))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "無效欄位：" + field);
        return value;
    }

    private static String limitedText(Map<String, Object> body, String field, int max, boolean required) {
        Object raw = body.get(field);
        if (!(raw instanceof String) && raw != null)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "無效欄位：" + field);
        String value = raw == null ? "" : ((String) raw).trim();
        if ((required && value.isEmpty()) || value.length() > max)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "無效欄位：" + field);
        return value;
    }

    @GetMapping
    List<Map<String, Object>> list(Authentication auth) {
        return db.query("""
            SELECT client_id, name, target_quantity, purchased_quantity, unit,
              priority, trip_bucket, preferred_store, note
            FROM shopping_item WHERE user_seq = ? ORDER BY created_at, client_id
            """, (rs, row) -> Map.of(
                "id", rs.getString("client_id"),
                "name", rs.getString("name"),
                "quantity", rs.getInt("target_quantity"),
                "purchasedQuantity", rs.getInt("purchased_quantity"),
                "unit", rs.getString("unit"),
                "priority", rs.getString("priority"),
                "bucket", rs.getString("trip_bucket"),
                "store", rs.getString("preferred_store"),
                "note", rs.getString("note")), LedgerController.owner(auth));
    }

    @PutMapping("/{id}")
    Map<String, Object> save(Authentication auth, @PathVariable String id,
                             @RequestBody Map<String, Object> body) {
        id = LedgerController.clientId(id);
        if (!id.equals(body.get("id")))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "採買項目 ID 不一致");
        String name = limitedText(body, "name", 120, true);
        String unit = limitedText(body, "unit", 20, true);
        String note = limitedText(body, "note", 240, false);
        int target = quantity(body.get("quantity"), false);
        int purchased = quantity(body.get("purchasedQuantity"), true);
        if (purchased > target)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "已買數量不可超過目標數量");
        String priority = option(body, "priority", List.of("HIGH", "NORMAL", "LOW"));
        String bucket = option(body, "bucket", List.of("NOW", "LATER"));
        String store = option(body, "store", List.of("ANY", "WOOLWORTHS", "COLES", "ALDI", "OTHER"));
        db.update("""
            INSERT INTO shopping_item(user_seq, client_id, name, target_quantity,
              purchased_quantity, unit, priority, trip_bucket, preferred_store, note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (user_seq, client_id) DO UPDATE SET
              name = EXCLUDED.name, target_quantity = EXCLUDED.target_quantity,
              purchased_quantity = EXCLUDED.purchased_quantity, unit = EXCLUDED.unit,
              priority = EXCLUDED.priority, trip_bucket = EXCLUDED.trip_bucket,
              preferred_store = EXCLUDED.preferred_store, note = EXCLUDED.note,
              updated_at = now()
            """, LedgerController.owner(auth), id, name, target, purchased, unit,
            priority, bucket, store, note);
        return Map.of("id", id, "name", name, "quantity", target,
            "purchasedQuantity", purchased, "unit", unit, "priority", priority,
            "bucket", bucket, "store", store, "note", note);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void delete(Authentication auth, @PathVariable String id) {
        db.update("DELETE FROM shopping_item WHERE user_seq = ? AND client_id = ?",
            LedgerController.owner(auth), LedgerController.clientId(id));
    }
}
