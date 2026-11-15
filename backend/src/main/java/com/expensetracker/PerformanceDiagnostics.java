package com.expensetracker;

import java.lang.management.ManagementFactory;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.boot.flyway.autoconfigure.FlywayMigrationStrategy;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.event.EventListener;

/**
 * P0 效能排查的啟動量測：Flyway 花多久、整個程式多久才能接受請求、容器給了多少 CPU 與記憶體。
 * Render → Logs 搜尋 "STARTUP"。只記錄時間與資源數字，不含連線字串或任何密碼。
 */
@Configuration(proxyBeanMethods = false)
class PerformanceDiagnostics {
    private static final Logger log = LoggerFactory.getLogger("STARTUP");
    private static volatile long flywayMillis = -1;

    /** 包住 DataSource 以量測連線取得與 SQL 時間（見 TimedDataSource），行為不變 */
    @Bean
    static BeanPostProcessor timedDataSourcePostProcessor() {
        return new BeanPostProcessor() {
            @Override
            public Object postProcessAfterInitialization(Object bean, String beanName) {
                return bean instanceof DataSource source && !(bean instanceof TimedDataSource)
                    ? new TimedDataSource(source) : bean;
            }
        };
    }

    /** 與預設行為相同（直接 migrate），只多記錄耗時 */
    @Bean
    FlywayMigrationStrategy timedFlywayMigration() {
        return flyway -> {
            long start = System.nanoTime();
            var result = flyway.migrate();
            flywayMillis = (System.nanoTime() - start) / 1_000_000;
            log.info("STARTUP flyway={}ms applied={}", flywayMillis, result.migrationsExecuted);
        };
    }

    @EventListener(ApplicationReadyEvent.class)
    void ready(ApplicationReadyEvent event) {
        Runtime runtime = Runtime.getRuntime();
        log.info("STARTUP ready={}ms jvmUptime={}ms flyway={}ms cpus={} maxHeap={}MB",
            event.getTimeTaken() == null ? -1 : event.getTimeTaken().toMillis(),
            ManagementFactory.getRuntimeMXBean().getUptime(), flywayMillis,
            runtime.availableProcessors(), runtime.maxMemory() / (1024 * 1024));
    }
}
