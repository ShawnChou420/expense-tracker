CREATE TABLE leave_blackout (
    user_seq BIGINT NOT NULL REFERENCES user_info(seq) ON DELETE CASCADE,
    block_date DATE NOT NULL,
    reason VARCHAR(240) NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_seq, block_date)
);
