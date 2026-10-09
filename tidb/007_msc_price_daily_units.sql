-- Day granularity preserves the same-day prior-year comparison and unit tooltips.
CREATE TABLE IF NOT EXISTS agg_msc_price_daily_units (
    day DATE NOT NULL,
    province VARCHAR(128) NOT NULL DEFAULT '',
    group_name VARCHAR(128) NOT NULL DEFAULT '',
    unit VARCHAR(128) NOT NULL DEFAULT '',
    revenue DECIMAL(28,2) NOT NULL DEFAULT 0,
    quantity DECIMAL(28,3) NOT NULL DEFAULT 0,
    min_price DECIMAL(28,3),
    max_price DECIMAL(28,3),
    cnt BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (day, province, group_name, unit)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
