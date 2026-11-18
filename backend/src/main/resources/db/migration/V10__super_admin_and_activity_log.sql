-- Super Admin、帳號狀態、使用者活動紀錄、管理員稽核紀錄。
-- 只新增資料表與欄位，不修改或刪除既有資料。

-- 帳號狀態：停用的帳號不能登入，既有登入也會失效。預設 ACTIVE，既有會員不受影響。
ALTER TABLE user_info ADD COLUMN account_status VARCHAR(12) NOT NULL DEFAULT 'ACTIVE'
    CHECK (account_status IN ('ACTIVE', 'DISABLED'));
ALTER TABLE user_info ADD COLUMN status_changed_at TIMESTAMPTZ;

-- 角色：沒有資料列＝一般 USER。只能由受控的初始化工具或既有 SUPER_ADMIN 授予，沒有公開 API。
CREATE TABLE user_role (
    user_seq BIGINT NOT NULL REFERENCES user_info(seq) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('SUPER_ADMIN')),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_seq, role)
);

-- 使用者活動與系統錯誤事件（非敏感摘要）。user_seq 不設外鍵：登入失敗時可能是 NULL，
-- 刪除帳號時事件一併刪除（見 AuthService.ACCOUNT_DELETE_STATEMENTS）。保留 180 天後自動清除。
CREATE TABLE user_activity_event (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_seq BIGINT,
    category VARCHAR(20) NOT NULL CHECK (category IN ('USER', 'API_ERROR', 'PAYSLIP', 'DATABASE', 'ADMIN_SECURITY')),
    event_type VARCHAR(40) NOT NULL,
    status VARCHAR(10) NOT NULL CHECK (status IN ('SUCCESS', 'FAILURE')),
    error_code VARCHAR(60),
    request_id VARCHAR(40),
    details JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(details::text) <= 2000),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_activity_event_time ON user_activity_event(occurred_at DESC);
CREATE INDEX ix_activity_event_user_time ON user_activity_event(user_seq, occurred_at DESC);
CREATE INDEX ix_activity_event_failure ON user_activity_event(status, occurred_at DESC);

-- 管理員稽核紀錄：只能新增。欄位刻意不叫 user_seq，刪除會員時保留稽核紀錄（只有編號，沒有個資）。
CREATE TABLE admin_audit_log (
    audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_seq BIGINT,
    target_seq BIGINT,
    action VARCHAR(40) NOT NULL,
    reason VARCHAR(500) NOT NULL,
    result VARCHAR(10) NOT NULL CHECK (result IN ('SUCCESS', 'FAILURE')),
    details JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(details::text) <= 2000),
    request_id VARCHAR(40),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_admin_audit_time ON admin_audit_log(occurred_at DESC);
CREATE INDEX ix_admin_audit_target ON admin_audit_log(target_seq, occurred_at DESC);

-- 稽核紀錄不可修改；只允許清除超過 2 年保留期限的紀錄。
CREATE FUNCTION protect_admin_audit_log() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'admin_audit_log is append-only';
    END IF;
    IF OLD.occurred_at > now() - interval '2 years' THEN
        RAISE EXCEPTION 'admin_audit_log rows are kept for 2 years';
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_protect_admin_audit_log
    BEFORE UPDATE OR DELETE ON admin_audit_log
    FOR EACH ROW EXECUTE FUNCTION protect_admin_audit_log();
