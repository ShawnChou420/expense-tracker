package com.expensetracker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Map;
import org.junit.jupiter.api.Test;

/** 部署設定：DATABASE_URL 轉換與健康檢查端點。 */
class DeploymentConfigTest {
    @Test
    void convertsRenderConnectionStringToJdbcProperties() {
        Map<String, String> properties = DatabaseUrl.fromConnectionString(
            "postgresql://expense_tracker:s3cr%40t@dpg-abc-a:5432/expense_tracker");
        assertEquals("jdbc:postgresql://dpg-abc-a:5432/expense_tracker", properties.get("spring.datasource.url"));
        assertEquals("expense_tracker", properties.get("spring.datasource.username"));
        assertEquals("s3cr@t", properties.get("spring.datasource.password"));
    }

    @Test
    void keepsQueryParametersAndAllowsMissingPort() {
        Map<String, String> properties = DatabaseUrl.fromConnectionString(
            "postgres://user:pw@db.example.com/app?sslmode=require");
        assertEquals("jdbc:postgresql://db.example.com/app?sslmode=require", properties.get("spring.datasource.url"));
    }

    @Test
    void convertsNeonConnectionStringWithSslParameters() {
        Map<String, String> properties = DatabaseUrl.fromConnectionString(
            "postgresql://neondb_owner:pw@ep-cool-name-123456.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require");
        assertEquals(
            "jdbc:postgresql://ep-cool-name-123456.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
            properties.get("spring.datasource.url"));
        assertEquals("neondb_owner", properties.get("spring.datasource.username"));
    }

    @Test
    void explicitDbUrlWinsSoLocalDevelopmentIsUnchanged() {
        assertTrue(DatabaseUrl.springProperties(Map.of(
            "DB_URL", "jdbc:postgresql://localhost:5432/expense_tracker",
            "DATABASE_URL", "postgresql://u:p@remote/db")).isEmpty());
        assertTrue(DatabaseUrl.springProperties(Map.of()).isEmpty());
        assertFalse(DatabaseUrl.springProperties(Map.of("DATABASE_URL", "postgresql://u:p@remote/db")).isEmpty());
    }

    @Test
    void rejectsInvalidUrlWithoutLeakingThePassword() {
        IllegalStateException error = assertThrows(IllegalStateException.class,
            () -> DatabaseUrl.fromConnectionString("mysql://user:topsecret@host/db"));
        assertFalse(error.getMessage().contains("topsecret"));
        assertThrows(IllegalStateException.class, () -> DatabaseUrl.fromConnectionString("postgresql://user:pw@host"));
    }

    @Test
    void healthEndpointReportsOkWithoutData() {
        assertEquals(Map.of("status", "ok"), new HealthController().health());
    }
}
