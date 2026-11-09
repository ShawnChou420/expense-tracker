CREATE TABLE shopping_item (
    user_seq BIGINT NOT NULL REFERENCES user_info(seq) ON DELETE CASCADE,
    client_id VARCHAR(100) NOT NULL,
    name VARCHAR(120) NOT NULL,
    target_quantity INTEGER NOT NULL CHECK (target_quantity BETWEEN 1 AND 999),
    purchased_quantity INTEGER NOT NULL DEFAULT 0 CHECK (purchased_quantity >= 0),
    unit VARCHAR(20) NOT NULL DEFAULT '件',
    priority VARCHAR(10) NOT NULL DEFAULT 'NORMAL'
        CHECK (priority IN ('HIGH', 'NORMAL', 'LOW')),
    trip_bucket VARCHAR(10) NOT NULL DEFAULT 'NOW'
        CHECK (trip_bucket IN ('NOW', 'LATER')),
    preferred_store VARCHAR(20) NOT NULL DEFAULT 'ANY'
        CHECK (preferred_store IN ('ANY', 'WOOLWORTHS', 'COLES', 'ALDI', 'OTHER')),
    note VARCHAR(240) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_seq, client_id),
    CONSTRAINT ck_shopping_progress CHECK (purchased_quantity <= target_quantity)
);

CREATE INDEX ix_shopping_item_owner_bucket ON shopping_item(user_seq, trip_bucket, priority);
