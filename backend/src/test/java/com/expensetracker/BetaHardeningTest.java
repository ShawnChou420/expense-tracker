package com.expensetracker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/** 封閉 Beta 前補的防護：錯誤不回 500、請求大小上限、稽核紀錄不含 Email 原文。 */
class BetaHardeningTest {
    private final ApiErrorHandler errors = new ApiErrorHandler();

    @Test
    void databaseConflictsBecomeClientErrorsWithoutSqlDetails() {
        var duplicate = errors.duplicate(new DuplicateKeyException("duplicate key salary_deposit_pkey"));
        assertEquals(HttpStatus.CONFLICT, duplicate.getStatusCode());
        assertFalse(duplicate.getBody().get("detail").contains("salary_deposit"));
        assertEquals(HttpStatus.BAD_REQUEST,
            errors.integrity(new DataIntegrityViolationException("fk violation")).getStatusCode());
        assertEquals(HttpStatus.BAD_REQUEST, errors.badInput(new ClassCastException()).getStatusCode());
    }

    @Test
    void rejectsOversizedRequestBodies() throws Exception {
        var filter = new RequestSizeFilter();
        var big = new MockHttpServletRequest("PUT", "/api/expenses/x");
        big.setContent(new byte[(int) RequestSizeFilter.MAX_BODY_BYTES + 1]);
        var response = new MockHttpServletResponse();
        var chain = new MockFilterChain();
        filter.doFilter(big, response, chain);
        assertEquals(413, response.getStatus());
        assertEquals(null, chain.getRequest());

        var normal = new MockHttpServletRequest("PUT", "/api/expenses/x");
        normal.setContent("{\"id\":\"x\"}".getBytes());
        var okChain = new MockFilterChain();
        filter.doFilter(normal, new MockHttpServletResponse(), okChain);
        assertTrue(okChain.getRequest() != null);
    }

    @Test
    void auditTagHidesEmailButMatchesSamePerson() {
        String tag = AuditLog.emailTag("Someone@Example.com");
        assertEquals(12, tag.length());
        assertFalse(tag.contains("someone"));
        assertEquals(tag, AuditLog.emailTag(" someone@example.com "));
        assertNotEquals(tag, AuditLog.emailTag("other@example.com"));
    }
}
