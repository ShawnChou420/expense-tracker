-- 超市特價（公開共用資料）＋ 採買清單（會員私人資料）
-- 特價資料由 SUPER_ADMIN 以 CSV 匯入；Woolworths 網站條款 1.4(b)(viii) 禁止以 robot／spider 擷取，
-- 因此不做自動爬蟲。金額一律為整數 cents（AUD）。

-- 商品主檔：同一商品不同規格是不同的 external_product_id，各自一列
CREATE TABLE supermarket_product (
    seq BIGSERIAL PRIMARY KEY,
    supermarket_code VARCHAR(20) NOT NULL DEFAULT 'WOOLWORTHS'
        CHECK (supermarket_code IN ('WOOLWORTHS')),
    external_product_id VARCHAR(40) NOT NULL,
    name VARCHAR(200) NOT NULL,
    brand VARCHAR(100),
    package_size VARCHAR(60),
    category VARCHAR(60),
    product_url VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_supermarket_product_external UNIQUE (supermarket_code, external_product_id)
);

-- 每次匯入的紀錄；失敗時不刪除既有特價。imported_by 不是會員私人資料，刪帳號時設為 NULL
CREATE TABLE supermarket_import_run (
    seq BIGSERIAL PRIMARY KEY,
    supermarket_code VARCHAR(20) NOT NULL DEFAULT 'WOOLWORTHS',
    region_code VARCHAR(20) NOT NULL,
    source_type VARCHAR(20) NOT NULL DEFAULT 'CSV' CHECK (source_type IN ('CSV')),
    status VARCHAR(20) NOT NULL CHECK (status IN ('SUCCESS', 'PARTIAL', 'FAILED')),
    row_count INTEGER NOT NULL DEFAULT 0,
    imported_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    error_summary VARCHAR(2000),
    source_reference VARCHAR(200),
    imported_by BIGINT REFERENCES user_info(seq) ON DELETE SET NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
);

-- 特價：同一商品、同一地區、同一期開始日一列；重新匯入同一期時更新價格，保留以前各期作為價格歷史
CREATE TABLE supermarket_promotion (
    seq BIGSERIAL PRIMARY KEY,
    product_seq BIGINT NOT NULL REFERENCES supermarket_product(seq) ON DELETE CASCADE,
    region_code VARCHAR(20) NOT NULL,
    regular_price_cents INTEGER CHECK (regular_price_cents > 0),
    sale_price_cents INTEGER NOT NULL CHECK (sale_price_cents > 0),
    unit_price_text VARCHAR(60),
    promotion_type VARCHAR(20) NOT NULL DEFAULT 'OTHER'
        CHECK (promotion_type IN ('HALF_PRICE', 'PRICE_DROP', 'MULTI_BUY', 'OTHER')),
    promotion_start DATE NOT NULL,
    promotion_end DATE NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    source_reference VARCHAR(200),
    import_run_seq BIGINT REFERENCES supermarket_import_run(seq) ON DELETE SET NULL,
    CONSTRAINT ck_promotion_period CHECK (promotion_end >= promotion_start),
    CONSTRAINT uq_promotion_period UNIQUE (product_seq, region_code, promotion_start)
);

CREATE INDEX ix_promotion_region_period ON supermarket_promotion(region_code, promotion_end, promotion_start);

-- 採買清單：每位會員最多一張 ACTIVE 清單；完成後轉成 COMPLETED 並記下建立的支出 client_id
CREATE TABLE shopping_list (
    seq BIGSERIAL PRIMARY KEY,
    user_seq BIGINT NOT NULL REFERENCES user_info(seq) ON DELETE CASCADE,
    client_id VARCHAR(100) NOT NULL,
    title VARCHAR(80) NOT NULL DEFAULT '採買清單',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED')),
    completed_at TIMESTAMPTZ,
    expense_client_id VARCHAR(100),
    actual_total_cents BIGINT CHECK (actual_total_cents > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_shopping_list_owner_client UNIQUE (user_seq, client_id),
    CONSTRAINT ck_shopping_list_completed CHECK (
        (status = 'ACTIVE' AND completed_at IS NULL)
        OR (status = 'COMPLETED' AND completed_at IS NOT NULL AND expense_client_id IS NOT NULL))
);

CREATE UNIQUE INDEX uq_shopping_list_one_active ON shopping_list(user_seq) WHERE status = 'ACTIVE';

-- 清單品項：加入時保存名稱、規格與價格快照；手動新增的品項沒有 promotion_seq
CREATE TABLE shopping_list_item (
    seq BIGSERIAL PRIMARY KEY,
    list_seq BIGINT NOT NULL REFERENCES shopping_list(seq) ON DELETE CASCADE,
    user_seq BIGINT NOT NULL REFERENCES user_info(seq) ON DELETE CASCADE,
    client_id VARCHAR(100) NOT NULL,
    promotion_seq BIGINT REFERENCES supermarket_promotion(seq) ON DELETE SET NULL,
    item_name VARCHAR(200) NOT NULL,
    package_size VARCHAR(60),
    quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 999),
    purchased_quantity INTEGER NOT NULL DEFAULT 0 CHECK (purchased_quantity >= 0),
    unit VARCHAR(20) NOT NULL DEFAULT '件',
    estimated_unit_price_cents INTEGER CHECK (estimated_unit_price_cents >= 0),
    actual_unit_price_cents INTEGER CHECK (actual_unit_price_cents >= 0),
    priority VARCHAR(10) NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('HIGH', 'NORMAL', 'LOW')),
    trip_bucket VARCHAR(10) NOT NULL DEFAULT 'NOW' CHECK (trip_bucket IN ('NOW', 'LATER')),
    preferred_store VARCHAR(20) NOT NULL DEFAULT 'ANY'
        CHECK (preferred_store IN ('ANY', 'WOOLWORTHS', 'COLES', 'ALDI', 'OTHER')),
    note VARCHAR(240) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_shopping_list_item_owner_client UNIQUE (user_seq, client_id),
    CONSTRAINT ck_shopping_list_item_progress CHECK (purchased_quantity <= quantity)
);

CREATE INDEX ix_shopping_list_item_list ON shopping_list_item(list_seq);
CREATE UNIQUE INDEX uq_shopping_list_item_promotion ON shopping_list_item(list_seq, promotion_seq)
    WHERE promotion_seq IS NOT NULL;

-- 既有資料搬移：每位有 shopping_item 的會員建立一張 ACTIVE 清單，品項原樣複製。
-- shopping_item 表保留不刪（之後確認無誤再另開 migration 處理）。
INSERT INTO shopping_list(user_seq, client_id, title)
SELECT DISTINCT user_seq, 'migrated-v6', '採買清單' FROM shopping_item;

INSERT INTO shopping_list_item(list_seq, user_seq, client_id, item_name, quantity,
    purchased_quantity, unit, priority, trip_bucket, preferred_store, note, created_at, updated_at)
SELECT l.seq, i.user_seq, i.client_id, i.name, i.target_quantity, i.purchased_quantity, i.unit,
    i.priority, i.trip_bucket, i.preferred_store, i.note, i.created_at, i.updated_at
FROM shopping_item i
JOIN shopping_list l ON l.user_seq = i.user_seq AND l.client_id = 'migrated-v6';
