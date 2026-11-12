-- 每位會員的工作設定（薪資設定狀態、班別範本、每週排班、Smoko 規則）。
-- 內容格式由前端 src/domain/workProfile.js 定義；後端只驗證大小與基本型別。
CREATE TABLE work_profile (
    user_seq BIGINT PRIMARY KEY REFERENCES user_info(seq) ON DELETE CASCADE,
    profile_json JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 會員確認後的薪資單解析結果。不保存原始 PDF 或密碼；file_sha256 只用來避免重複匯入。
CREATE TABLE payslip_import (
    import_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_seq BIGINT NOT NULL REFERENCES user_info(seq) ON DELETE CASCADE,
    employer_name VARCHAR(120),
    employer_abn VARCHAR(20),
    file_sha256 CHAR(64),
    pay_date DATE NOT NULL,
    period_start DATE,
    period_end DATE,
    gross_cents BIGINT CHECK (gross_cents >= 0),
    tax_cents BIGINT CHECK (tax_cents >= 0),
    net_cents BIGINT NOT NULL CHECK (net_cents >= 0),
    super_cents BIGINT CHECK (super_cents >= 0),
    ytd_gross_cents BIGINT CHECK (ytd_gross_cents >= 0),
    ytd_tax_cents BIGINT CHECK (ytd_tax_cents >= 0),
    ytd_super_cents BIGINT CHECK (ytd_super_cents >= 0),
    items_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    deposit_id UUID REFERENCES salary_deposit(deposit_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_payslip_period CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start)
);
CREATE UNIQUE INDEX uq_payslip_import_file ON payslip_import(user_seq, file_sha256)
    WHERE file_sha256 IS NOT NULL;
CREATE INDEX ix_payslip_import_owner_paid ON payslip_import(user_seq, pay_date DESC);
