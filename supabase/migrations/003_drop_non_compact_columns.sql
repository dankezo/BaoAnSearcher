-- Drop non-compact columns (VSS / MSC only). NEVER alter dav_drugs.
-- Applied on Turso 2026-09-25 for VSS (tennhathau, dangbaoche). MSC already compact.

-- VSS
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

-- MSC prices extras (no-op if already absent)
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
ALTER TABLE msc_prices DROP COLUMN IF EXISTS collected_at;

-- MSC tenders extras
ALTER TABLE msc_tenders DROP COLUMN IF EXISTS buyer_code;
ALTER TABLE msc_tenders DROP COLUMN IF EXISTS source_status;
ALTER TABLE msc_tenders DROP COLUMN IF EXISTS plan_no;
ALTER TABLE msc_tenders DROP COLUMN IF EXISTS version;
ALTER TABLE msc_tenders DROP COLUMN IF EXISTS medicine_evidence;
ALTER TABLE msc_tenders DROP COLUMN IF EXISTS source_label;
ALTER TABLE msc_tenders DROP COLUMN IF EXISTS collected_at;
