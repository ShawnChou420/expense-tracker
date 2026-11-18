package com.expensetracker;

import java.time.Clock;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** 每日小語 API。日期是使用者手機的本地日期（只接受「今天」），會員一律由登入 token 決定。 */
@RestController
@RequestMapping("/api/daily-quotes")
public class DailyQuoteController {
    private final DailyQuoteService quotes;
    private final Clock clock;
    /** 換一句的連點保護：同一會員 2 秒內只處理一次（另有每天上限）。 */
    private final Map<Long, Instant> lastRefresh = new ConcurrentHashMap<>();

    @Autowired
    DailyQuoteController(DailyQuoteService quotes) {
        this(quotes, Clock.systemUTC());
    }

    DailyQuoteController(DailyQuoteService quotes, Clock clock) {
        this.quotes = quotes;
        this.clock = clock;
    }

    @GetMapping("/today")
    Map<String, Object> today(Authentication auth, @RequestParam String date) {
        return quotes.today(LedgerController.owner(auth), LocalDay.today(date, clock));
    }

    @PostMapping("/refresh")
    Map<String, Object> refresh(Authentication auth, @RequestBody Map<String, Object> body) {
        long owner = LedgerController.owner(auth);
        var day = LocalDay.today(body == null ? null : body.get("date"), clock);
        Instant now = clock.instant();
        Instant previous = lastRefresh.put(owner, now);
        if (previous != null && previous.isAfter(now.minusSeconds(2)))
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "慢一點，再按一次就好");
        return quotes.refresh(owner, day);
    }

    /** 訪客首頁用：不需登入，依日期固定一句。 */
    @GetMapping("/sample")
    Map<String, Object> sample(@RequestParam String date) {
        return quotes.sample(LocalDay.today(date, clock));
    }
}
