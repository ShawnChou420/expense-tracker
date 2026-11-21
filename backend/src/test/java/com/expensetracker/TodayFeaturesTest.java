package com.expensetracker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.random.RandomGenerator;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.web.server.ResponseStatusException;

/** Today Dashboard：日期、重複待辦、備註心情、每日小語。 */
class TodayFeaturesTest {
    private static final LocalDate DAY = LocalDate.of(2026, 11, 18);
    private final JdbcTemplate db = mock(JdbcTemplate.class);

    private static UsernamePasswordAuthenticationToken member(long seq) {
        return new UsernamePasswordAuthenticationToken(seq, null, List.of());
    }

    // --- 日期 ---

    @Test
    void todayAcceptsEveryAustralianTimeZoneButNotArbitraryDates() {
        // UTC 2026-11-18 13:30 = 雪梨 11/19 00:30（夏令 +11）、伯斯 11/18 21:30（+8）
        Clock clock = Clock.fixed(Instant.parse("2026-11-18T13:30:00Z"), ZoneOffset.UTC);
        assertEquals(LocalDate.of(2026, 11, 19), LocalDay.today("2026-11-19", clock));
        assertEquals(DAY, LocalDay.today("2026-11-18", clock));
        assertThrows(ResponseStatusException.class, () -> LocalDay.today("2026-11-21", clock));
        assertThrows(ResponseStatusException.class, () -> LocalDay.today("2026-02-30", clock));
        assertThrows(ResponseStatusException.class, () -> LocalDay.today(null, clock));
        assertThrows(ResponseStatusException.class, () -> LocalDay.parse("18/11/2026", "date"));
    }

    // --- 待辦 ---

    @Test
    void recurringRulesOccurOnTheRightDays() {
        LocalDate wednesday = DAY; // 2026-11-18 是星期三
        assertTrue(DailyTaskController.occursOn("NONE", wednesday, wednesday));
        assertFalse(DailyTaskController.occursOn("NONE", wednesday, wednesday.plusDays(1)));
        assertTrue(DailyTaskController.occursOn("DAILY", wednesday, wednesday.plusDays(40)));
        assertFalse(DailyTaskController.occursOn("DAILY", wednesday, wednesday.minusDays(1)));
        assertTrue(DailyTaskController.occursOn("WEEKLY", wednesday, wednesday.plusWeeks(3)));
        assertFalse(DailyTaskController.occursOn("WEEKLY", wednesday, wednesday.plusDays(3)));
        // 每月 31 號：沒有 31 號的月份用月底
        LocalDate jan31 = LocalDate.of(2027, 1, 31);
        assertTrue(DailyTaskController.occursOn("MONTHLY", jan31, LocalDate.of(2027, 2, 28)));
        assertTrue(DailyTaskController.occursOn("MONTHLY", jan31, LocalDate.of(2027, 3, 31)));
        assertFalse(DailyTaskController.occursOn("MONTHLY", jan31, LocalDate.of(2027, 3, 30)));
    }

    @Test
    void taskInputIsValidated() {
        assertThrows(ResponseStatusException.class, () -> DailyTaskController.title("   "));
        assertThrows(ResponseStatusException.class, () -> DailyTaskController.title("x".repeat(81)));
        assertEquals("買菜", DailyTaskController.title("  買菜 "));
        assertThrows(ResponseStatusException.class, () -> DailyTaskController.repeatType("YEARLY"));
        assertEquals("NONE", DailyTaskController.repeatType(null));
        assertThrows(ResponseStatusException.class, () -> DailyTaskController.description("x".repeat(501)));
    }

