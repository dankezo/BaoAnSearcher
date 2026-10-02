-- Lightweight administration dashboard metadata. The app reads only these
-- four rows; it must never COUNT(*) the catalog tables during page load.
CREATE TABLE IF NOT EXISTS data_registry_meta (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    dataset_code VARCHAR(32) NOT NULL,
    dataset_name VARCHAR(128) NOT NULL,
    description VARCHAR(512) NOT NULL,
    total_records BIGINT NOT NULL DEFAULT 0,
    status ENUM('healthy', 'syncing', 'warning') NOT NULL DEFAULT 'warning',
    last_synced_at TIMESTAMP NULL DEFAULT NULL,
    r2_download_url VARCHAR(2048) NULL,
    file_size_mb DECIMAL(12,2) NULL,
    UNIQUE KEY uq_data_registry_dataset_code (dataset_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Keep these descriptions in TiDB so the dashboard can be entirely metadata
-- driven. Counts are initialized from existing cached metadata, never with a
-- scan of the large catalog tables.
INSERT INTO data_registry_meta
  (dataset_code, dataset_name, description, total_records, status, last_synced_at)
SELECT seed.dataset_code, seed.dataset_name, seed.description,
       COALESCE(meta.total_records, 0),
       CASE WHEN meta.total_records IS NULL THEN 'warning' ELSE 'healthy' END,
       meta.updated_at
FROM (
  SELECT 'DAV' AS dataset_code, 'DAV — Đăng ký thuốc' AS dataset_name,
         'Danh mục thuốc do Cục Quản lý Dược công bố.' AS description,
         'dav_total' AS metadata_key
  UNION ALL SELECT 'MSC_PRICE', 'MSC — Đơn giá trúng thầu',
         'Đơn giá thuốc trúng thầu từ Mạng Đấu thầu Quốc gia.', 'msc_prices_total'
  UNION ALL SELECT 'MSC_BID', 'MSC — Gói thầu dược phẩm',
         'Kế hoạch và thông báo mời thầu dược phẩm.', 'msc_total'
  UNION ALL SELECT 'VSS', 'VSS — Thuốc BHYT trúng thầu',
         'Danh mục thuốc thuộc Bảo hiểm Xã hội Việt Nam.', 'vss_total'
) AS seed
LEFT JOIN app_metadata AS meta ON meta.key_name = seed.metadata_key
ON DUPLICATE KEY UPDATE
  dataset_name = VALUES(dataset_name),
  description = VALUES(description),
  total_records = VALUES(total_records),
  status = CASE WHEN VALUES(total_records) > 0 THEN 'healthy' ELSE data_registry_meta.status END,
  last_synced_at = COALESCE(VALUES(last_synced_at), data_registry_meta.last_synced_at);
