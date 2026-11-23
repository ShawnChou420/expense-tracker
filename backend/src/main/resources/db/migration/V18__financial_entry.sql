-- Expense Tracker 3.0 Phase 1：通用手動交易（一般收入、資金移轉、外幣單次支出）。
-- 只新增資料表，不修改既有資料表；既有 expense_record／trip／salary_deposit 不搬移。
-- 金額：original_amount_minor 為原始幣別的最小貨幣單位（ISO 4217，AUD／TWD／USD 皆為 2 位）；
-- converted_aud_cents 為換算後的 AUD cents，外幣沒有匯率時為 NULL（不併入 AUD 合計）。
-- fx_rate：1 單位原幣 = fx_rate AUD。
CREATE TABLE financial_entry (
    entry_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_seq BIGINT NOT NULL REFERENCES user_info(seq) ON DELETE CASCADE,
    client_id VARCHAR(100) NOT NULL,
    entry_date DATE NOT NULL,
    entry_type VARCHAR(16) NOT NULL CHECK (entry_type IN ('INCOME', 'EXPENSE', 'TRANSFER')),
    classification VARCHAR(20) NOT NULL CHECK (classification IN ('NORMAL', 'INVESTMENT_PNL', 'REFUND', 'TRANSFER')),
    status VARCHAR(16) NOT NULL CHECK (status IN ('SETTLED', 'PLANNED')),
    category VARCHAR(40) NOT NULL,
    title VARCHAR(120),
    note VARCHAR(500),
    original_amount_minor BIGINT NOT NULL CHECK (original_amount_minor > 0),
    currency CHAR(3) NOT NULL CHECK (currency IN ('AUD', 'TWD', 'USD')),
    converted_aud_cents BIGINT CHECK (converted_aud_cents >= 0),
    fx_rate NUMERIC(20, 10) CHECK (fx_rate > 0),
    fx_rate_date DATE,
    fx_source VARCHAR(20) CHECK (fx_source IN ('MANUAL', 'OPEN_ER_API')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_seq, client_id),
    CONSTRAINT ck_financial_entry_aud CHECK (
        currency <> 'AUD' OR (converted_aud_cents = original_amount_minor AND fx_rate IS NULL)),
    CONSTRAINT ck_financial_entry_fx CHECK (
        currency = 'AUD' OR ((fx_rate IS NULL) = (converted_aud_cents IS NULL))),
    CONSTRAINT ck_financial_entry_transfer CHECK ((entry_type = 'TRANSFER') = (classification = 'TRANSFER'))
);
CREATE INDEX ix_financial_entry_owner_date ON financial_entry(user_seq, entry_date);
