-- Existing rows remain untouched and unclaimed. New accounts use email_normalized.
ALTER TABLE user_info ADD COLUMN email_normalized VARCHAR(320);
CREATE UNIQUE INDEX uq_user_email_normalized ON user_info(email_normalized)
    WHERE email_normalized IS NOT NULL;

ALTER TABLE salary_setting_info ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'AUD';
CREATE INDEX ix_salary_setting_owner ON salary_setting_info(user_seq);

ALTER TABLE work_shift_info ADD COLUMN client_id VARCHAR(100);
ALTER TABLE work_shift_info ADD COLUMN record_json JSONB;
ALTER TABLE work_shift_info ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'AUD';
ALTER TABLE work_shift_info ADD COLUMN gross_cents BIGINT;
ALTER TABLE work_shift_info ADD COLUMN designated_work BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX uq_work_shift_owner_client ON work_shift_info(user_seq, client_id)
    WHERE client_id IS NOT NULL;
CREATE INDEX ix_work_shift_owner_date ON work_shift_info(user_seq, work_date);

ALTER TABLE expense_record ADD COLUMN client_id VARCHAR(100);
ALTER TABLE expense_record ADD COLUMN record_json JSONB;
ALTER TABLE expense_record ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'AUD';
ALTER TABLE expense_record ADD COLUMN amount_cents BIGINT;
ALTER TABLE expense_record ADD COLUMN group_code VARCHAR(30);
ALTER TABLE expense_record ADD COLUMN status_code VARCHAR(20);
ALTER TABLE expense_record ADD COLUMN frequency_code VARCHAR(20);
CREATE UNIQUE INDEX uq_expense_owner_client ON expense_record(user_seq, client_id)
    WHERE client_id IS NOT NULL;
ALTER TABLE expense_record ADD CONSTRAINT uq_expense_owner_seq UNIQUE (user_seq, seq);
CREATE INDEX ix_expense_owner_date ON expense_record(user_seq, expense_date);

CREATE TABLE user_preferences (
    user_seq BIGINT PRIMARY KEY REFERENCES user_info(seq) ON DELETE CASCADE,
    display_currency CHAR(3) NOT NULL DEFAULT 'AUD',
    work_day_target INTEGER CHECK (work_day_target > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE saving_goal (
    user_seq BIGINT PRIMARY KEY REFERENCES user_info(seq) ON DELETE CASCADE,
    name VARCHAR(80) NOT NULL,
    target_cents BIGINT NOT NULL CHECK (target_cents > 0),
    initial_cents BIGINT NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'AUD',
    start_date DATE NOT NULL,
    end_date DATE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_saving_dates CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE TABLE salary_deposit (
    deposit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_seq BIGINT NOT NULL REFERENCES user_info(seq) ON DELETE CASCADE,
    paid_on DATE NOT NULL,
    period_start DATE,
    period_end DATE,
    gross_cents BIGINT CHECK (gross_cents >= 0),
    tax_cents BIGINT CHECK (tax_cents >= 0),
    net_cents BIGINT NOT NULL CHECK (net_cents >= 0),
    currency CHAR(3) NOT NULL DEFAULT 'AUD',
    source_ref VARCHAR(120),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_salary_period CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start)
);
CREATE INDEX ix_salary_deposit_owner_paid ON salary_deposit(user_seq, paid_on);
CREATE UNIQUE INDEX uq_salary_deposit_source ON salary_deposit(user_seq, source_ref)
    WHERE source_ref IS NOT NULL;

CREATE TABLE passenger (
    passenger_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_seq BIGINT NOT NULL REFERENCES user_info(seq) ON DELETE CASCADE,
    client_id VARCHAR(100) NOT NULL,
    name VARCHAR(100) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    default_one_way_cents BIGINT CHECK (default_one_way_cents >= 0),
    default_round_trip_cents BIGINT CHECK (default_round_trip_cents >= 0),
    currency CHAR(3) NOT NULL DEFAULT 'AUD',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_seq, passenger_id),
    UNIQUE (user_seq, client_id)
);
CREATE INDEX ix_passenger_owner_active ON passenger(user_seq, active);

CREATE TABLE trip (
    trip_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_seq BIGINT NOT NULL REFERENCES user_info(seq) ON DELETE CASCADE,
    client_id VARCHAR(100) NOT NULL,
    trip_date DATE NOT NULL,
    trip_type VARCHAR(20) NOT NULL,
    trip_mode VARCHAR(20) NOT NULL,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_seq, trip_id),
    UNIQUE (user_seq, client_id)
);
CREATE INDEX ix_trip_owner_date ON trip(user_seq, trip_date);

CREATE TABLE trip_charge (
    charge_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_seq BIGINT NOT NULL,
    trip_id UUID NOT NULL,
    passenger_id UUID NOT NULL,
    agreed_cents BIGINT CHECK (agreed_cents >= 0),
    currency CHAR(3) NOT NULL DEFAULT 'AUD',
    amount_status VARCHAR(20) NOT NULL DEFAULT 'UNSET',
    FOREIGN KEY (user_seq, trip_id) REFERENCES trip(user_seq, trip_id) ON DELETE CASCADE,
    FOREIGN KEY (user_seq, passenger_id) REFERENCES passenger(user_seq, passenger_id),
    UNIQUE (user_seq, charge_id),
    UNIQUE (trip_id, passenger_id)
);
CREATE INDEX ix_trip_charge_owner_passenger ON trip_charge(user_seq, passenger_id);

CREATE TABLE trip_payment (
    payment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_seq BIGINT NOT NULL,
    charge_id UUID NOT NULL,
    received_on DATE NOT NULL,
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    currency CHAR(3) NOT NULL DEFAULT 'AUD',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (user_seq, charge_id) REFERENCES trip_charge(user_seq, charge_id) ON DELETE CASCADE
);
CREATE INDEX ix_trip_payment_owner_date ON trip_payment(user_seq, received_on);

CREATE TABLE expense_payment (
    payment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_seq BIGINT NOT NULL REFERENCES user_info(seq) ON DELETE CASCADE,
    expense_seq BIGINT NOT NULL,
    occurrence_date DATE NOT NULL,
    paid_on DATE NOT NULL,
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    currency CHAR(3) NOT NULL DEFAULT 'AUD',
    FOREIGN KEY (user_seq, expense_seq) REFERENCES expense_record(user_seq, seq) ON DELETE CASCADE,
    UNIQUE (expense_seq, occurrence_date)
);
CREATE INDEX ix_expense_payment_owner_date ON expense_payment(user_seq, paid_on);

CREATE TABLE auth_session (
    token_hash CHAR(64) PRIMARY KEY,
    user_seq BIGINT NOT NULL REFERENCES user_info(seq) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_auth_session_owner ON auth_session(user_seq, expires_at);
