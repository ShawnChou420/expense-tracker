-- UI 2.0 Sprint 2：會員的首頁自訂（模式 PAY／LIFE、各模組的顯示與順序）。
-- 只新增可為空的欄位；NULL＝沿用系統預設（薪資優先），舊會員不受影響。
-- 內容例：{"mode":"PAY","modules":[{"id":"weekly-pay","visible":true}, ...]}，只存模組 ID，不存顯示文字。
-- user_preferences 已在刪除帳號的清理清單中。
-- 回滾：ALTER TABLE user_preferences DROP COLUMN dashboard_layout;
--       DELETE FROM flyway_schema_history WHERE version = '13';
ALTER TABLE user_preferences ADD COLUMN dashboard_layout JSONB
    CHECK (dashboard_layout IS NULL OR jsonb_typeof(dashboard_layout) = 'object');
