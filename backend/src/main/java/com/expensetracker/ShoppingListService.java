package com.expensetracker;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * 採買清單（會員私人資料）。每位會員最多一張 ACTIVE 清單；所有查詢都以 user_seq 限定資料歸屬。
 *
 * <p>完成採買時在同一個交易內：建立一筆既有的支出（client_id 固定為 shopping-list-&lt;清單 ID&gt;）、
 * 把清單標成 COMPLETED，並把沒買到的數量移到新的 ACTIVE 清單。重複送出時清單已是 COMPLETED，
 * 直接回傳原本的結果，不會再記一次帳。
 */
@Service
class ShoppingListService {
    static final List<String> PRIORITIES = List.of("HIGH", "NORMAL", "LOW");
    static final List<String> BUCKETS = List.of("NOW", "LATER");
    static final List<String> STORES = List.of("ANY", "WOOLWORTHS", "COLES", "ALDI", "OTHER");
    static final int MAX_PRICE_CENTS = 1_000_000;
    static final String EXPENSE_PREFIX = "shopping-list-";

    private final JdbcTemplate db;
    private final LedgerController ledger;
    private final SupermarketService supermarkets;

    ShoppingListService(JdbcTemplate db, LedgerController ledger, SupermarketService supermarkets) {
        this.db = db;
        this.ledger = ledger;
        this.supermarkets = supermarkets;
    }

    // ---------- 驗證 ----------

    record Item(String id, String name, int quantity, int purchasedQuantity, String unit, String priority,
                String bucket, String store, String note, Long promotionId, String packageSize,
                Integer estimatedUnitPriceCents, Integer actualUnitPriceCents) {
        Map<String, Object> toMap() {
            Map<String, Object> map = new LinkedHashMap<>();
            map.put("id", id);
            map.put("name", name);
            map.put("quantity", quantity);
            map.put("purchasedQuantity", purchasedQuantity);
            map.put("unit", unit);
            map.put("priority", priority);
            map.put("bucket", bucket);
            map.put("store", store);
            map.put("note", note);
            map.put("promotionId", promotionId);
            map.put("packageSize", packageSize);
            map.put("estimatedUnitPriceCents", estimatedUnitPriceCents);
            map.put("actualUnitPriceCents", actualUnitPriceCents);
            return map;
        }
    }

    static ResponseStatusException bad(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }

    static int integer(Object value, int min, int max, String message) {
        try {
            int result = new BigDecimal(String.valueOf(value)).intValueExact();
            if (result < min || result > max) throw new IllegalArgumentException();
            return result;
        } catch (Exception exception) {
            throw bad(message);
        }
    }

    static Integer price(Object value, String field) {
        if (value == null) return null;
        return integer(value, 0, MAX_PRICE_CENTS, "無效金額：" + field);
    }

    static String text(Object raw, String field, int max, boolean required) {
        if (!(raw instanceof String) && raw != null) throw bad("無效欄位：" + field);
        String value = raw == null ? "" : ((String) raw).trim();
        if ((required && value.isEmpty()) || value.length() > max) throw bad("無效欄位：" + field);
        return value;
    }

    static String option(Object value, List<String> choices, String fallback, String field) {
        if (value == null && fallback != null) return fallback;
        if (!(value instanceof String text) || !choices.contains(text)) throw bad("無效欄位：" + field);
        return text;
    }

