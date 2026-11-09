package com.expensetracker;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
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
public class TransportController {
    private final JdbcTemplate db;

    TransportController(JdbcTemplate db) {
        this.db = db;
    }

    private static Long nullableCents(Object value) {
        return value == null ? null : LedgerController.cents(value, true);
    }

    private UUID passengerId(long owner, String clientId) {
        var ids = db.query("SELECT passenger_id FROM passenger WHERE user_seq = ? AND client_id = ?",
            (rs, row) -> rs.getObject(1, UUID.class), owner, LedgerController.clientId(clientId));
        if (ids.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "找不到乘客");
        return ids.get(0);
    }

    @GetMapping("/passengers")
    List<Map<String, Object>> passengers(Authentication auth) {
        return db.query("""
            SELECT client_id, name, active, default_one_way_cents, default_round_trip_cents
            FROM passenger WHERE user_seq = ? ORDER BY created_at, client_id
            """, (rs, row) -> {
                Map<String, Object> result = new HashMap<>();
                result.put("id", rs.getString("client_id"));
                result.put("name", rs.getString("name"));
                result.put("active", rs.getBoolean("active"));
                result.put("defaultOneWayFareCents", rs.getObject("default_one_way_cents"));
                result.put("defaultRoundTripFareCents", rs.getObject("default_round_trip_cents"));
                return result;
            }, LedgerController.owner(auth));
    }

