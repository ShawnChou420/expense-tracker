package com.expensetracker;

import java.time.Clock;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 首頁「今天」一次取回：今日待辦、之前未完成數、備註與心情、每日小語。
 * 薪資與班表不在這裡：計薪只在前端既有的 useShiftCalculator，首頁直接用班表上已算好的金額，
 * 不另外建立第二套計薪。小語取得失敗時回傳 quote = null，不影響其他卡片。
 */
@RestController
@RequestMapping("/api/today")
public class TodayController {
    private static final Logger log = LoggerFactory.getLogger(TodayController.class);
    private final DailyTaskController tasks;
    private final DailyJournalController journal;
    private final DailyQuoteService quotes;
    private final Clock clock;

    @Autowired
    TodayController(DailyTaskController tasks, DailyJournalController journal, DailyQuoteService quotes) {
        this(tasks, journal, quotes, Clock.systemUTC());
    }

    TodayController(DailyTaskController tasks, DailyJournalController journal, DailyQuoteService quotes, Clock clock) {
        this.tasks = tasks;
        this.journal = journal;
        this.quotes = quotes;
        this.clock = clock;
    }

    @GetMapping
    Map<String, Object> today(Authentication auth, @RequestParam String date) {
        long owner = LedgerController.owner(auth);
        LocalDate day = LocalDay.today(date, clock);
        Map<String, Object> result = new HashMap<>();
        result.put("date", day.toString());
        result.put("tasks", tasks.tasksFor(owner, day));
        result.put("overdue", tasks.overdueFor(owner, day));
        result.put("journal", journal.find(owner, day));
        Map<String, Object> quote = null;
        try {
            quote = quotes.today(owner, day);
        } catch (RuntimeException exception) {
            log.warn("daily quote unavailable rid={} error={}", RequestTiming.currentRequestId(),
                exception.getClass().getSimpleName());
        }
        result.put("quote", quote);
        return result;
    }
}
