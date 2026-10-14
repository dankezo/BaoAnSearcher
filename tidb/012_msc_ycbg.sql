CREATE TABLE IF NOT EXISTS msc_ycbg (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  normalized JSON NOT NULL,
  lots JSON NULL,
  detail JSON NULL,
  fetched_at VARCHAR(32) NULL,
  error VARCHAR(255) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO data_registry_meta (dataset_code,dataset_name,description)
VALUES ('MSC_YCBG','MSC - YCBG','Yêu cầu báo giá thuốc, hồ sơ và đối chiếu Bảo An')
ON DUPLICATE KEY UPDATE dataset_name=VALUES(dataset_name),description=VALUES(description);
