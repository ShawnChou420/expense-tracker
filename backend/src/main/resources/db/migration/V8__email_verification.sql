-- Email 驗證碼：註冊與忘記密碼。只存驗證碼的雜湊，不存明碼。
ALTER TABLE user_info ADD COLUMN email_verified_at TIMESTAMPTZ;

CREATE TABLE email_verification_code (
    id BIGSERIAL PRIMARY KEY,
    email_normalized VARCHAR(320) NOT NULL,
    purpose VARCHAR(20) NOT NULL CHECK (purpose IN ('REGISTER', 'RESET_PASSWORD')),
    code_hash CHAR(64) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_email_code_lookup
    ON email_verification_code(email_normalized, purpose, created_at DESC);