    /** 把欄位（可以只有部分欄位）套到 base 上並驗證；base 為 null 表示新品項，缺的欄位用預設值 */
    static Item merge(Item base, Map<String, Object> body) {
        boolean create = base == null;
        String id = create ? LedgerController.clientId(String.valueOf(body.get("id"))) : base.id();
        String name = body.containsKey("name") || create ? text(body.get("name"), "name", 200, true) : base.name();
        int quantity = body.containsKey("quantity") || create
            ? integer(body.getOrDefault("quantity", 1), 1, 999, "目標數量需為 1–999") : base.quantity();
        int purchased = body.containsKey("purchasedQuantity") || create
            ? integer(body.getOrDefault("purchasedQuantity", 0), 0, 999, "已買數量需為 0–999") : base.purchasedQuantity();
        if (purchased > quantity) throw bad("已買數量不可超過目標數量");
        String unit = body.containsKey("unit") || create ? text(body.getOrDefault("unit", "件"), "unit", 20, true) : base.unit();
        String priority = body.containsKey("priority") || create
            ? option(body.get("priority"), PRIORITIES, "NORMAL", "priority") : base.priority();
        String bucket = body.containsKey("bucket") || create ? option(body.get("bucket"), BUCKETS, "NOW", "bucket") : base.bucket();
        String store = body.containsKey("store") || create ? option(body.get("store"), STORES, "ANY", "store") : base.store();
        String note = body.containsKey("note") || create ? text(body.get("note"), "note", 240, false) : base.note();
        String packageSize = body.containsKey("packageSize") || create
            ? emptyToNull(text(body.get("packageSize"), "packageSize", 60, false)) : base.packageSize();
        Integer estimated = body.containsKey("estimatedUnitPriceCents") || create
            ? price(body.get("estimatedUnitPriceCents"), "estimatedUnitPriceCents") : base.estimatedUnitPriceCents();
        Integer actual = body.containsKey("actualUnitPriceCents") || create
            ? price(body.get("actualUnitPriceCents"), "actualUnitPriceCents") : base.actualUnitPriceCents();
        Long promotion = create ? promotionId(body.get("promotionId")) : base.promotionId();
        return new Item(id, name, quantity, purchased, unit, priority, bucket, store, note, promotion,
            packageSize, estimated, actual);
    }

    static Long promotionId(Object value) {
        if (value == null) return null;
        try {
            long id = new BigDecimal(String.valueOf(value)).longValueExact();
            if (id < 1) throw new IllegalArgumentException();
            return id;
        } catch (Exception exception) {
            throw bad("無效特價 ID");
        }
    }

    private static String emptyToNull(String value) {
        return value == null || value.isEmpty() ? null : value;
    }

    // ---------- 查詢 ----------

    static final String ITEM_COLUMNS = """
        i.client_id, i.item_name, i.quantity, i.purchased_quantity, i.unit, i.priority, i.trip_bucket,
        i.preferred_store, i.note, i.promotion_seq, i.package_size, i.estimated_unit_price_cents,
        i.actual_unit_price_cents
        """;

    static final RowMapper<Item> ITEM = (rs, row) -> new Item(rs.getString("client_id"), rs.getString("item_name"),
        rs.getInt("quantity"), rs.getInt("purchased_quantity"), rs.getString("unit"), rs.getString("priority"),
        rs.getString("trip_bucket"), rs.getString("preferred_store"), rs.getString("note"),
        rs.getObject("promotion_seq") == null ? null : rs.getLong("promotion_seq"), rs.getString("package_size"),
        rs.getObject("estimated_unit_price_cents") == null ? null : rs.getInt("estimated_unit_price_cents"),
        rs.getObject("actual_unit_price_cents") == null ? null : rs.getInt("actual_unit_price_cents"));

    record ListRow(long seq, String id, String title, String status, String completedAt, String expenseId,
                   Long actualTotalCents) {
        Map<String, Object> toMap() {
            Map<String, Object> map = new LinkedHashMap<>();
            map.put("id", id);
            map.put("title", title);
            map.put("status", status);
            map.put("completedAt", completedAt);
            map.put("expenseId", expenseId);
            map.put("actualTotalCents", actualTotalCents);
            return map;
        }
    }

    static final RowMapper<ListRow> LIST = (rs, row) -> new ListRow(rs.getLong("seq"), rs.getString("client_id"),
        rs.getString("title"), rs.getString("status"),
        rs.getTimestamp("completed_at") == null ? null : rs.getTimestamp("completed_at").toInstant().toString(),
        rs.getString("expense_client_id"),
        rs.getObject("actual_total_cents") == null ? null : rs.getLong("actual_total_cents"));

