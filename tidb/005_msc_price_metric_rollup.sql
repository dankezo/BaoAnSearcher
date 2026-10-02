-- Precomputed monthly MSC price metrics.
-- This table is refreshed by scripts/tidb/sync_to_tidb.py after every MSC
-- price sync. UI metric reads query at most 24 × province × group rows.
CREATE TABLE IF NOT EXISTS agg_msc_price_monthly (
    ym CHAR(7) NOT NULL,
    province VARCHAR(128) NOT NULL DEFAULT '',
    group_name VARCHAR(128) NOT NULL DEFAULT '',
    revenue DECIMAL(28,2) NOT NULL DEFAULT 0,
    quantity DECIMAL(28,3) NOT NULL DEFAULT 0,
    cnt BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (ym, province, group_name),
    KEY idx_agg_msc_price_monthly_ym (ym)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
