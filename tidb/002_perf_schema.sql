-- TiDB perf schema. Run after tidb/001_search_schema.sql. Do not run against SQLite.
-- Idempotent: each block checks information_schema and becomes SELECT 1 when already applied.
--
-- Search contract (do not replace with MATCH AGAINST):
--   substring stays LIKE '%word%' on columns folded at ingest.
--   Fold algorithm, shared by server/common.py fold() and web/src/api.js fold():
--     lowercase, đ/Đ → d, NFD, drop combining marks.
--   Dirty money/dates: typed column NULL, original text kept in *_raw.
--
-- TiFlash statements at the bottom are TiDB-only.

-- ---------------------------------------------------------------------------
-- Helpers are inline. @sql / @has / @typ are reused one statement at a time.
-- ---------------------------------------------------------------------------

-- vss_bids money
SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'vss_bids' AND column_name = 'gia_raw');
SET @typ := (SELECT DATA_TYPE FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'vss_bids' AND column_name = 'gia');
SET @sql := IF(@has > 0, 'SELECT 1', IF(@typ IS NULL, 'ALTER TABLE vss_bids ADD COLUMN gia_raw VARCHAR(64) NULL', IF(@typ = 'decimal', 'ALTER TABLE vss_bids ADD COLUMN gia_raw VARCHAR(64) NULL', 'ALTER TABLE vss_bids CHANGE COLUMN gia gia_raw VARCHAR(64) NULL')));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'vss_bids' AND column_name = 'gia' AND data_type = 'decimal');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE vss_bids ADD COLUMN gia DECIMAL(15,2) NULL');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'vss_bids' AND column_name = 'thanhtien_raw');
SET @typ := (SELECT DATA_TYPE FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'vss_bids' AND column_name = 'thanhtien');
SET @sql := IF(@has > 0, 'SELECT 1', IF(@typ IS NULL, 'ALTER TABLE vss_bids ADD COLUMN thanhtien_raw VARCHAR(64) NULL', IF(@typ = 'decimal', 'ALTER TABLE vss_bids ADD COLUMN thanhtien_raw VARCHAR(64) NULL', 'ALTER TABLE vss_bids CHANGE COLUMN thanhtien thanhtien_raw VARCHAR(64) NULL')));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'vss_bids' AND column_name = 'thanhtien' AND data_type = 'decimal');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE vss_bids ADD COLUMN thanhtien DECIMAL(15,2) NULL');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'vss_bids' AND column_name = 'soluong_raw');
SET @typ := (SELECT DATA_TYPE FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'vss_bids' AND column_name = 'soluong');
SET @sql := IF(@has > 0, 'SELECT 1', IF(@typ IS NULL, 'ALTER TABLE vss_bids ADD COLUMN soluong_raw VARCHAR(64) NULL', IF(@typ = 'decimal', 'ALTER TABLE vss_bids ADD COLUMN soluong_raw VARCHAR(64) NULL', 'ALTER TABLE vss_bids CHANGE COLUMN soluong soluong_raw VARCHAR(64) NULL')));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'vss_bids' AND column_name = 'soluong' AND data_type = 'decimal');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE vss_bids ADD COLUMN soluong DECIMAL(18,3) NULL');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- vss_bids dates
SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'vss_bids' AND column_name = 'tungay_hd_raw');
SET @typ := (SELECT DATA_TYPE FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'vss_bids' AND column_name = 'tungay_hd');
SET @sql := IF(@has > 0, 'SELECT 1', IF(@typ IS NULL, 'ALTER TABLE vss_bids ADD COLUMN tungay_hd_raw VARCHAR(32) NULL', IF(@typ = 'date', 'ALTER TABLE vss_bids ADD COLUMN tungay_hd_raw VARCHAR(32) NULL', 'ALTER TABLE vss_bids CHANGE COLUMN tungay_hd tungay_hd_raw VARCHAR(32) NULL')));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'vss_bids' AND column_name = 'tungay_hd' AND data_type = 'date');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE vss_bids ADD COLUMN tungay_hd DATE NULL');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'vss_bids' AND column_name = 'denngay_hd_raw');
SET @typ := (SELECT DATA_TYPE FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'vss_bids' AND column_name = 'denngay_hd');
SET @sql := IF(@has > 0, 'SELECT 1', IF(@typ IS NULL, 'ALTER TABLE vss_bids ADD COLUMN denngay_hd_raw VARCHAR(32) NULL', IF(@typ = 'date', 'ALTER TABLE vss_bids ADD COLUMN denngay_hd_raw VARCHAR(32) NULL', 'ALTER TABLE vss_bids CHANGE COLUMN denngay_hd denngay_hd_raw VARCHAR(32) NULL')));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'vss_bids' AND column_name = 'denngay_hd' AND data_type = 'date');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE vss_bids ADD COLUMN denngay_hd DATE NULL');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'vss_bids' AND column_name = 'congbo_raw');
SET @typ := (SELECT DATA_TYPE FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'vss_bids' AND column_name = 'congbo');
SET @sql := IF(@has > 0, 'SELECT 1', IF(@typ IS NULL, 'ALTER TABLE vss_bids ADD COLUMN congbo_raw VARCHAR(64) NULL', IF(@typ = 'date', 'ALTER TABLE vss_bids ADD COLUMN congbo_raw VARCHAR(64) NULL', 'ALTER TABLE vss_bids CHANGE COLUMN congbo congbo_raw VARCHAR(64) NULL')));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'vss_bids' AND column_name = 'congbo' AND data_type = 'date');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE vss_bids ADD COLUMN congbo DATE NULL');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @typ := (SELECT DATA_TYPE FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'vss_bids' AND column_name = 'nam');
SET @sql := IF(@typ = 'smallint', 'SELECT 1', 'ALTER TABLE vss_bids MODIFY COLUMN nam SMALLINT NULL');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Folded text filled at ingest. Not generated columns: TiDB has no Vietnamese fold().
SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'vss_bids' AND column_name = 'hoatchat_f');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE vss_bids ADD COLUMN hoatchat_f VARCHAR(512) NULL');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'vss_bids' AND column_name = 'ten_f');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE vss_bids ADD COLUMN ten_f VARCHAR(512) NULL');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'vss_bids' AND column_name = 'ten_tinh_f');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE vss_bids ADD COLUMN ten_tinh_f VARCHAR(255) NULL');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- dav_drugs dates + fold
SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'dav_drugs' AND column_name = 'ngay_cap_raw');
SET @typ := (SELECT DATA_TYPE FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'dav_drugs' AND column_name = 'ngay_cap');
SET @sql := IF(@has > 0, 'SELECT 1', IF(@typ IS NULL, 'ALTER TABLE dav_drugs ADD COLUMN ngay_cap_raw VARCHAR(32) NULL', IF(@typ = 'date', 'ALTER TABLE dav_drugs ADD COLUMN ngay_cap_raw VARCHAR(32) NULL', 'ALTER TABLE dav_drugs CHANGE COLUMN ngay_cap ngay_cap_raw VARCHAR(32) NULL')));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'dav_drugs' AND column_name = 'ngay_cap' AND data_type = 'date');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE dav_drugs ADD COLUMN ngay_cap DATE NULL');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'dav_drugs' AND column_name = 'ngay_gia_han_raw');
SET @typ := (SELECT DATA_TYPE FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'dav_drugs' AND column_name = 'ngay_gia_han');
SET @sql := IF(@has > 0, 'SELECT 1', IF(@typ IS NULL, 'ALTER TABLE dav_drugs ADD COLUMN ngay_gia_han_raw VARCHAR(32) NULL', IF(@typ = 'date', 'ALTER TABLE dav_drugs ADD COLUMN ngay_gia_han_raw VARCHAR(32) NULL', 'ALTER TABLE dav_drugs CHANGE COLUMN ngay_gia_han ngay_gia_han_raw VARCHAR(32) NULL')));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'dav_drugs' AND column_name = 'ngay_gia_han' AND data_type = 'date');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE dav_drugs ADD COLUMN ngay_gia_han DATE NULL');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'dav_drugs' AND column_name = 'ngay_het_han_raw');
SET @typ := (SELECT DATA_TYPE FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'dav_drugs' AND column_name = 'ngay_het_han');
SET @sql := IF(@has > 0, 'SELECT 1', IF(@typ IS NULL, 'ALTER TABLE dav_drugs ADD COLUMN ngay_het_han_raw VARCHAR(32) NULL', IF(@typ = 'date', 'ALTER TABLE dav_drugs ADD COLUMN ngay_het_han_raw VARCHAR(32) NULL', 'ALTER TABLE dav_drugs CHANGE COLUMN ngay_het_han ngay_het_han_raw VARCHAR(32) NULL')));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'dav_drugs' AND column_name = 'ngay_het_han' AND data_type = 'date');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE dav_drugs ADD COLUMN ngay_het_han DATE NULL');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'dav_drugs' AND column_name = 'hoat_chat_f');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE dav_drugs ADD COLUMN hoat_chat_f VARCHAR(512) NULL');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'dav_drugs' AND column_name = 'ten_thuoc_f');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE dav_drugs ADD COLUMN ten_thuoc_f VARCHAR(512) NULL');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- msc_prices. The plan name msc_records is this table plus msc_tenders (see 001).
SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'msc_prices' AND column_name = 'unit_price_raw');
SET @typ := (SELECT DATA_TYPE FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'msc_prices' AND column_name = 'unit_price');
SET @sql := IF(@has > 0, 'SELECT 1', IF(@typ IS NULL, 'ALTER TABLE msc_prices ADD COLUMN unit_price_raw VARCHAR(64) NULL', IF(@typ = 'decimal', 'ALTER TABLE msc_prices ADD COLUMN unit_price_raw VARCHAR(64) NULL', 'ALTER TABLE msc_prices CHANGE COLUMN unit_price unit_price_raw VARCHAR(64) NULL')));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'msc_prices' AND column_name = 'unit_price' AND data_type = 'decimal');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE msc_prices ADD COLUMN unit_price DECIMAL(15,2) NULL');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'msc_prices' AND column_name = 'quantity_raw');
SET @typ := (SELECT DATA_TYPE FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'msc_prices' AND column_name = 'quantity');
SET @sql := IF(@has > 0, 'SELECT 1', IF(@typ IS NULL, 'ALTER TABLE msc_prices ADD COLUMN quantity_raw VARCHAR(64) NULL', IF(@typ = 'decimal', 'ALTER TABLE msc_prices ADD COLUMN quantity_raw VARCHAR(64) NULL', 'ALTER TABLE msc_prices CHANGE COLUMN quantity quantity_raw VARCHAR(64) NULL')));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'msc_prices' AND column_name = 'quantity' AND data_type = 'decimal');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE msc_prices ADD COLUMN quantity DECIMAL(18,3) NULL');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'msc_prices' AND column_name = 'published_raw');
SET @typ := (SELECT DATA_TYPE FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'msc_prices' AND column_name = 'published');
SET @sql := IF(@has > 0, 'SELECT 1', IF(@typ IS NULL, 'ALTER TABLE msc_prices ADD COLUMN published_raw VARCHAR(32) NULL', IF(@typ = 'date', 'ALTER TABLE msc_prices ADD COLUMN published_raw VARCHAR(32) NULL', 'ALTER TABLE msc_prices CHANGE COLUMN published published_raw VARCHAR(32) NULL')));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'msc_prices' AND column_name = 'published' AND data_type = 'date');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE msc_prices ADD COLUMN published DATE NULL');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'msc_prices' AND column_name = 'name_f');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE msc_prices ADD COLUMN name_f VARCHAR(512) NULL');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'msc_prices' AND column_name = 'ingredient_f');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE msc_prices ADD COLUMN ingredient_f VARCHAR(512) NULL');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'msc_prices' AND column_name = 'province_f');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE msc_prices ADD COLUMN province_f VARCHAR(128) NULL');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- msc_tenders
SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'msc_tenders' AND column_name = 'bid_price_raw');
SET @typ := (SELECT DATA_TYPE FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'msc_tenders' AND column_name = 'bid_price');
SET @sql := IF(@has > 0, 'SELECT 1', IF(@typ IS NULL, 'ALTER TABLE msc_tenders ADD COLUMN bid_price_raw VARCHAR(64) NULL', IF(@typ = 'decimal', 'ALTER TABLE msc_tenders ADD COLUMN bid_price_raw VARCHAR(64) NULL', 'ALTER TABLE msc_tenders CHANGE COLUMN bid_price bid_price_raw VARCHAR(64) NULL')));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'msc_tenders' AND column_name = 'bid_price' AND data_type = 'decimal');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE msc_tenders ADD COLUMN bid_price DECIMAL(15,2) NULL');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'msc_tenders' AND column_name = 'published_raw');
SET @typ := (SELECT DATA_TYPE FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'msc_tenders' AND column_name = 'published');
SET @sql := IF(@has > 0, 'SELECT 1', IF(@typ IS NULL, 'ALTER TABLE msc_tenders ADD COLUMN published_raw VARCHAR(32) NULL', IF(@typ = 'date', 'ALTER TABLE msc_tenders ADD COLUMN published_raw VARCHAR(32) NULL', 'ALTER TABLE msc_tenders CHANGE COLUMN published published_raw VARCHAR(32) NULL')));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'msc_tenders' AND column_name = 'published' AND data_type = 'date');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE msc_tenders ADD COLUMN published DATE NULL');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'msc_tenders' AND column_name = 'close_date_raw');
SET @typ := (SELECT DATA_TYPE FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'msc_tenders' AND column_name = 'close_date');
SET @sql := IF(@has > 0, 'SELECT 1', IF(@typ IS NULL, 'ALTER TABLE msc_tenders ADD COLUMN close_date_raw VARCHAR(32) NULL', IF(@typ = 'date', 'ALTER TABLE msc_tenders ADD COLUMN close_date_raw VARCHAR(32) NULL', 'ALTER TABLE msc_tenders CHANGE COLUMN close_date close_date_raw VARCHAR(32) NULL')));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'msc_tenders' AND column_name = 'close_date' AND data_type = 'date');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE msc_tenders ADD COLUMN close_date DATE NULL');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'msc_tenders' AND column_name = 'name_f');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE msc_tenders ADD COLUMN name_f VARCHAR(512) NULL');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'msc_tenders' AND column_name = 'province_f');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE msc_tenders ADD COLUMN province_f VARCHAR(128) NULL');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Equality / range indexes. LIKE '%word%' does not use these.
SET @has := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'vss_bids' AND index_name = 'idx_vss_loai_nam_tinh');
SET @sql := IF(@has > 0, 'SELECT 1', 'CREATE INDEX idx_vss_loai_nam_tinh ON vss_bids (loai, nam, ma_tinh)');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'vss_bids' AND index_name = 'idx_vss_nhom_nam');
SET @sql := IF(@has > 0, 'SELECT 1', 'CREATE INDEX idx_vss_nhom_nam ON vss_bids (nhomthau, nam)');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'vss_bids' AND index_name = 'idx_vss_tungay');
SET @sql := IF(@has > 0, 'SELECT 1', 'CREATE INDEX idx_vss_tungay ON vss_bids (tungay_hd)');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'vss_bids' AND index_name = 'idx_vss_sodk');
SET @sql := IF(@has > 0, 'SELECT 1', 'CREATE INDEX idx_vss_sodk ON vss_bids (sodk)');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'dav_drugs' AND index_name = 'idx_dav_tag_id');
SET @sql := IF(@has > 0, 'SELECT 1', 'CREATE INDEX idx_dav_tag_id ON dav_drugs (tag_id)');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'dav_drugs' AND index_name = 'idx_dav_ngay_cap');
SET @sql := IF(@has > 0, 'SELECT 1', 'CREATE INDEX idx_dav_ngay_cap ON dav_drugs (ngay_cap)');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'msc_prices' AND index_name = 'idx_msc_prices_pub');
SET @sql := IF(@has > 0, 'SELECT 1', 'CREATE INDEX idx_msc_prices_pub ON msc_prices (published, source_id)');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'msc_prices' AND index_name = 'idx_msc_prices_province');
SET @sql := IF(@has > 0, 'SELECT 1', 'CREATE INDEX idx_msc_prices_province ON msc_prices (province)');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'msc_tenders' AND index_name = 'idx_msc_tenders_pub');
SET @sql := IF(@has > 0, 'SELECT 1', 'CREATE INDEX idx_msc_tenders_pub ON msc_tenders (published, source_id)');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'msc_tenders' AND index_name = 'idx_msc_tenders_province');
SET @sql := IF(@has > 0, 'SELECT 1', 'CREATE INDEX idx_msc_tenders_province ON msc_tenders (province)');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Rollup. Empty dimension is '' (PK columns are NOT NULL). Sum is wider than a line item.
CREATE TABLE IF NOT EXISTS agg_vss_monthly (
    loai VARCHAR(128) NOT NULL,
    nam SMALLINT NOT NULL,
    ym CHAR(7) NOT NULL,
    ma_tinh VARCHAR(32) NOT NULL,
    nhomthau VARCHAR(64) NOT NULL,
    sum_thanhtien DECIMAL(20,2) NOT NULL DEFAULT 0,
    cnt BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (loai, nam, ym, ma_tinh, nhomthau)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @has := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'agg_vss_monthly' AND index_name = 'idx_agg_vss_tinh_nam');
SET @sql := IF(@has > 0, 'SELECT 1', 'CREATE INDEX idx_agg_vss_tinh_nam ON agg_vss_monthly (ma_tinh, nam)');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Suggest dictionary. value is in the PK so (section, field, value) is a point lookup.
-- utf8mb4 VARCHAR(512) is 2048 bytes, under the 3072-byte index limit.
CREATE TABLE IF NOT EXISTS suggest_values (
    section VARCHAR(32) NOT NULL,
    field VARCHAR(64) NOT NULL,
    value VARCHAR(512) NOT NULL,
    cnt BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (section, field, value)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- TiFlash replicas for large fact tables. msc_records in the plan = msc_prices + msc_tenders.
ALTER TABLE vss_bids SET TIFLASH REPLICA 1;
ALTER TABLE dav_drugs SET TIFLASH REPLICA 1;
ALTER TABLE msc_prices SET TIFLASH REPLICA 1;
ALTER TABLE msc_tenders SET TIFLASH REPLICA 1;
