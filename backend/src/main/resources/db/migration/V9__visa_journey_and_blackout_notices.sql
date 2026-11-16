-- 集簽追蹤設定：每位會員一筆。goal = 'NONE' 代表目前不集簽（首頁隱藏進度卡，歷史班表保留）。
-- 只保存使用者輸入的設定；進度一律由班表即時計算，不另存「已完成天數」。
CREATE TABLE visa_journey (
    user_seq BIGINT PRIMARY KEY REFERENCES user_info(seq) ON DELETE CASCADE,
    goal VARCHAR(10) NOT NULL CHECK (goal IN ('SECOND', 'THIRD', 'NONE')),
    visa_subclass VARCHAR(3) CHECK (visa_subclass IN ('417', '462')),
    visa_stage VARCHAR(10) CHECK (visa_stage IN ('FIRST', 'SECOND', 'BRIDGING')),
    stay_until DATE,
    work_start DATE,
    started BOOLEAN NOT NULL DEFAULT FALSE,
    history_dismissed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_visa_journey_dates CHECK (work_start IS NULL OR stay_until IS NULL OR work_start <= stay_until)
);

-- 禁休公告（期間＋主管公告全文）。只是提醒，不影響薪資或集簽天數。
-- 舊的單日禁休（leave_blackout）保留不動，畫面上一起顯示。
CREATE TABLE leave_blackout_notice (
    user_seq BIGINT NOT NULL REFERENCES user_info(seq) ON DELETE CASCADE,
    client_id VARCHAR(100) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    title VARCHAR(120) NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '' CHECK (char_length(body) <= 5000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_seq, client_id),
    CONSTRAINT ck_blackout_notice_period CHECK (end_date >= start_date)
);
CREATE INDEX ix_blackout_notice_owner_start ON leave_blackout_notice(user_seq, start_date);
