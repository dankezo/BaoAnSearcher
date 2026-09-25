-- Drop non-compact columns from Turso / Postgres to lighten storage.
-- Safe to re-run: IF EXISTS. Keep search + ids + compact UI fields only.

-- DAV
ALTER TABLE dav_drugs DROP COLUMN IF EXISTS so_dang_ky_cu;
ALTER TABLE dav_drugs DROP COLUMN IF EXISTS han_dung;
ALTER TABLE dav_drugs DROP COLUMN IF EXISTS dia_chi_san_xuat;
ALTER TABLE dav_drugs DROP COLUMN IF EXISTS dia_chi_dang_ky;
ALTER TABLE dav_drugs DROP COLUMN IF EXISTS nuoc_dang_ky;
ALTER TABLE dav_drugs DROP COLUMN IF EXISTS so_quyet_dinh;
ALTER TABLE dav_drugs DROP COLUMN IF EXISTS tieu_chuan;
ALTER TABLE dav_drugs DROP COLUMN IF EXISTS ky_cap_nam;
ALTER TABLE dav_drugs DROP COLUMN IF EXISTS phan_loai;
ALTER TABLE dav_drugs DROP COLUMN IF EXISTS ghi_chu;
ALTER TABLE dav_drugs DROP COLUMN IF EXISTS dot_cap;
ALTER TABLE dav_drugs DROP COLUMN IF EXISTS dm93;
ALTER TABLE dav_drugs DROP COLUMN IF EXISTS has_gia_han_pending;

-- VSS (keep ten_tinh / ten_cskcb / nam / loai for filters + metrics)
ALTER TABLE vss_bids DROP COLUMN IF EXISTS dangbaoche;
ALTER TABLE vss_bids DROP COLUMN IF EXISTS donggoi;
ALTER TABLE vss_bids DROP COLUMN IF EXISTS tennhathau;
ALTER TABLE vss_bids DROP COLUMN IF EXISTS quyetdinh;
ALTER TABLE vss_bids DROP COLUMN IF EXISTS goithau;
ALTER TABLE vss_bids DROP COLUMN IF EXISTS ma;
ALTER TABLE vss_bids DROP COLUMN IF EXISTS ma_gy;
ALTER TABLE vss_bids DROP COLUMN IF EXISTS maduongdung;
ALTER TABLE vss_bids DROP COLUMN IF EXISTS madd_gy;
ALTER TABLE vss_bids DROP COLUMN IF EXISTS ten_don_vi;
ALTER TABLE vss_bids DROP COLUMN IF EXISTS tungay;
ALTER TABLE vss_bids DROP COLUMN IF EXISTS denngay;
ALTER TABLE vss_bids DROP COLUMN IF EXISTS tieuchuan;
ALTER TABLE vss_bids DROP COLUMN IF EXISTS sttpheduyet;
ALTER TABLE vss_bids DROP COLUMN IF EXISTS hieuluc;
ALTER TABLE vss_bids DROP COLUMN IF EXISTS ht_thau;
ALTER TABLE vss_bids DROP COLUMN IF EXISTS created_date;

-- MSC prices extras beyond compact table
ALTER TABLE msc_prices DROP COLUMN IF EXISTS registration_keys;
ALTER TABLE msc_prices DROP COLUMN IF EXISTS route;
ALTER TABLE msc_prices DROP COLUMN IF EXISTS dosage_form;
ALTER TABLE msc_prices DROP COLUMN IF EXISTS packaging;
ALTER TABLE msc_prices DROP COLUMN IF EXISTS winner_code;
ALTER TABLE msc_prices DROP COLUMN IF EXISTS buyer_code;
ALTER TABLE msc_prices DROP COLUMN IF EXISTS decision;
ALTER TABLE msc_prices DROP COLUMN IF EXISTS decision_date;
ALTER TABLE msc_prices DROP COLUMN IF EXISTS source_label;
ALTER TABLE msc_prices DROP COLUMN IF EXISTS import_note;

-- MSC tenders extras
ALTER TABLE msc_tenders DROP COLUMN IF EXISTS buyer_code;
ALTER TABLE msc_tenders DROP COLUMN IF EXISTS source_status;
ALTER TABLE msc_tenders DROP COLUMN IF EXISTS plan_no;
ALTER TABLE msc_tenders DROP COLUMN IF EXISTS version;
ALTER TABLE msc_tenders DROP COLUMN IF EXISTS medicine_evidence;
ALTER TABLE msc_tenders DROP COLUMN IF EXISTS source_label;
