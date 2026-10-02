-- Fast MSC ingredient lookup. Run after 001_search_schema.sql and 002_perf_schema.sql.
--
-- ingredient_f is deliberately a physical column rather than a generated
-- expression: TiDB has no built-in Vietnamese accent-folding function. The
-- sync worker writes it as lower-case, accent-folded and single-spaced.
-- This small backfill only collapses whitespace in rows written by older
-- workers; the next --from-start price sync refreshes every value exactly.

-- These source fields already exist in the MSC records but older TiDB schema
-- revisions omitted them, making a complete source row look incomplete in UI.
SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'msc_prices' AND column_name = 'route');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE msc_prices ADD COLUMN route VARCHAR(255) NULL');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'msc_prices' AND column_name = 'dosage_form');
SET @sql := IF(@has > 0, 'SELECT 1', 'ALTER TABLE msc_prices ADD COLUMN dosage_form VARCHAR(255) NULL');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE msc_prices
SET ingredient_f = TRIM(REGEXP_REPLACE(ingredient_f, '[[:space:]]+', ' '))
WHERE ingredient_f IS NOT NULL
  AND ingredient_f <> TRIM(REGEXP_REPLACE(ingredient_f, '[[:space:]]+', ' '));

-- A prefix predicate such as ingredient_f LIKE 'silymarin%' becomes an
-- IndexRangeScan. We include the cursor ordering keys to keep the LIMIT + 1
-- list path narrow after the ingredient range has been found.
SET @has := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'msc_prices'
    AND index_name = 'idx_msc_prices_ingredient_f'
);
SET @sql := IF(
  @has > 0,
  'SELECT 1',
  'CREATE INDEX idx_msc_prices_ingredient_f ON msc_prices (ingredient_f, published, source_id)'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- TiFlash is reserved for aggregate widgets. Do not point the interactive
-- list query at TiFlash: it needs the primary-index range above.
ALTER TABLE msc_prices SET TIFLASH REPLICA 1;

-- The apply operation only schedules replication. AVAILABLE=1 and
-- PROGRESS=1 are the readiness gate before enabling metric traffic.
SELECT TABLE_SCHEMA, TABLE_NAME, REPLICA_COUNT, AVAILABLE, PROGRESS
FROM information_schema.tiflash_replica
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'msc_prices';