    @SuppressWarnings("unchecked")
    @Test
    void completingARecurringTaskOnlyMarksThatDay() {
        var controller = new DailyTaskController(db);
        Map<String, Object> rule = new HashMap<>(Map.of("id", 5L, "title", "健身", "description", "",
            "taskDate", "2026-11-01", "repeatType", "DAILY", "completed", false));
        when(db.query(anyString(), any(RowMapper.class), eq(5L), eq(7L))).thenReturn(List.of(rule));
        when(db.queryForObject(anyString(), eq(Integer.class), eq(5L), eq(7L), eq(DAY))).thenReturn(1);
        var result = controller.update(member(7), 5, Map.of("completed", true, "occurrenceDate", "2026-11-18"));
        verify(db).update(startsWith("INSERT INTO daily_task_completion"), eq(5L), eq(7L), eq(DAY));
        // 不會改到規則本身的完成狀態，所以其他天不受影響
        verify(db, never()).update(startsWith("UPDATE daily_task SET is_completed"), any(Object[].class));
        assertEquals(true, result.get("completed"));
        assertThrows(ResponseStatusException.class,
            () -> controller.update(member(7), 5, Map.of("completed", true, "occurrenceDate", "2026-10-31")));
    }

    @SuppressWarnings("unchecked")
    @Test
    void otherMembersTasksAreNotFound() {
        var controller = new DailyTaskController(db);
        when(db.query(anyString(), any(RowMapper.class), eq(5L), eq(8L))).thenReturn(List.of());
        var error = assertThrows(ResponseStatusException.class,
            () -> controller.update(member(8), 5, Map.of("completed", true)));
        assertEquals(HttpStatus.NOT_FOUND, error.getStatusCode());
        when(db.update(startsWith("DELETE FROM daily_task"), eq(5L), eq(8L))).thenReturn(0);
        assertThrows(ResponseStatusException.class, () -> controller.delete(member(8), 5));
    }

    @Test
    void everyTaskAndJournalQueryIsScopedToTheMember() throws Exception {
        for (String file : List.of("DailyTaskController.java", "DailyJournalController.java")) {
            String source = Files.readString(Path.of("src/main/java/com/expensetracker/" + file));
            var sql = Pattern.compile("\"\"\"(.*?)\"\"\"|\"((?:SELECT|UPDATE|DELETE|INSERT)[^\"]*)\"", Pattern.DOTALL)
                .matcher(source);
            int count = 0;
            while (sql.find()) {
                String statement = sql.group(1) != null ? sql.group(1) : sql.group(2);
                if (!statement.matches("(?s)\\s*(SELECT|UPDATE|DELETE|INSERT).*")) continue;
                count++;
                assertTrue(statement.contains("user_seq"), file + " 查詢沒有限定會員：" + statement);
            }
            assertTrue(count >= 2, file);
        }
    }

    // --- 備註與心情 ---

    @Test
    void journalValidatesMoodAndLength() {
        assertEquals("TIRED", DailyJournalController.mood("TIRED"));
        assertNull(DailyJournalController.mood(null));
        assertThrows(ResponseStatusException.class, () -> DailyJournalController.mood("ANGRY"));
        assertThrows(ResponseStatusException.class, () -> DailyJournalController.content("字".repeat(2001)));
        assertEquals("", DailyJournalController.content(null));
    }

    @SuppressWarnings("unchecked")
    @Test
    void savingOnlyTheMoodKeepsTheNote() {
        var controller = new DailyJournalController(db);
        Map<String, Object> existing = new HashMap<>(Map.of("content", "今天去買菜", "saved", true));
        existing.put("mood", "OKAY");
        when(db.query(anyString(), any(RowMapper.class), eq(7L), eq(DAY))).thenReturn(List.of(existing));
        controller.save(member(7), "2026-11-18", Map.of("mood", "GREAT"));
        verify(db).update(startsWith("INSERT INTO daily_journal"), eq(7L), eq(DAY), eq("今天去買菜"), eq("GREAT"));
        assertThrows(ResponseStatusException.class, () -> controller.save(member(7), "2026-11-18", Map.of()));
    }

    @Test
    void privateJournalIsNeverWrittenToActivityLogs() throws Exception {
        for (String file : List.of("DailyJournalController.java", "DailyTaskController.java")) {
            String source = Files.readString(Path.of("src/main/java/com/expensetracker/" + file));
            assertFalse(source.contains("ActivityLog") || source.contains("log."), file + " 不應記錄私人內容");
        }
        String admin = Files.readString(Path.of("src/main/java/com/expensetracker/AdminController.java"));
        assertFalse(admin.contains("daily_journal"), "管理後台不可讀取私人備註與心情");
    }

    // --- 每日小語 ---

