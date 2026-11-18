package com.expensetracker;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * 使用者當地的日曆日。系統沒有儲存時區，日期由前端依裝置時間（本地 YYYY-MM-DD）提供，
 * 所以澳洲各州與夏令時間都以使用者手機為準，不用伺服器的 UTC 日期當作「今天」。
 */
final class LocalDay {
    private LocalDay() {}

    static final LocalDate MIN = LocalDate.of(2000, 1, 1);
    static final LocalDate MAX = LocalDate.of(2100, 12, 31);

    /** 任意日期（待辦、備註可選其他日子）：必須是合法的 YYYY-MM-DD 且在合理範圍內。 */
    static LocalDate parse(Object value, String field) {
        if (!(value instanceof String text) || !text.matches("\\d{4}-\\d{2}-\\d{2}"))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, field + " 必須是 YYYY-MM-DD");
        try {
            LocalDate date = LocalDate.parse(text);
            if (date.isBefore(MIN) || date.isAfter(MAX))
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, field + " 超出可用範圍");
            return date;
        } catch (DateTimeParseException exception) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, field + " 不是有效日期");
        }
    }

    /**
     * 「今天」：前端提供的本地日期，只接受與目前 UTC 日期相差一天以內（世界上所有時區都落在這個範圍），
     * 避免任意指定日期去預先或重複抽取每日小語。
     */
    static LocalDate today(Object value, Clock clock) {
        LocalDate date = parse(value, "date");
        LocalDate utc = LocalDate.now(clock.withZone(ZoneOffset.UTC));
        if (date.isBefore(utc.minusDays(1)) || date.isAfter(utc.plusDays(1)))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "date 必須是今天（請確認手機日期設定）");
        return date;
    }
}
