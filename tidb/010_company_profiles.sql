-- Additive enrichment. Procurement geography is never overwritten.
CREATE TABLE IF NOT EXISTS company_profiles (
 name_key VARCHAR(700) COLLATE utf8mb4_bin PRIMARY KEY,
 legal_name VARCHAR(700) NOT NULL,
 office_province VARCHAR(100) NULL,
 factory_province VARCHAR(100) NULL,
 profile_json JSON NOT NULL,
 checked_at DATETIME NOT NULL,
 INDEX idx_office_province (office_province),
 INDEX idx_factory_province (factory_province)
);