    @Test
    void picksAvoidRecentQuotesThenRelax() {
        var service = new DailyQuoteService(db, RandomGenerator.of("L64X128MixRandom"));
        when(db.queryForList(startsWith("SELECT id FROM daily_quote"), eq(Long.class), eq("en-AU")))
            .thenReturn(List.of(1L, 2L, 3L));
        // 最近 30 天看過 1、2 → 只剩 3
        when(db.queryForList(startsWith("SELECT DISTINCT quote_id"), eq(Long.class), eq(7L), eq(DAY.minusDays(30))))
            .thenReturn(List.of(1L, 2L));
        for (int i = 0; i < 20; i++) assertEquals(3L, service.pick(7, DAY, null));
        // 30 天內全看過、7 天內只看過 3 → 從 1、2 挑
        when(db.queryForList(startsWith("SELECT DISTINCT quote_id"), eq(Long.class), eq(7L), eq(DAY.minusDays(30))))
            .thenReturn(List.of(1L, 2L, 3L));
        when(db.queryForList(startsWith("SELECT DISTINCT quote_id"), eq(Long.class), eq(7L), eq(DAY.minusDays(7))))
            .thenReturn(List.of(3L));
        for (int i = 0; i < 20; i++) assertNotEquals(3L, service.pick(7, DAY, null));
        // 全部都看過：至少不是目前這一句
        when(db.queryForList(startsWith("SELECT DISTINCT quote_id"), eq(Long.class), eq(7L), eq(DAY.minusDays(7))))
            .thenReturn(List.of(1L, 2L, 3L));
        for (int i = 0; i < 20; i++) assertNotEquals(2L, service.pick(7, DAY, 2L));
    }

    @Test
    void productionCodeOnlyUsesRandomFromJavaBase() throws Exception {
        // 正式環境是精簡 JRE：RandomGenerator.getDefault()/of() 需要 jdk.random 模組，缺少時服務無法啟動
        try (var files = Files.walk(Path.of("src/main/java"))) {
            for (Path file : files.filter(path -> path.toString().endsWith(".java")).toList()) {
                String source = Files.readString(file);
                assertFalse(source.contains("RandomGenerator.getDefault") || source.contains("RandomGenerator.of("),
                    file + " 使用了需要 jdk.random 模組的亂數產生器");
            }
        }
        new DailyQuoteService(db); // 預設建構子可在只有 java.base 的環境建立
    }

    @SuppressWarnings("unchecked")
    @Test
    void sameDayReturnsTheStoredQuoteWithoutPickingAgain() {
        var service = new DailyQuoteService(db);
        Map<String, Object> stored = new HashMap<>(Map.of("quoteId", 9L, "content", "休息一下"));
        when(db.query(startsWith("SELECT q.id"), any(RowMapper.class), eq(7L), eq(DAY))).thenReturn(List.of(stored));
        assertEquals(9L, service.today(7, DAY).get("quoteId"));
        verify(db, never()).update(startsWith("INSERT INTO user_daily_quote"), any(Object[].class));
    }

    @SuppressWarnings("unchecked")
    @Test
    void refreshStopsAtTheDailyLimit() {
        var service = new DailyQuoteService(db);
        Map<String, Object> stored = new HashMap<>(Map.of("quoteId", 1L, "content", "休息一下"));
        when(db.query(startsWith("SELECT q.id"), any(RowMapper.class), eq(7L), eq(DAY))).thenReturn(List.of(stored));
        when(db.queryForList(startsWith("SELECT id FROM daily_quote"), eq(Long.class), eq("en-AU")))
            .thenReturn(List.of(1L, 2L));
        when(db.queryForList(startsWith("SELECT DISTINCT quote_id"), eq(Long.class), eq(7L), any(LocalDate.class)))
            .thenReturn(List.of());
        when(db.update(startsWith("UPDATE user_daily_quote"), eq(2L), eq(7L), eq(DAY), eq(DailyQuoteService.MAX_REFRESH)))
            .thenReturn(0);
        var error = assertThrows(ResponseStatusException.class, () -> service.refresh(7, DAY));
        assertEquals(HttpStatus.TOO_MANY_REQUESTS, error.getStatusCode());
    }