    private static final String LIST_COLUMNS =
        "seq, client_id, title, status, completed_at, expense_client_id, actual_total_cents";

    ListRow findList(long user, String listId) {
        List<ListRow> found = db.query("SELECT " + LIST_COLUMNS + " FROM shopping_list WHERE user_seq = ? AND client_id = ?",
            LIST, user, LedgerController.clientId(listId));
        if (found.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "找不到這張採買清單");
        return found.getFirst();
    }

    ListRow activeList(long user, boolean create) {
        List<ListRow> found = db.query("SELECT " + LIST_COLUMNS
            + " FROM shopping_list WHERE user_seq = ? AND status = 'ACTIVE'", LIST, user);
        if (!found.isEmpty() || !create) return found.isEmpty() ? null : found.getFirst();
        // 每位會員只能有一張 ACTIVE（partial unique index），同時建立時其中一個 DO NOTHING
        db.update("INSERT INTO shopping_list(user_seq, client_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
            user, "list-" + UUID.randomUUID());
        return db.query("SELECT " + LIST_COLUMNS + " FROM shopping_list WHERE user_seq = ? AND status = 'ACTIVE'",
            LIST, user).getFirst();
    }

    private ListRow requireActive(long user, String listId) {
        ListRow list = findList(user, listId);
        if (!"ACTIVE".equals(list.status()))
            throw new ResponseStatusException(HttpStatus.CONFLICT, "這張清單已完成，不能再修改");
        return list;
    }

    List<Item> items(long user, long listSeq) {
        return db.query("SELECT " + ITEM_COLUMNS + " FROM shopping_list_item i WHERE i.user_seq = ? AND i.list_seq = ?"
            + " ORDER BY i.created_at, i.seq", ITEM, user, listSeq);
    }

    Map<String, Object> withItems(long user, ListRow list) {
        Map<String, Object> result = list.toMap();
        result.put("items", items(user, list.seq()).stream().map(Item::toMap).toList());
        return result;
    }

    List<Map<String, Object>> lists(long user) {
        return db.query("SELECT " + LIST_COLUMNS + " FROM shopping_list WHERE user_seq = ?"
            + " ORDER BY (status = 'ACTIVE') DESC, completed_at DESC NULLS LAST, seq DESC LIMIT 20", LIST, user)
            .stream().map(ListRow::toMap).toList();
    }

    Map<String, Object> list(long user, String listId) {
        return withItems(user, findList(user, listId));
    }

    /** 取得（必要時建立）目前的 ACTIVE 清單；title 只在新建時採用 */
    @Transactional
    Map<String, Object> openActive(long user, Map<String, Object> body) {
        ListRow active = activeList(user, true);
        Object title = body == null ? null : body.get("title");
        if (title != null) {
            String value = text(title, "title", 80, true);
            db.update("UPDATE shopping_list SET title = ?, updated_at = now() WHERE seq = ?", value, active.seq());
            active = findList(user, active.id());
        }
        return withItems(user, active);
    }

    // ---------- 品項 ----------

    private Item findItem(long user, long listSeq, String itemId) {
        List<Item> found = db.query("SELECT " + ITEM_COLUMNS
            + " FROM shopping_list_item i WHERE i.user_seq = ? AND i.list_seq = ? AND i.client_id = ?",
            ITEM, user, listSeq, LedgerController.clientId(itemId));
        return found.isEmpty() ? null : found.getFirst();
    }

    private Item findItemByPromotion(long user, long listSeq, long promotionSeq) {
        List<Item> found = db.query("SELECT " + ITEM_COLUMNS
            + " FROM shopping_list_item i WHERE i.user_seq = ? AND i.list_seq = ? AND i.promotion_seq = ?",
            ITEM, user, listSeq, promotionSeq);
        return found.isEmpty() ? null : found.getFirst();
    }

