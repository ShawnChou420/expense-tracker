package com.expensetracker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.core.Authentication;
import org.springframework.web.server.ResponseStatusException;

class ShoppingListServiceTest {
    private final JdbcTemplate db = mock(JdbcTemplate.class);
    private final LedgerController ledger = mock(LedgerController.class);
    private final SupermarketService supermarkets = mock(SupermarketService.class);
    private final ShoppingListService service = new ShoppingListService(db, ledger, supermarkets);
    private final Authentication auth = mock(Authentication.class);

    private static ShoppingListService.ListRow list(String status) {
        return new ShoppingListService.ListRow(5L, "list-a", "採買清單", status,
            "COMPLETED".equals(status) ? "2026-11-21T00:00:00Z" : null,
            "COMPLETED".equals(status) ? "shopping-list-list-a" : null, null);
    }

    private static Map<String, Object> expense(String id) {
        return new HashMap<>(Map.of("id", id, "date", "2026-11-21", "amountCents", 2350, "group", "FOOD",
            "category", "GROCERIES", "status", "PAID", "frequency", "NONE"));
    }

    @Test
    void mergeAppliesDefaultsForNewItemsAndValidates() {
        var item = ShoppingListService.merge(null, Map.of("id", "milk", "name", " 牛奶 "));
        assertEquals("牛奶", item.name());
        assertEquals(1, item.quantity());
        assertEquals("件", item.unit());
        assertEquals("NORMAL", item.priority());
        assertEquals("ANY", item.store());
        assertEquals(null, item.estimatedUnitPriceCents());
        assertThrows(ResponseStatusException.class, () -> ShoppingListService.merge(null,
            Map.of("id", "milk", "name", "Milk", "quantity", 1, "purchasedQuantity", 2)));
        assertThrows(ResponseStatusException.class, () -> ShoppingListService.merge(null,
            Map.of("id", "milk", "name", "Milk", "estimatedUnitPriceCents", -1)));
        assertThrows(ResponseStatusException.class, () -> ShoppingListService.merge(null,
            Map.of("id", "milk", "name", "Milk", "estimatedUnitPriceCents", 1.5)));
    }

    @Test
    void partialUpdateKeepsOtherFields() {
        var base = ShoppingListService.merge(null, Map.of("id", "milk", "name", "Milk", "quantity", 3,
            "estimatedUnitPriceCents", 310, "note", "全脂"));
        var updated = ShoppingListService.merge(base, Map.of("purchasedQuantity", 2));
        assertEquals(2, updated.purchasedQuantity());
        assertEquals(3, updated.quantity());
        assertEquals(310, updated.estimatedUnitPriceCents());
        assertEquals("全脂", updated.note());
        assertThrows(ResponseStatusException.class, () -> ShoppingListService.merge(base, Map.of("purchasedQuantity", 4)));
    }

