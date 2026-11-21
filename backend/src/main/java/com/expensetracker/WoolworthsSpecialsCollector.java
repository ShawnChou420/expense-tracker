package com.expensetracker;

import java.util.List;
import java.util.Map;

/**
 * 特價資料供應者。與資料庫、前端無關，只負責「取得原始資料列」，之後換供應者只要換實作。
 *
 * <p>目前的實作都是 CSV（管理員上傳、或排程從設定的 CSV 資料源網址拉取）。
 * 不直接擷取 woolworths.com.au：網站條款 1.4(b)(viii) 禁止以 robot／spider 擷取，
 * 網站內部 endpoint 也不是公開授權的 API。
 */
interface WoolworthsSpecialsCollector {
    /** 一列原始資料：欄位名稱（小寫）→ 文字值；line 是來源中的列號，用於錯誤訊息 */
    record RawRecord(int line, Map<String, String> fields) {}

    /**
     * @param sourceType CSV（上傳）或 FEED（資料源網址）
     * @param sourceName 給人看的來源名稱，例如檔名或資料源主機
     * @param errors     整份來源層級的錯誤（例如缺少必要欄位）；有錯時 records 為空
     */
    record Collected(String sourceType, String sourceName, List<RawRecord> records, List<String> errors) {}

    Collected collect() throws Exception;

    /** 這個供應者是否已設定（例如資料源網址的環境變數），未設定時排程直接跳過 */
    default boolean configured() {
        return true;
    }
}
