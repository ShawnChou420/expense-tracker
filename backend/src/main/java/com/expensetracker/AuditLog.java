package com.expensetracker;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 帳號安全事件的稽核紀錄，寫在伺服器 log（Render → Logs 搜尋 "AUDIT"）。
 * 只記會員編號與 Email 雜湊前 12 碼，不記 Email 原文、密碼或 token。
 * 封閉 Beta 先用 log；需要長期保存或後台查詢時再改存資料表（需新 migration）。
 */
final class AuditLog {
    private static final Logger log = LoggerFactory.getLogger("AUDIT");

    private AuditLog() {}

    static void event(String type, Long userSeq, String email) {
        log.info("AUDIT event={} user={} email={}", type, userSeq == null ? "-" : userSeq,
            email == null ? "-" : emailTag(email));
    }

    /** Email 的 SHA-256 前 12 碼：可以比對同一個人，但看不出原文 */
    static String emailTag(String email) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(AuthService.normalizeEmail(email).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest).substring(0, 12);
        } catch (Exception exception) {
            return "unknown";
        }
    }
}
