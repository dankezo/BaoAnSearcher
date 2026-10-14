-- Shared catalogue results only; never store accounts, tokens or watchlists.
CREATE TABLE IF NOT EXISTS shared_query_cache (
  cache_key CHAR(64) PRIMARY KEY,
  payload LONGTEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  INDEX idx_shared_query_expiry (expires_at)
);