    /**
     * 加入品項。特價品：名稱、規格、預估單價一律取資料庫快照；同一筆特價已在清單裡時只把數量加上去。
     * 同一個 client ID 重送（例如網路重試）時直接回傳既有品項，不會多一列。
     */
    @Transactional
    Map<String, Object> addItem(long user, String listId, Map<String, Object> body) {
        ListRow list = requireActive(user, listId);
        Item item = merge(null, body);
        Item existing = findItem(user, list.seq(), item.id());
        if (existing != null) return result(existing, false);
        if (item.promotionId() != null) {
            SupermarketService.Snapshot snapshot = supermarkets.snapshot(item.promotionId());
            item = new Item(item.id(), snapshot.name(), item.quantity(), 0, item.unit(), item.priority(),
                item.bucket(), "WOOLWORTHS", item.note(), snapshot.promotionSeq(), snapshot.packageSize(),
                snapshot.salePriceCents(), null);
            Item same = findItemByPromotion(user, list.seq(), item.promotionId());
            if (same != null) return result(increase(user, list.seq(), same, item.quantity()), true);
        }
        int inserted = db.update("""
            INSERT INTO shopping_list_item(list_seq, user_seq, client_id, promotion_seq, item_name, package_size,
              quantity, purchased_quantity, unit, estimated_unit_price_cents, actual_unit_price_cents,
              priority, trip_bucket, preferred_store, note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT DO NOTHING
            """, list.seq(), user, item.id(), item.promotionId(), item.name(), item.packageSize(), item.quantity(),
            item.purchasedQuantity(), item.unit(), item.estimatedUnitPriceCents(), item.actualUnitPriceCents(),
            item.priority(), item.bucket(), item.store(), item.note());
        if (inserted == 1) return result(item, false);
        // 撞到唯一鍵：同時有另一個請求加了同一筆特價，或這個 ID 已用在其他清單
        if (item.promotionId() != null) {
            Item same = findItemByPromotion(user, list.seq(), item.promotionId());
            if (same != null) return result(increase(user, list.seq(), same, item.quantity()), true);
        }
        throw new ResponseStatusException(HttpStatus.CONFLICT, "品項 ID 重複");
    }

    private Item increase(long user, long listSeq, Item item, int add) {
        int quantity = Math.min(999, item.quantity() + add);
        db.update("""
            UPDATE shopping_list_item SET quantity = ?, updated_at = now()
            WHERE user_seq = ? AND list_seq = ? AND client_id = ?
            """, quantity, user, listSeq, item.id());
        return new Item(item.id(), item.name(), quantity, item.purchasedQuantity(), item.unit(), item.priority(),
            item.bucket(), item.store(), item.note(), item.promotionId(), item.packageSize(),
            item.estimatedUnitPriceCents(), item.actualUnitPriceCents());
    }

    private static Map<String, Object> result(Item item, boolean merged) {
        Map<String, Object> map = item.toMap();
        map.put("merged", merged);
        return map;
    }

    @Transactional
    Map<String, Object> updateItem(long user, String listId, String itemId, Map<String, Object> body) {
        ListRow list = requireActive(user, listId);
        if (body.containsKey("id") && !itemId.equals(body.get("id"))) throw bad("品項 ID 不一致");
        Item existing = findItem(user, list.seq(), itemId);
        if (existing == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "找不到這個品項");
        Item item = merge(existing, body);
        save(user, list.seq(), item);
        return item.toMap();
    }

    private void save(long user, long listSeq, Item item) {
        db.update("""
            UPDATE shopping_list_item SET item_name = ?, package_size = ?, quantity = ?, purchased_quantity = ?,
              unit = ?, estimated_unit_price_cents = ?, actual_unit_price_cents = ?, priority = ?,
              trip_bucket = ?, preferred_store = ?, note = ?, updated_at = now()
            WHERE user_seq = ? AND list_seq = ? AND client_id = ?
            """, item.name(), item.packageSize(), item.quantity(), item.purchasedQuantity(), item.unit(),
            item.estimatedUnitPriceCents(), item.actualUnitPriceCents(), item.priority(), item.bucket(),
            item.store(), item.note(), user, listSeq, item.id());
    }

