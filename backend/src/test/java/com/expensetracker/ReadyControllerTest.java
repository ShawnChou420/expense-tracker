package com.expensetracker;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.jdbc.core.JdbcTemplate;

/** App 開啟時的等待端點：資料庫能回應才算就緒，否則回 503 讓前端稍後再問。 */
class ReadyControllerTest {
    @Test
    void readyWhenDatabaseAnswers() {
        var db = new JdbcTemplate() {
            @Override
            public <T> T queryForObject(String sql, Class<T> type) {
                return type.cast(1);
            }
        };
        var response = new ReadyController(db).ready();
        assertEquals(200, response.getStatusCode().value());
        assertEquals("ready", response.getBody().get("status"));
    }

    @Test
    void startingWhileDatabaseIsUnavailable() {
        var db = new JdbcTemplate() {
            @Override
            public <T> T queryForObject(String sql, Class<T> type) {
                throw new DataAccessResourceFailureException("waking up");
            }
        };
        var response = new ReadyController(db).ready();
        assertEquals(503, response.getStatusCode().value());
        assertEquals("starting", response.getBody().get("status"));
    }
}
