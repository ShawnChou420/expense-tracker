package com.expensetracker;

import java.sql.DriverManager;
import java.util.Map;
import org.flywaydb.core.Flyway;

/** Explicit legacy baseline; never called during normal application startup. */
public final class BaselineExisting {
    private BaselineExisting() {}

    public static void main(String[] args) throws Exception {
        String url = System.getenv("DB_URL");
        String user = System.getenv("DB_USER");
        String password = System.getenv().getOrDefault("DB_PASSWORD", "");
        if (url == null || user == null)
            throw new IllegalStateException("DB_URL and DB_USER are required");
        try (var connection = DriverManager.getConnection(url, user, password)) {
            var metadata = connection.getMetaData();
            Map<String, String[]> required = Map.of(
                "user_info", new String[] { "seq", "user_id", "password_hash", "email" },
                "salary_setting_info", new String[] { "seq", "user_seq", "base_rate" },
                "work_shift_info", new String[] { "seq", "user_seq", "work_date" },
                "expense_record", new String[] { "seq", "user_seq", "expense_date" },
                "sal_job_rate_info", new String[] { "job_rate_id" },
                "sal_shift_txn", new String[] { "job_rate_id" });
            for (var entry : required.entrySet()) {
                for (String column : entry.getValue()) {
                    try (var found = metadata.getColumns(null, "public", entry.getKey(), column)) {
                        if (!found.next()) throw new IllegalStateException("Legacy schema does not match expected structure");
                    }
                }
            }
            try (var history = metadata.getTables(null, "public", "flyway_schema_history", null)) {
                if (history.next()) throw new IllegalStateException("Flyway history already exists");
            }
        }
        Flyway.configure().dataSource(url, user, password).schemas("public")
            .baselineVersion("1").baselineDescription("Reviewed legacy six-table schema")
            .load().baseline();
        System.out.println("Reviewed legacy schema baselined at version 1");
    }
}
