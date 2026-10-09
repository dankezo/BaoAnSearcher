-- Keep the actual opening date; publication and closing dates are distinct.
SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'msc_tenders' AND column_name = 'open_date');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE msc_tenders ADD COLUMN open_date DATE NULL');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
