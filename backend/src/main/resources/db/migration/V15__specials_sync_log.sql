-- 特價同步紀錄：沿用 V14 的 supermarket_import_run，只新增欄位，不改表名、不刪資料。
-- trigger_type：MANUAL（管理員手動）、SCHEDULED（每週排程）、EXTERNAL（外部排程呼叫受保護端點）
-- source_type：CSV（管理員上傳）、FEED（排程從設定的 CSV 資料源網址拉取）
-- 進行中的同步：finished_at 為 NULL。
ALTER TABLE supermarket_import_run
    ADD COLUMN trigger_type VARCHAR(20) NOT NULL DEFAULT 'MANUAL'
        CHECK (trigger_type IN ('MANUAL', 'SCHEDULED', 'EXTERNAL')),
    ADD COLUMN inserted_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN updated_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE supermarket_import_run DROP CONSTRAINT supermarket_import_run_source_type_check;
ALTER TABLE supermarket_import_run
    ADD CONSTRAINT supermarket_import_run_source_type_check CHECK (source_type IN ('CSV', 'FEED'));
