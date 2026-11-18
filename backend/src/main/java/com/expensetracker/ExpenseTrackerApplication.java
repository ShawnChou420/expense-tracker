package com.expensetracker;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling // 每天清除過期的活動事件（ActivityLog）
public class ExpenseTrackerApplication {
    public static void main(String[] args) {
        // 雲端部署只有 DATABASE_URL 時，轉成 JDBC 設定（系統屬性優先於 application.yml）
        DatabaseUrl.springProperties(System.getenv()).forEach(System::setProperty);
        SpringApplication.run(ExpenseTrackerApplication.class, args);
    }
}
