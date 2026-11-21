-- i18n：會員的介面語言偏好，與顯示貨幣（display_currency）完全獨立。
-- 只新增可為空的欄位；NULL＝尚未選擇，前端沿用瀏覽器語言或本機 localStorage，舊會員不受影響。
-- user_preferences 已在刪除帳號的清理清單中（AuthService.ACCOUNT_DELETE_STATEMENTS）。
-- 回滾：ALTER TABLE user_preferences DROP COLUMN language;
--       DELETE FROM flyway_schema_history WHERE version = '16';
ALTER TABLE user_preferences ADD COLUMN language VARCHAR(10)
    CHECK (language IS NULL OR language IN ('zh-TW', 'en-AU', 'ja', 'ko'));
