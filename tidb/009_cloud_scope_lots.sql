CREATE TABLE IF NOT EXISTS msc_scope_lots (
  notify_id VARCHAR(64) PRIMARY KEY,
  tender_no VARCHAR(128),
  lots JSON NOT NULL,
  fetched_at DATETIME NOT NULL,
  INDEX idx_cloud_scope_tender (tender_no)
);
