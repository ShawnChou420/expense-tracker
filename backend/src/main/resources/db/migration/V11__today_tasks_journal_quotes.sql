-- Today Dashboard：每日待辦、每日備註＋心情、每日小語。
-- 只新增資料表，不修改既有資料。日期一律是使用者當地的日曆日（Calendar Date）。

-- 待辦：一列是一個待辦（重複待辦是一條規則）。
-- repeat_type = NONE 時，完成狀態存在本列（is_completed）；
-- 重複待辦的每一次（occurrence）由規則即時推算，不預先產生資料列，
-- 完成狀態另存在 daily_task_completion（以「哪一天」為鍵），
-- 所以今天完成不影響其他天；修改規則也不會改掉已完成的歷史紀錄。
CREATE TABLE daily_task (
    id BIGSERIAL PRIMARY KEY,
    user_seq BIGINT NOT NULL REFERENCES user_info(seq) ON DELETE CASCADE,
    title VARCHAR(80) NOT NULL CHECK (char_length(btrim(title)) > 0),
    description VARCHAR(500) NOT NULL DEFAULT '',
    task_date DATE NOT NULL,
    repeat_type VARCHAR(10) NOT NULL DEFAULT 'NONE' CHECK (repeat_type IN ('NONE', 'DAILY', 'WEEKLY', 'MONTHLY')),
    is_completed BOOLEAN NOT NULL DEFAULT FALSE,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_daily_task_owner_date ON daily_task(user_seq, task_date);

CREATE TABLE daily_task_completion (
    task_id BIGINT NOT NULL REFERENCES daily_task(id) ON DELETE CASCADE,
    user_seq BIGINT NOT NULL REFERENCES user_info(seq) ON DELETE CASCADE,
    occurrence_date DATE NOT NULL,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (task_id, occurrence_date)
);
CREATE INDEX ix_daily_task_completion_owner ON daily_task_completion(user_seq, occurrence_date);

-- 每日備註＋心情：每位會員每天最多一筆。私人紀錄，不寫進活動紀錄、管理後台不顯示。
CREATE TABLE daily_journal (
    id BIGSERIAL PRIMARY KEY,
    user_seq BIGINT NOT NULL REFERENCES user_info(seq) ON DELETE CASCADE,
    journal_date DATE NOT NULL,
    content TEXT NOT NULL DEFAULT '' CHECK (char_length(content) <= 2000),
    mood VARCHAR(10) CHECK (mood IN ('GREAT', 'OKAY', 'TIRED', 'LOW', 'STRESSED')),
    sleep_minutes INTEGER CHECK (sleep_minutes BETWEEN 0 AND 1440), -- 預留，第一版不使用
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_daily_journal_owner_date UNIQUE (user_seq, journal_date)
);

-- 小語：所有會員共用的內容，不是會員私人資料。
CREATE TABLE daily_quote (
    id BIGSERIAL PRIMARY KEY,
    content VARCHAR(200) NOT NULL UNIQUE,
    category VARCHAR(20) NOT NULL CHECK (category IN ('HEALTH', 'MOTIVATION', 'SAVING', 'LIFE', 'PHILOSOPHY', 'WORKING_HOLIDAY')),
    language VARCHAR(10) NOT NULL DEFAULT 'zh-TW',
    author VARCHAR(80),
    source VARCHAR(120),
    source_type VARCHAR(10) NOT NULL DEFAULT 'ORIGINAL' CHECK (source_type IN ('ORIGINAL', 'CLASSIC', 'AI')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 每位會員每天目前顯示的那一句（UNIQUE 保證同時開兩個分頁也只有一筆）。
CREATE TABLE user_daily_quote (
    id BIGSERIAL PRIMARY KEY,
    user_seq BIGINT NOT NULL REFERENCES user_info(seq) ON DELETE CASCADE,
    quote_id BIGINT NOT NULL REFERENCES daily_quote(id),
    quote_date DATE NOT NULL,
    refresh_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_user_daily_quote UNIQUE (user_seq, quote_date)
);

-- 輕量的「看過哪幾句」紀錄（含換掉的），讓最近 30 天去重不受「換一句」影響。保存 60 天。
CREATE TABLE user_quote_history (
    user_seq BIGINT NOT NULL REFERENCES user_info(seq) ON DELETE CASCADE,
    quote_id BIGINT NOT NULL REFERENCES daily_quote(id),
    shown_on DATE NOT NULL,
    PRIMARY KEY (user_seq, quote_id, shown_on)
);
CREATE INDEX ix_user_quote_history_recent ON user_quote_history(user_seq, shown_on);