    @Transactional
    void deleteItem(long user, String listId, String itemId) {
        ListRow list = requireActive(user, listId);
        db.update("DELETE FROM shopping_list_item WHERE user_seq = ? AND list_seq = ? AND client_id = ?",
            user, list.seq(), LedgerController.clientId(itemId));
    }

    // ---------- 舊版 /api/shopping-items 轉接（還沒更新的 App 仍會呼叫） ----------

    List<Map<String, Object>> legacyList(long user) {
        ListRow active = activeList(user, false);
        return active == null ? List.of() : items(user, active.seq()).stream().map(ShoppingListService::legacy).toList();
    }

    /** 舊 App 只認得這些欄位，多給的欄位舊 App 也會忽略；這裡維持原本的回應格式 */
    static Map<String, Object> legacy(Item item) {
        return Map.of("id", item.id(), "name", item.name(), "quantity", item.quantity(),
            "purchasedQuantity", item.purchasedQuantity(), "unit", item.unit(), "priority", item.priority(),
            "bucket", item.bucket(), "store", item.store(), "note", item.note());
    }

    /** 舊版整筆 PUT：先完整驗證（不碰資料庫），再寫進 ACTIVE 清單；價格欄位保持不變 */
    @Transactional
    Map<String, Object> legacySave(long user, String id, Map<String, Object> body) {
        id = LedgerController.clientId(id);
        if (!id.equals(body.get("id"))) throw bad("採買項目 ID 不一致");
        for (String field : List.of("name", "unit", "quantity", "purchasedQuantity", "priority", "bucket", "store"))
            if (body.get(field) == null) throw bad("無效欄位：" + field);
        Item validated = merge(null, Map.of("id", id, "name", body.get("name"), "unit", body.get("unit"),
            "quantity", body.get("quantity"), "purchasedQuantity", body.get("purchasedQuantity"),
            "priority", body.get("priority"), "bucket", body.get("bucket"), "store", body.get("store"),
            "note", body.getOrDefault("note", "")));
        if (validated.name().length() > 120) throw bad("無效欄位：name");
        ListRow active = activeList(user, true);
        Item existing = findItem(user, active.seq(), id);
        if (existing == null) {
            Map<String, Object> created = new LinkedHashMap<>(validated.toMap());
            created.remove("promotionId");
            addItem(user, active.id(), created);
        } else {
            save(user, active.seq(), new Item(id, validated.name(), validated.quantity(), validated.purchasedQuantity(),
                validated.unit(), validated.priority(), validated.bucket(), validated.store(), validated.note(),
                existing.promotionId(), existing.packageSize(), existing.estimatedUnitPriceCents(),
                existing.actualUnitPriceCents()));
        }
        return legacy(validated);
    }

    @Transactional
    void legacyDelete(long user, String id) {
        ListRow active = activeList(user, false);
        if (active != null)
            db.update("DELETE FROM shopping_list_item WHERE user_seq = ? AND list_seq = ? AND client_id = ?",
                user, active.seq(), LedgerController.clientId(id));
    }

    // ---------- 完成採買 ----------

