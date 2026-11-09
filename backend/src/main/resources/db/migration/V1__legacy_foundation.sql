-- Clean test/new databases only. Existing six-table databases must be reviewed and
-- explicitly baselined at version 1 before V2; baseline-on-migrate stays disabled.
CREATE TABLE user_info (
    seq BIGSERIAL PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(100),
    nickname VARCHAR(50),
    phone VARCHAR(20),
    visa_type VARCHAR(30),
    visa_expiry_date DATE,
    target_savings NUMERIC(12,2) DEFAULT 0,
    create_time TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    update_time TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    update_user VARCHAR(50)
);

CREATE TABLE salary_setting_info (
    seq BIGSERIAL PRIMARY KEY,
    user_seq BIGINT NOT NULL REFERENCES user_info(seq) ON DELETE CASCADE,
    base_rate NUMERIC(10,4) DEFAULT 0,
    casual_loading_rate NUMERIC(10,4) DEFAULT 0,
    shift_loading_rate NUMERIC(10,4) DEFAULT 0,
    saturday_ord_loading_rate NUMERIC(10,4) DEFAULT 0,
    sunday_loading_rate NUMERIC(10,4) DEFAULT 0,
    time_half_rate NUMERIC(10,4) DEFAULT 0,
    double_rate NUMERIC(10,4) DEFAULT 0,
    ppe_allowance NUMERIC(10,4) DEFAULT 0,
    withholding_tax_rate NUMERIC(10,4) DEFAULT 0,
    create_time TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    update_time TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    update_user VARCHAR(50)
);

CREATE TABLE work_shift_info (
    seq BIGSERIAL PRIMARY KEY,
    user_seq BIGINT NOT NULL REFERENCES user_info(seq) ON DELETE CASCADE,
    work_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    total_minutes INTEGER DEFAULT 0,
    smoko_count INTEGER DEFAULT 0,
    gross_pay NUMERIC(12,4) DEFAULT 0,
    create_time TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    update_time TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    update_user VARCHAR(50)
);

CREATE TABLE expense_record (
    seq BIGSERIAL PRIMARY KEY,
    user_seq BIGINT NOT NULL REFERENCES user_info(seq) ON DELETE CASCADE,
    expense_date DATE NOT NULL,
    category VARCHAR(50) NOT NULL,
    amount NUMERIC(12,4) DEFAULT 0,
    remark TEXT,
    create_time TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    update_time TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    update_user VARCHAR(50)
);
