package com.expensetracker;

import java.util.List;

/**
 * 預留給之後的「AI 每日批次產生小語」（Phase 3），第一版沒有任何實作，也沒有接任何外部服務。
 *
 * <p>實作時的約定：
 * <ul>
 *   <li>只在後端排程執行，每天產生 5–10 句，API Key 只放後端環境變數，並設每日 token／成本上限。</li>
 *   <li>輸入只能是分類、語言等非個人資料；不可傳送日記、心情、薪資、健康或任何會員資料。</li>
 *   <li>產出需檢查空白、重複、長度（20–60 字）與不當內容，不可捏造名人或古籍出處，
 *       寫入 daily_quote 時 source_type = 'AI'。</li>
 *   <li>失敗時不影響使用者：{@link DailyQuoteService} 一律從既有語錄挑選。</li>
 * </ul>
 */
public interface QuoteGenerationService {
    /** 產生的候選語錄（尚未寫入資料庫）。 */
    record GeneratedQuote(String content, String category, String language) {}

    List<GeneratedQuote> generate(String category, String language, int count);
}