    @PutMapping("/passengers/{id}")
    Map<String, Object> savePassenger(Authentication auth, @PathVariable String id,
                                      @RequestBody Map<String, Object> body) {
        id = LedgerController.clientId(id);
        if (!id.equals(String.valueOf(body.get("id"))))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "乘客 ID 不一致");
        String name = LedgerController.text(body, "name").trim();
        if (name.length() > 100) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "乘客名稱過長");
        db.update("""
            INSERT INTO passenger(user_seq, client_id, name, active, default_one_way_cents,
              default_round_trip_cents, currency)
            VALUES (?, ?, ?, ?, ?, ?, 'AUD')
            ON CONFLICT (user_seq, client_id) DO UPDATE SET
              name=EXCLUDED.name, active=EXCLUDED.active,
              default_one_way_cents=EXCLUDED.default_one_way_cents,
              default_round_trip_cents=EXCLUDED.default_round_trip_cents
            """, LedgerController.owner(auth), id, name, !Boolean.FALSE.equals(body.get("active")),
            nullableCents(body.get("defaultOneWayFareCents")),
            nullableCents(body.get("defaultRoundTripFareCents")));
        return body;
    }

    @GetMapping("/trips")
    List<Map<String, Object>> trips(Authentication auth) {
        long owner = LedgerController.owner(auth);
        return db.query("""
            SELECT trip_id, client_id, trip_date, trip_type, trip_mode, note
            FROM trip WHERE user_seq = ? ORDER BY trip_date, trip_id
            """, (rs, row) -> {
                UUID tripId = rs.getObject("trip_id", UUID.class);
                Map<String, Object> trip = new HashMap<>();
                trip.put("id", rs.getString("client_id"));
                trip.put("date", rs.getDate("trip_date").toLocalDate().toString());
                trip.put("type", rs.getString("trip_type"));
                trip.put("tripMode", rs.getString("trip_mode"));
                trip.put("note", rs.getString("note"));
                trip.put("charges", charges(owner, tripId));
                return trip;
            }, owner);
    }

    private List<Map<String, Object>> charges(long owner, UUID tripId) {
        return db.query("""
            SELECT c.charge_id, p.client_id, c.agreed_cents, c.amount_status, c.status_code
            FROM trip_charge c JOIN passenger p ON p.passenger_id = c.passenger_id AND p.user_seq = c.user_seq
            WHERE c.user_seq = ? AND c.trip_id = ? ORDER BY p.created_at, p.client_id
            """, (rs, row) -> {
                UUID chargeId = rs.getObject("charge_id", UUID.class);
                long agreed = rs.getLong("agreed_cents");
                var payments = db.query("""
                    SELECT payment_id, received_on, amount_cents FROM trip_payment
                    WHERE user_seq = ? AND charge_id = ? ORDER BY received_on, payment_id
                    """, (paymentRs, paymentRow) -> Map.<String, Object>of(
                        "id", paymentRs.getObject("payment_id", UUID.class).toString(),
                        "paidAt", paymentRs.getDate("received_on").toLocalDate().toString(),
                        "amountCents", paymentRs.getLong("amount_cents")), owner, chargeId);
                long received = payments.stream().mapToLong(item -> (long) item.get("amountCents")).sum();
                Map<String, Object> charge = new HashMap<>();
                charge.put("passengerId", rs.getString("client_id"));
                charge.put("amountCents", agreed);
                charge.put("amountStatus", rs.getString("amount_status"));
                charge.put("paymentStatus", received > 0 && received < agreed ? "PARTIAL" :
                    received >= agreed && agreed > 0 ? "PAID" : rs.getString("status_code"));
                charge.put("payments", payments);
                if (!payments.isEmpty()) charge.put("paidAt", payments.get(payments.size() - 1).get("paidAt"));
                return charge;
            }, owner, tripId);
    }

    @PutMapping("/trips/{id}")
    @Transactional
    Map<String, Object> saveTrip(Authentication auth, @PathVariable String id,
                                  @RequestBody Map<String, Object> body) {
        long owner = LedgerController.owner(auth);
        id = LedgerController.clientId(id);
        if (!id.equals(String.valueOf(body.get("id"))))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "行程 ID 不一致");
        LocalDate date = LedgerController.date(body, "date");
        String type = LedgerController.text(body, "type");
        String mode = LedgerController.text(body, "tripMode");
        if (!List.of("WORK", "LEISURE", "OTHER").contains(type) ||
            !List.of("ONE_WAY", "ROUND_TRIP", "CUSTOM").contains(mode))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "無效行程類型");
        UUID tripId = db.queryForObject("""
            INSERT INTO trip(user_seq, client_id, trip_date, trip_type, trip_mode, note)
            VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (user_seq, client_id) DO UPDATE SET
              trip_date=EXCLUDED.trip_date, trip_type=EXCLUDED.trip_type,
              trip_mode=EXCLUDED.trip_mode, note=EXCLUDED.note RETURNING trip_id
            """, UUID.class, owner, id, date, type, mode, body.getOrDefault("note", ""));
        if (!(body.get("charges") instanceof List<?> inputCharges) || inputCharges.isEmpty())
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "請選擇乘客");
        Set<UUID> retained = new HashSet<>();
        for (Object input : inputCharges) {
            if (!(input instanceof Map<?, ?> charge))
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "無效乘客金額");
            UUID passengerId = passengerId(owner, String.valueOf(charge.get("passengerId")));
            if (!retained.add(passengerId))
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "乘客重複");
            long agreed = LedgerController.cents(charge.get("amountCents"), true);
            String amountStatus = String.valueOf(charge.containsKey("amountStatus") ? charge.get("amountStatus") : "CUSTOM");
            if (!List.of("UNSET", "DEFAULT", "CUSTOM", "FREE").contains(amountStatus))
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "無效車資狀態");
            String status = String.valueOf(charge.containsKey("paymentStatus") ? charge.get("paymentStatus") : "PENDING");
            if (!List.of("PENDING", "PARTIAL", "PAID").contains(status))
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "無效收款狀態");
            UUID chargeId = db.queryForObject("""
                INSERT INTO trip_charge(user_seq, trip_id, passenger_id, agreed_cents,
                  amount_status, status_code, currency)
                VALUES (?, ?, ?, ?, ?, ?, 'AUD')
                ON CONFLICT (trip_id, passenger_id) DO UPDATE SET
                  agreed_cents=EXCLUDED.agreed_cents, amount_status=EXCLUDED.amount_status,
                  status_code=EXCLUDED.status_code RETURNING charge_id
                """, UUID.class, owner, tripId, passengerId, agreed, amountStatus, status);
            long received = db.queryForObject("""
                SELECT COALESCE(sum(amount_cents), 0) FROM trip_payment
                WHERE user_seq = ? AND charge_id = ?
                """, Long.class, owner, chargeId);
            if (received > agreed || (received > 0 && status.equals("PENDING")))
                throw new ResponseStatusException(HttpStatus.CONFLICT, "已有收款，不能覆蓋或縮減約定車資");
            if (status.equals("PAID") && received < agreed) {
                LocalDate paidAt = LedgerController.date((Map<String, Object>) charge, "paidAt");
                db.update("""
                    INSERT INTO trip_payment(user_seq, charge_id, received_on, amount_cents, currency)
                    VALUES (?, ?, ?, ?, 'AUD')
                    """, owner, chargeId, paidAt, agreed - received);
            }
        }
        var removed = db.query("SELECT charge_id, passenger_id FROM trip_charge WHERE user_seq = ? AND trip_id = ?",
            (rs, row) -> new UUID[] { rs.getObject(1, UUID.class), rs.getObject(2, UUID.class) }, owner, tripId);
        for (UUID[] row : removed) {
            if (retained.contains(row[1])) continue;
            Integer count = db.queryForObject("SELECT count(*) FROM trip_payment WHERE user_seq = ? AND charge_id = ?",
                Integer.class, owner, row[0]);
            if (count > 0) throw new ResponseStatusException(HttpStatus.CONFLICT, "已收款乘客不可直接移除");
            db.update("DELETE FROM trip_charge WHERE user_seq = ? AND charge_id = ?", owner, row[0]);
        }
        return body;
    }

    @DeleteMapping("/trips/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void deleteTrip(Authentication auth, @PathVariable String id) {
        db.update("DELETE FROM trip WHERE user_seq = ? AND client_id = ?",
            LedgerController.owner(auth), LedgerController.clientId(id));
    }

    @PostMapping("/trips/{tripId}/charges/{passengerId}/payments")
    @Transactional
    Map<String, Object> addPayment(Authentication auth, @PathVariable String tripId,
                                    @PathVariable String passengerId,
                                    @RequestBody Map<String, Object> body) {
        long owner = LedgerController.owner(auth);
        LocalDate receivedOn = LedgerController.date(body, "paidAt");
        long amount = LedgerController.cents(body.get("amountCents"), false);
        var charges = db.query("""
            SELECT c.charge_id, c.agreed_cents FROM trip_charge c
            JOIN trip t ON t.trip_id=c.trip_id AND t.user_seq=c.user_seq
            JOIN passenger p ON p.passenger_id=c.passenger_id AND p.user_seq=c.user_seq
            WHERE c.user_seq=? AND t.client_id=? AND p.client_id=? FOR UPDATE OF c
            """, (rs, row) -> new Object[] { rs.getObject(1, UUID.class), rs.getLong(2) },
            owner, LedgerController.clientId(tripId), LedgerController.clientId(passengerId));
        if (charges.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "找不到搭乘項目");
        UUID chargeId = (UUID) charges.get(0)[0];
        long agreed = (long) charges.get(0)[1];
        long paid = db.queryForObject("SELECT COALESCE(sum(amount_cents), 0) FROM trip_payment WHERE user_seq=? AND charge_id=?",
            Long.class, owner, chargeId);
        if (paid + amount > agreed)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "收款不可超過約定車資");
        UUID paymentId = db.queryForObject("""
            INSERT INTO trip_payment(user_seq, charge_id, received_on, amount_cents, currency)
            VALUES (?, ?, ?, ?, 'AUD') RETURNING payment_id
            """, UUID.class, owner, chargeId, receivedOn, amount);
        db.update("UPDATE trip_charge SET status_code=? WHERE user_seq=? AND charge_id=?",
            paid + amount == agreed ? "PAID" : "PARTIAL", owner, chargeId);
        return Map.of("id", paymentId.toString(), "paidAt", receivedOn.toString(), "amountCents", amount);
    }
}