    @Test
    @SuppressWarnings("unchecked")
    void listLookupIsScopedToMember() {
        when(db.query(anyString(), any(RowMapper.class), eq(7L), eq("list-a"))).thenReturn(List.of());
        var error = assertThrows(ResponseStatusException.class, () -> service.list(7L, "list-a"));
        assertEquals(HttpStatus.NOT_FOUND, error.getStatusCode());
        verify(db).query(contains("user_seq = ? AND client_id = ?"), any(RowMapper.class), eq(7L), eq("list-a"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void cannotEditCompletedList() {
        when(db.query(anyString(), any(RowMapper.class), eq(7L), eq("list-a"))).thenReturn(List.of(list("COMPLETED")));
        var error = assertThrows(ResponseStatusException.class,
            () -> service.addItem(7L, "list-a", Map.of("id", "x", "name", "Milk")));
        assertEquals(HttpStatus.CONFLICT, error.getStatusCode());
        verify(db, never()).update(anyString(), any(Object[].class));
    }

    @Test
    @SuppressWarnings("unchecked")
    void addingPromotionUsesDatabaseSnapshotNotClientPrice() {
        when(db.query(contains("FROM shopping_list WHERE"), any(RowMapper.class), eq(7L), eq("list-a")))
            .thenReturn(List.of(list("ACTIVE")));
        when(db.query(contains("i.client_id = ?"), any(RowMapper.class), eq(7L), eq(5L), eq("x"))).thenReturn(List.of());
        when(db.query(contains("i.promotion_seq = ?"), any(RowMapper.class), eq(7L), eq(5L), eq(9L))).thenReturn(List.of());
        when(supermarkets.snapshot(9L)).thenReturn(new SupermarketService.Snapshot(9L, "Tim Tam", "200g", 250));
        when(db.update(contains("INSERT INTO shopping_list_item"), any(Object[].class))).thenReturn(1);
        var result = service.addItem(7L, "list-a", Map.of("id", "x", "name", "fake", "promotionId", 9,
            "estimatedUnitPriceCents", 1));
        assertEquals("Tim Tam", result.get("name"));
        assertEquals(250, result.get("estimatedUnitPriceCents"));
        assertEquals("WOOLWORTHS", result.get("store"));
        assertEquals(false, result.get("merged"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void addingSamePromotionTwiceIncreasesQuantity() {
        when(db.query(contains("FROM shopping_list WHERE"), any(RowMapper.class), eq(7L), eq("list-a")))
            .thenReturn(List.of(list("ACTIVE")));
        when(db.query(contains("i.client_id = ?"), any(RowMapper.class), eq(7L), eq(5L), eq("y"))).thenReturn(List.of());
        var existing = ShoppingListService.merge(null, Map.of("id", "x", "name", "Tim Tam", "quantity", 2,
            "promotionId", 9, "estimatedUnitPriceCents", 250));
        when(db.query(contains("i.promotion_seq = ?"), any(RowMapper.class), eq(7L), eq(5L), eq(9L)))
            .thenReturn(List.of(existing));
        when(supermarkets.snapshot(9L)).thenReturn(new SupermarketService.Snapshot(9L, "Tim Tam", "200g", 250));
        var result = service.addItem(7L, "list-a", Map.of("id", "y", "name", "Tim Tam", "promotionId", 9));
        assertEquals("x", result.get("id"));
        assertEquals(3, result.get("quantity"));
        assertEquals(true, result.get("merged"));
        verify(db, never()).update(contains("INSERT INTO shopping_list_item"), any(Object[].class));
    }

    @Test
    @SuppressWarnings("unchecked")
    void completingTwiceDoesNotRecordExpenseAgain() {
        when(auth.getPrincipal()).thenReturn(7L);
        when(db.query(contains("FOR UPDATE"), any(RowMapper.class), eq(7L), eq("list-a")))
            .thenReturn(List.of(list("COMPLETED")));
        var result = service.complete(auth, "list-a", Map.of("expense", expense("shopping-list-list-a")));
        assertEquals(true, result.get("alreadyCompleted"));
        assertEquals("shopping-list-list-a", result.get("expenseId"));
        verifyNoInteractions(ledger);
    }

    @Test
    @SuppressWarnings("unchecked")
    void completeRejectsForeignExpenseIdAndNonGroceryExpense() {
        when(auth.getPrincipal()).thenReturn(7L);
        when(db.query(contains("FOR UPDATE"), any(RowMapper.class), eq(7L), eq("list-a")))
            .thenReturn(List.of(list("ACTIVE")));
        assertThrows(ResponseStatusException.class,
            () -> service.complete(auth, "list-a", Map.of("expense", expense("other-expense"))));
        var dining = expense("shopping-list-list-a");
        dining.put("category", "DINING");
        assertThrows(ResponseStatusException.class, () -> service.complete(auth, "list-a", Map.of("expense", dining)));
        verifyNoInteractions(ledger);
    }

    @Test
    @SuppressWarnings("unchecked")
    void completeNeedsAtLeastOnePurchasedItem() {
        when(auth.getPrincipal()).thenReturn(7L);
        when(db.query(contains("FOR UPDATE"), any(RowMapper.class), eq(7L), eq("list-a")))
            .thenReturn(List.of(list("ACTIVE")));
        when(db.queryForObject(contains("purchased_quantity > 0"), eq(Integer.class), eq(7L), eq(5L))).thenReturn(0);
        assertThrows(ResponseStatusException.class,
            () -> service.complete(auth, "list-a", Map.of("expense", expense("shopping-list-list-a"))));
        verifyNoInteractions(ledger);
    }

    @Test
    @SuppressWarnings("unchecked")
    void completeRecordsOneExpenseAndMarksListCompleted() {
        when(auth.getPrincipal()).thenReturn(7L);
        // 第一次是 FOR UPDATE 鎖定（ACTIVE），完成後重新讀取（COMPLETED）
        when(db.query(contains("user_seq = ? AND client_id = ?"), any(RowMapper.class), eq(7L), eq("list-a")))
            .thenReturn(List.of(list("ACTIVE")), List.of(list("COMPLETED")));
        when(db.queryForObject(contains("purchased_quantity > 0"), eq(Integer.class), eq(7L), eq(5L))).thenReturn(2);
        when(db.queryForObject(contains("purchased_quantity < quantity"), eq(Integer.class), eq(7L), eq(5L))).thenReturn(0);
        var body = expense("shopping-list-list-a");
        var result = service.complete(auth, "list-a", Map.of("expense", body));
        verify(ledger).saveExpense(eq(auth), eq("shopping-list-list-a"), any());
        verify(db).update(contains("status = 'COMPLETED'"), eq("shopping-list-list-a"), eq(2350L), eq(5L));
        assertEquals(false, result.get("alreadyCompleted"));
        assertEquals(null, result.get("nextListId"));
    }

    @Test
    void legacySaveValidatesBeforeTouchingDatabase() {
        assertThrows(ResponseStatusException.class, () -> service.legacySave(7L, "milk", Map.of(
            "id", "milk", "name", "Milk", "unit", "bottle", "quantity", 1,
            "purchasedQuantity", 2, "priority", "HIGH", "bucket", "NOW", "store", "ANY")));
        assertThrows(ResponseStatusException.class, () -> service.legacySave(7L, "milk", Map.of("id", "other")));
        assertThrows(ResponseStatusException.class, () -> service.legacySave(7L, "milk", Map.of(
            "id", "milk", "name", "x".repeat(121), "unit", "件", "quantity", 1,
            "purchasedQuantity", 0, "priority", "HIGH", "bucket", "NOW", "store", "ANY")));
        verifyNoInteractions(db);
        assertTrue(ShoppingListService.legacy(ShoppingListService.merge(null, Map.of("id", "a", "name", "A")))
            .keySet().containsAll(List.of("id", "name", "quantity", "purchasedQuantity", "unit", "priority",
                "bucket", "store", "note")));
    }
}
