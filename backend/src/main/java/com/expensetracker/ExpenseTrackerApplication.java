package com.expensetracker;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class ExpenseTrackerApplication {
    public static void main(String[] args) {
        // 雲端部署只有 DATABASE_URL 時，轉成 JDBC 設定（系統屬性優先於 application.yml）
        DatabaseUrl.springProperties(System.getenv()).forEach(System::setProperty);
        SpringApplication.run(ExpenseTrackerApplication.class, args);
    }
}
