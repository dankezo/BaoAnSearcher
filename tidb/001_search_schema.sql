-- TiDB Cloud Serverless (MySQL). Apply before import. Do not run against SQLite.
-- Substring search stays LIKE '%term%' on columns folded at ingest.
-- fp_hash is SHA-256 of the full fingerprint. Source values run past 2,000 characters,
-- which cannot be a utf8mb4 primary key. Search still returns the full fingerprint.

CREATE TABLE IF NOT EXISTS vss_bids (
    fp_hash CHAR(64) CHARACTER SET ascii NOT NULL PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    search TEXT NOT NULL,
    hoatchat VARCHAR(512),
    sodk VARCHAR(128),
    ten VARCHAR(512),
    duongdung VARCHAR(255),
    hamluong VARCHAR(255),
    donvitinh VARCHAR(64),
    soluong VARCHAR(64),
    gia VARCHAR(64),
    thanhtien VARCHAR(64),
    nhomthau VARCHAR(64),
    nhasx VARCHAR(512),
    nuocsx VARCHAR(128),
    ma_tinh VARCHAR(32),
    ma_cskcb VARCHAR(64),
    tungay_hd VARCHAR(32),
    denngay_hd VARCHAR(32),
    ten_tinh VARCHAR(255),
    ten_cskcb VARCHAR(512),
    loai_thau VARCHAR(128),
    loai VARCHAR(128),
    nam INT,
    congbo VARCHAR(64),
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dav_drugs (
    id VARCHAR(64) PRIMARY KEY,
    search TEXT NOT NULL,
    so_dang_ky VARCHAR(128),
    so_dang_ky_cu VARCHAR(128),
    ten_thuoc VARCHAR(512) NOT NULL,
    ngay_cap VARCHAR(32),
    ngay_gia_han VARCHAR(32),
    ngay_het_han VARCHAR(32),
    hoat_chat VARCHAR(512) NOT NULL,
    ham_luong VARCHAR(255),
    dang_bao_che VARCHAR(255),
    dong_goi VARCHAR(255),
    han_dung VARCHAR(128),
    cty_san_xuat VARCHAR(512),
    nuoc_san_xuat VARCHAR(128),
    cty_dang_ky VARCHAR(512),
    nuoc_dang_ky VARCHAR(128),
    so_quyet_dinh VARCHAR(128),
    tieu_chuan VARCHAR(128),
    ky_cap_nam VARCHAR(32),
    con_hieu_luc TINYINT,
    ingredient_count INT,
    tag_id VARCHAR(64),
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS msc_prices (
    source_id VARCHAR(128) PRIMARY KEY,
    search TEXT NOT NULL,
    name VARCHAR(512),
    ingredient VARCHAR(512),
    strength VARCHAR(255),
    registration VARCHAR(128),
    unit_price VARCHAR(64),
    quantity VARCHAR(64),
    unit VARCHAR(64),
    group_name VARCHAR(128),
    medicine_type VARCHAR(128),
    manufacturer VARCHAR(512),
    country VARCHAR(128),
    buyer VARCHAR(512),
    province VARCHAR(128),
    tender_no VARCHAR(128),
    published VARCHAR(32),
    winner VARCHAR(512),
    source_url TEXT,
    collected_at VARCHAR(64),
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS msc_tenders (
    source_id VARCHAR(128) PRIMARY KEY,
    search TEXT NOT NULL,
    tender_no VARCHAR(128),
    name VARCHAR(512),
    buyer VARCHAR(512),
    province VARCHAR(128),
    published VARCHAR(32),
    close_date VARCHAR(32),
    status_label VARCHAR(128),
    status_code VARCHAR(64),
    bid_price VARCHAR(64),
    bid_form VARCHAR(128),
    source_url TEXT,
    collected_at VARCHAR(64),
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_metadata (
    key_name VARCHAR(50) PRIMARY KEY,
    total_records BIGINT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
