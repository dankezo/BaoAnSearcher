-- DAV's official source stores `thongTinThuocCoBan.nhomThuoc`.  Materialize
-- it so the public lookup never needs to scan source JSON.  Registration
-- density is materialized by sync_to_tidb.py after each DAV sync.
SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'dav_drugs' AND column_name = 'drug_group');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE dav_drugs ADD COLUMN drug_group VARCHAR(255) NULL');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'dav_drugs' AND column_name = 'drug_group_f');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE dav_drugs ADD COLUMN drug_group_f VARCHAR(255) NULL');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'dav_drugs' AND column_name = 'registration_count');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE dav_drugs ADD COLUMN registration_count INT NULL');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'dav_drugs' AND index_name = 'idx_dav_drug_group');
SET @sql := IF(@has > 0, 'SELECT 1', 'CREATE INDEX idx_dav_drug_group ON dav_drugs (drug_group_f, id)');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'dav_drugs' AND index_name = 'idx_dav_registration_count');
SET @sql := IF(@has > 0, 'SELECT 1', 'CREATE INDEX idx_dav_registration_count ON dav_drugs (registration_count, id)');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- MSC prices now use a deterministic SHA-256 source_id created by the sync
-- worker. Existing random IDs are removed only by its completed --prune run;
-- keeping this migration DDL-only makes deployment reversible and safe.
