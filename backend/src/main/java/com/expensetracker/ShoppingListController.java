package com.expensetracker;

import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** 採買清單 API：全部需要登入，資料歸屬由 ShoppingListService 以 user_seq 限定。 */
@RestController
@RequestMapping("/api/shopping-lists")
class ShoppingListController {
    private final ShoppingListService service;

    ShoppingListController(ShoppingListService service) {
        this.service = service;
    }

    @GetMapping
    List<Map<String, Object>> lists(Authentication auth) {
        return service.lists(LedgerController.owner(auth));
    }

    /** 取得（沒有就建立）目前的 ACTIVE 清單，回傳含品項 */
    @PostMapping
    Map<String, Object> open(Authentication auth, @RequestBody(required = false) Map<String, Object> body) {
        return service.openActive(LedgerController.owner(auth), body);
    }

    @GetMapping("/{id}")
    Map<String, Object> list(Authentication auth, @PathVariable String id) {
        return service.list(LedgerController.owner(auth), id);
    }

    @PostMapping("/{id}/items")
    Map<String, Object> addItem(Authentication auth, @PathVariable String id, @RequestBody Map<String, Object> body) {
        return service.addItem(LedgerController.owner(auth), id, body);
    }

    @PatchMapping("/{id}/items/{itemId}")
    Map<String, Object> updateItem(Authentication auth, @PathVariable String id, @PathVariable String itemId,
                                   @RequestBody Map<String, Object> body) {
        return service.updateItem(LedgerController.owner(auth), id, itemId, body);
    }

    @DeleteMapping("/{id}/items/{itemId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void deleteItem(Authentication auth, @PathVariable String id, @PathVariable String itemId) {
        service.deleteItem(LedgerController.owner(auth), id, itemId);
    }

    @PostMapping("/{id}/complete")
    Map<String, Object> complete(Authentication auth, @PathVariable String id, @RequestBody Map<String, Object> body) {
        return service.complete(auth, id, body);
    }
}
