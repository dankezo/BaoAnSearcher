# Kết quả P7

Đo SQLite local lúc 2026-09-30T04:12:42.825Z. Không ghi đè `docs/perf/baseline.md`. Không mở TiDB và không gửi lại 30 câu Turso.

## Cách đo

- Bộ 30 câu: `scripts/perf/queries.json`.
- Search: 1 lần warmup rồi 3 mẫu. Meta: 1 mẫu. Metric lạnh: 1 lần `slice_payload`, không ghi DB.
- `needle` kiểm tra dòng đầu của trang có chứa từng từ của `q` sau `fold()`. Trang rỗng thì để trống.
- Sáu câu VSS lọc `nam` ở baseline là `OperationalError`. Lần này dùng `json_extract(raw, '$.congbo')`.

## SQLite

| ID | p50 ms | p95 ms | Rows | Total | Needle | Baseline p50 |
|---|---:|---:|---:|---:|---|---:|
| vss-substring-cillin | 5348 | 5831 | 100 | 3,916 | có | 4948 |
| vss-substring-uroxim | 5677 | 5777 | 100 | 4,248 | có | 4922 |
| vss-substring-amoxicillin | 8259 | 8390 | 100 | 1,430 | có | 5041 |
| vss-hoatchat-paracetamol | 10256 | 11435 | 100 | 20,536 | — | 7628 |
| vss-sodk-fragment | 9490 | 11368 | 100 | 262,925 | — | 9610 |
| vss-loai-nam-2025 | 11940 | 12011 | 100 | 492,254 | — | ERROR |
| vss-loai-nam-tinh-79 | 11412 | 11985 | 100 | 59,184 | — | ERROR |
| vss-nhom-n1-nam | 17665 | 17751 | 100 | 111,150 | — | ERROR |
| vss-date-range-2025 | 9945 | 10080 | 100 | 31,214 | — | 8809 |
| vss-complex-filter | 8290 | 8505 | 100 | 342 | có | ERROR |
| vss-duongdung | 13281 | 13452 | 100 | 489,435 | — | 11556 |
| vss-nuocsx | 13070 | 13372 | 100 | 508,988 | — | 11890 |
| vss-deep-page-20 | 12555 | 12662 | 100 | 492,254 | — | ERROR |
| vss-export-chunk-500 | 13683 | 17047 | 500 | 492,254 | — | ERROR |
| dav-substring-cillin | 420 | 429 | 100 | — | có | 233 |
| dav-substring-paracetamol | 94.3 | 97.5 | 100 | — | có | 61.8 |
| dav-hoatchat-cefuroxim | 518 | 524 | 100 | — | — | 327 |
| dav-sodk | 51.4 | 53.3 | 100 | — | — | 35.6 |
| dav-ten-dangbaoche | 719 | 771 | 100 | — | — | 399 |
| dav-deep-page-10 | 1417 | 1475 | 0 | — | — | 876 |
| msc-prices-substring | 172 | 180 | 100 | 137 | có | 182 |
| msc-prices-province | 416 | 459 | 100 | 2,363 | — | 340 |
| msc-prices-ingredient-province | 542 | 544 | 9 | 9 | — | 413 |
| msc-prices-deep-page-20 | 264 | 269 | 100 | 13,724 | có | 295 |
| msc-tenders-substring | 807 | 825 | 100 | 10,044 | có | 552 |
| msc-tenders-province | 630 | 702 | 100 | 1,105 | — | 370 |
| meta-vss | 12.9 | 12.9 | 1 | — | — | 5.9 |
| meta-msc | 1.7 | 1.7 | 1 | — | — | 5.5 |
| metrics-vss-cache | 1.6 | 4.1 | 4 | 176,018 | — | 1.3 |
| metrics-vss-cold | 6551 | 6551 | — | — | — | 4286 |

## Đối chiếu

- Search chạy được 26/26. Trung vị p50 của cả 26 câu là 5348 ms, vì sáu câu VSS lọc năm (nhiều giây) nay nằm trong mẫu. Baseline 413 ms chỉ tính 20 câu chạy được lúc đó.
- Sáu câu năm từng lỗi: 6/6 chạy được.
- `cillin` total 3,916, needle trang 1 có. Baseline đã ghi 3,916.
- `uroxim` total 4,248, needle trang 1 có. Baseline đã ghi 4,248.
- Câu SQL cloud của cả 26 câu search vẫn là `LIKE '%từ%'` trên cột đã fold. Khóa đó nằm ở `tests/p7-parity.test.mjs`.

## Chưa đo trên cluster

- TiDB chưa có `TIDB_DATABASE_URL` hoặc `TIDB_HOST` + `TIDB_USER` + `TIDB_DATABASE`, nên chưa so số dòng với SQLite.
- Turso ở baseline là `BLOCKED` (reads forbidden). Lần này không gửi lại 30 câu.
- Supabase vẫn là backend mặc định của app. Bộ này không gọi PostgREST.
