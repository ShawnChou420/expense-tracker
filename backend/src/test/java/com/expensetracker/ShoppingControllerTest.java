package com.expensetracker;

import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.Authentication;

/** 舊版 /api/shopping-items 轉接到 ShoppingListService，並以登入會員限定資料。 */
class ShoppingControllerTest {
    private final ShoppingListService lists = mock(ShoppingListService.class);
    private final ShoppingController controller = new ShoppingController(lists);
    private final Authentication auth = mock(Authentication.class);

    @Test
    void scopesEveryCallToAuthenticatedMember() {
        when(auth.getPrincipal()).thenReturn(7L);
        controller.list(auth);
        verify(lists).legacyList(7L);
        controller.save(auth, "milk", Map.of("id", "milk"));
        verify(lists).legacySave(eq(7L), eq("milk"), anyMap());
        controller.delete(auth, "milk");
        verify(lists).legacyDelete(7L, "milk");
    }
}