    @Test
    void refreshDoubleTapIsThrottled() {
        var service = mock(DailyQuoteService.class);
        Clock clock = Clock.fixed(Instant.parse("2026-11-18T01:00:00Z"), ZoneOffset.UTC);
        var controller = new DailyQuoteController(service, clock);
        controller.refresh(member(7), Map.of("date", "2026-11-18"));
        var error = assertThrows(ResponseStatusException.class,
            () -> controller.refresh(member(7), Map.of("date", "2026-11-18")));
        assertEquals(HttpStatus.TOO_MANY_REQUESTS, error.getStatusCode());
        controller.refresh(member(8), Map.of("date", "2026-11-18")); // 其他會員不受影響
        verify(service).refresh(8L, DAY);
    }

    @Test
    void dashboardStillWorksWhenQuotesFail() {
        var tasks = mock(DailyTaskController.class);
        var journal = mock(DailyJournalController.class);
        var quotes = mock(DailyQuoteService.class);
        when(quotes.today(7L, DAY)).thenThrow(new IllegalStateException("db"));
        when(journal.find(7L, DAY)).thenReturn(Map.of("content", ""));
        Clock clock = Clock.fixed(Instant.parse("2026-11-18T01:00:00Z"), ZoneOffset.UTC);
        var result = new TodayController(tasks, journal, quotes, clock).today(member(7), "2026-11-18");
        assertNull(result.get("quote"));
        assertEquals(Map.of("content", ""), result.get("journal"));
        verify(tasks).tasksFor(7L, DAY);
    }

    @Test
    void seedHasOneHundredOriginalQuotesInRange() throws Exception {
        String seed = Files.readString(Path.of("src/main/resources/db/migration/V12__seed_daily_quotes.sql"));
        var rows = Pattern.compile("\\('([^']+)', '(\\w+)', 'zh-TW', 'ORIGINAL'\\)").matcher(seed);
        var contents = new java.util.HashSet<String>();
        var categories = new java.util.HashSet<String>();
        while (rows.find()) {
            String content = rows.group(1);
            assertTrue(content.length() >= 20 && content.length() <= 60, "長度不在 20–60：" + content);
            contents.add(content);
            categories.add(rows.group(2));
        }
        assertEquals(100, contents.size());
        assertEquals(java.util.Set.of("HEALTH", "MOTIVATION", "SAVING", "LIFE", "PHILOSOPHY", "WORKING_HOLIDAY"),
            categories);
        assertTrue(seed.contains("ON CONFLICT (content) DO NOTHING"));
    }

    @Test
    void aussiePhrasesSeedHasTranslationAndNoteForEveryRow() throws Exception {
        assertEquals("en-AU", DailyQuoteService.LANGUAGE);
        String seed = Files.readString(Path.of("src/main/resources/db/migration/V17__aussie_daily_phrases.sql"));
        assertTrue(seed.contains("ADD COLUMN translation VARCHAR(200)"));
        assertTrue(seed.contains("ADD COLUMN note VARCHAR(300)"));
        assertTrue(seed.contains("ON CONFLICT (content) DO NOTHING"));
        // 每一列：英文句子、中文翻譯、用法說明都不可空白；句子不用半形單引號（避免 SQL 跳脫出錯）
        var rows = Pattern.compile(
            "\\('([^']+)', '([^']+)', '([^']+)', '(LIFE|WORKING_HOLIDAY)', 'en-AU', 'ORIGINAL'\\)").matcher(seed);
        var contents = new java.util.HashSet<String>();
        int count = 0;
        while (rows.find()) {
            count++;
            String content = rows.group(1);
            assertTrue(content.length() <= 200, "句子太長：" + content);
            assertTrue(rows.group(2).length() <= 200, "翻譯太長：" + content);
            assertTrue(rows.group(3).length() <= 300, "說明太長：" + content);
            assertTrue(content.matches("[\\x20-\\x7E’]+"), "句子應為英文：" + content);
            contents.add(content);
        }
        assertEquals(60, count, "每一列都要符合格式");
        assertEquals(60, contents.size(), "句子不可重複");
        // 至少要多於「避開最近 30 天」的天數，否則去重很快失效
        assertTrue(contents.size() > DailyQuoteService.AVOID_DAYS);
    }
}