    /**
     * 完成採買：body.expense 是前端用既有支出格式組好的紀錄（金額＝使用者確認的實際總額）。
     * 後端只接受「單次、已付款、飲食／採買」且 ID 為 shopping-list-&lt;清單 ID&gt; 的支出。
     */
    @Transactional
    Map<String, Object> complete(Authentication auth, String listId, Map<String, Object> body) {
        long user = LedgerController.owner(auth);
        listId = LedgerController.clientId(listId);
        List<ListRow> locked = db.query("SELECT " + LIST_COLUMNS
            + " FROM shopping_list WHERE user_seq = ? AND client_id = ? FOR UPDATE", LIST, user, listId);
        if (locked.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "找不到這張採買清單");
        ListRow list = locked.getFirst();
        if ("COMPLETED".equals(list.status())) {
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("list", list.toMap());
            result.put("expenseId", list.expenseId());
            result.put("alreadyCompleted", true);
            ListRow next = activeList(user, false);
            result.put("nextListId", next == null ? null : next.id());
            return result;
        }
        if (!(body.get("expense") instanceof Map<?, ?> rawExpense)) throw bad("缺少支出資料");
        @SuppressWarnings("unchecked")
        Map<String, Object> expense = new LinkedHashMap<>((Map<String, Object>) rawExpense);
        String expenseId = EXPENSE_PREFIX + listId;
        if (!expenseId.equals(expense.get("id"))) throw bad("支出 ID 必須是 " + expenseId);
        if (!"FOOD".equals(expense.get("group")) || !"GROCERIES".equals(expense.get("category"))
            || !"PAID".equals(expense.get("status")) || !"NONE".equals(expense.get("frequency")))
            throw bad("採買支出必須是單次、已付款的「飲食／採買」");
        Integer purchased = db.queryForObject("""
            SELECT count(*)::int FROM shopping_list_item
            WHERE user_seq = ? AND list_seq = ? AND purchased_quantity > 0
            """, Integer.class, user, list.seq());
        if (purchased == null || purchased == 0) throw bad("還沒有標記任何已買的商品");
        long amount = LedgerController.cents(expense.get("amountCents"), false);
        ledger.saveExpense(auth, expenseId, expense);

        db.update("""
            UPDATE shopping_list SET status = 'COMPLETED', completed_at = now(), expense_client_id = ?,
              actual_total_cents = ?, updated_at = now()
            WHERE seq = ?
            """, expenseId, amount, list.seq());
        String nextListId = carryOver(user, list.seq());
        ListRow completed = findList(user, listId);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("list", completed.toMap());
        result.put("expenseId", expenseId);
        result.put("alreadyCompleted", false);
        result.put("nextListId", nextListId);
        return result;
    }

    /**
     * 沒買到的數量移到新的 ACTIVE 清單：完全沒買的整列移過去；買了一部分的，剩下的數量複製成新的一列，
     * 原本那列的數量改成實際買到的數量。全部買齊時不建立新清單。
     */
    private String carryOver(long user, long completedSeq) {
        Integer remaining = db.queryForObject("""
            SELECT count(*)::int FROM shopping_list_item
            WHERE user_seq = ? AND list_seq = ? AND purchased_quantity < quantity
            """, Integer.class, user, completedSeq);
        if (remaining == null || remaining == 0) return null;
        ListRow next = activeList(user, true);
        db.update("""
            UPDATE shopping_list_item SET list_seq = ?, updated_at = now()
            WHERE user_seq = ? AND list_seq = ? AND purchased_quantity = 0
            """, next.seq(), user, completedSeq);
        db.update("""
            INSERT INTO shopping_list_item(list_seq, user_seq, client_id, promotion_seq, item_name, package_size,
              quantity, purchased_quantity, unit, estimated_unit_price_cents, priority, trip_bucket,
              preferred_store, note)
            SELECT ?, user_seq, gen_random_uuid()::text, promotion_seq, item_name, package_size,
              quantity - purchased_quantity, 0, unit, estimated_unit_price_cents, priority, trip_bucket,
              preferred_store, note
            FROM shopping_list_item
            WHERE user_seq = ? AND list_seq = ? AND purchased_quantity > 0 AND purchased_quantity < quantity
            """, next.seq(), user, completedSeq);
        db.update("""
            UPDATE shopping_list_item SET quantity = purchased_quantity, updated_at = now()
            WHERE user_seq = ? AND list_seq = ? AND purchased_quantity > 0 AND purchased_quantity < quantity
            """, user, completedSeq);
        return next.id();
    }
}
