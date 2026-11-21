package com.expensetracker;

import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * 舊版扁平採買清單 API（V6 shopping_item）。V14 起資料改存在 shopping_list／shopping_list_item，
 * 這裡保留相同的路徑與格式，轉接到會員目前的 ACTIVE 清單，讓還沒更新的 App 不會寫到舊表而遺失資料。
 */
@RestController
@RequestMapping("/api/shopping-items")
public class ShoppingController {
    private final ShoppingListService lists;

    ShoppingController(ShoppingListService lists) {
        this.lists = lists;
    }

    @GetMapping
    List<Map<String, Object>> list(Authentication auth) {
        return lists.legacyList(LedgerController.owner(auth));
    }

    @PutMapping("/{id}")
    Map<String, Object> save(Authentication auth, @PathVariable String id, @RequestBody Map<String, Object> body) {
        return lists.legacySave(LedgerController.owner(auth), id, body);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void delete(Authentication auth, @PathVariable String id) {
        lists.legacyDelete(LedgerController.owner(auth), id);
    }
}
