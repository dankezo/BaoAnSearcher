# Baseline hiệu năng P0

Đo lúc 2026-09-30T02:24:01.987Z. Logic tìm kiếm không đổi. Số liệu là thời gian gọi thẳng hàm hiện tại, chưa gồm vòng auth Supabase `getUser` trên Vercel.

## Cách đo

- Bộ truy vấn: `scripts/perf/queries.json` (30 câu).
- Turso: cùng hàm `searchVss` / `searchDav` / `searchMsc`, `app_metadata`, `app_meta`, và `computeSectionMetrics`. Nếu dịch vụ trả `BLOCKED`, các câu sau được ghi nhận cùng trạng thái, không gửi thêm SQL.
- SQLite local: cùng filter, gọi `search_bids` / `search_drugs` / `msc.search` / `read_metrics`. Mỗi câu search: 1 warmup + 3 mẫu. Meta: 3 mẫu, không warmup. Metric lạnh local: 1 lần `slice_payload` (lọc hoạt chất, không ghi DB), vì dashboard local không tính lại fact table khi mở trang.
- VSS local luôn kèm `COUNT(*)` (2 round-trip). p50/p95 tính trên mẫu thành công. Payload là byte JSON của kết quả hàm.
- Turso region (từ hostname, không ghi URL): aws-ap-northeast-1.
- Turso đọc SQL đang bị chặn ở phía dịch vụ (`BLOCKED`: reads are forbidden trên plan hiện tại). Cột Turso ghi BLOCKED khi không có mẫu thành công. Thời gian nhận lỗi không được tính là latency truy vấn.

## Catalog

Turso không đọc được `app_metadata`. Số dòng local đang lưu trong `app_metadata`:

| Kho | Dòng |
|---|---:|
| VSS `bids` | 744,781 |
| DAV `drugs` | 55,005 |
| MSC đơn giá | 10,492 |
| MSC hồ sơ | 10,031 |

File local: VSS 2,821 MB, DAV 239 MB, MSC 138 MB.

## Từng truy vấn

| ID | Endpoint | Turso p50 ms | Turso p95 ms | DB p50 ms | Bytes | Rows | Trips | SQLite p50 ms | SQLite p95 ms | SQLite rows |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| vss-substring-cillin | `POST /api/tender/search` | BLOCKED | BLOCKED | — | — | — | — | 4948 | 5064 | 100 |
| vss-substring-uroxim | `POST /api/tender/search` | BLOCKED | BLOCKED | — | — | — | — | 4922 | 4949 | 100 |
| vss-substring-amoxicillin | `POST /api/tender/search` | BLOCKED | BLOCKED | — | — | — | — | 5041 | 5085 | 100 |
| vss-hoatchat-paracetamol | `POST /api/tender/search` | BLOCKED | BLOCKED | — | — | — | — | 7628 | 9435 | 100 |
| vss-sodk-fragment | `POST /api/tender/search` | BLOCKED | BLOCKED | — | — | — | — | 9610 | 9786 | 100 |
| vss-loai-nam-2025 | `POST /api/tender/search` | BLOCKED | BLOCKED | — | — | — | — | ERROR | ERROR | — |
| vss-loai-nam-tinh-79 | `POST /api/tender/search` | BLOCKED | BLOCKED | — | — | — | — | ERROR | ERROR | — |
| vss-nhom-n1-nam | `POST /api/tender/search` | BLOCKED | BLOCKED | — | — | — | — | ERROR | ERROR | — |
| vss-date-range-2025 | `POST /api/tender/search` | BLOCKED | BLOCKED | — | — | — | — | 8809 | 8880 | 100 |
| vss-complex-filter | `POST /api/tender/search` | BLOCKED | BLOCKED | — | — | — | — | ERROR | ERROR | — |
| vss-duongdung | `POST /api/tender/search` | BLOCKED | BLOCKED | — | — | — | — | 11556 | 11576 | 100 |
| vss-nuocsx | `POST /api/tender/search` | BLOCKED | BLOCKED | — | — | — | — | 11890 | 12072 | 100 |
| vss-deep-page-20 | `POST /api/tender/search` | BLOCKED | BLOCKED | — | — | — | — | ERROR | ERROR | — |
| vss-export-chunk-500 | `POST /api/tender/search` | BLOCKED | BLOCKED | — | — | — | — | ERROR | ERROR | — |
| dav-substring-cillin | `POST /api/tender/search` | BLOCKED | BLOCKED | — | — | — | — | 233 | 260 | 100 |
| dav-substring-paracetamol | `POST /api/tender/search` | BLOCKED | BLOCKED | — | — | — | — | 61.8 | 62.1 | 100 |
| dav-hoatchat-cefuroxim | `POST /api/tender/search` | BLOCKED | BLOCKED | — | — | — | — | 327 | 332 | 100 |
| dav-sodk | `POST /api/tender/search` | BLOCKED | BLOCKED | — | — | — | — | 35.6 | 36.5 | 100 |
| dav-ten-dangbaoche | `POST /api/tender/search` | BLOCKED | BLOCKED | — | — | — | — | 399 | 419 | 100 |
| dav-deep-page-10 | `POST /api/tender/search` | BLOCKED | BLOCKED | — | — | — | — | 876 | 943 | 0 |
| msc-prices-substring | `POST /api/tender/search` | BLOCKED | BLOCKED | — | — | — | — | 182 | 196 | 100 |
| msc-prices-province | `POST /api/tender/search` | BLOCKED | BLOCKED | — | — | — | — | 340 | 340 | 100 |
| msc-prices-ingredient-province | `POST /api/tender/search` | BLOCKED | BLOCKED | — | — | — | — | 413 | 434 | 9 |
| msc-prices-deep-page-20 | `POST /api/tender/search` | BLOCKED | BLOCKED | — | — | — | — | 295 | 298 | 100 |
| msc-tenders-substring | `POST /api/tender/search` | BLOCKED | BLOCKED | — | — | — | — | 552 | 555 | 100 |
| msc-tenders-province | `POST /api/tender/search` | BLOCKED | BLOCKED | — | — | — | — | 370 | 443 | 100 |
| meta-vss | `POST /api/tender/meta` | BLOCKED | BLOCKED | — | — | — | — | 5.9 | 6.0 | 1 |
| meta-msc | `POST /api/tender/meta` | BLOCKED | BLOCKED | — | — | — | — | 5.5 | 7.5 | 1 |
| metrics-vss-cache | `POST /api/tender/metrics` | BLOCKED | BLOCKED | — | — | — | — | 1.3 | 1.8 | 4 |
| metrics-vss-cold | `POST /api/tender/metrics` | BLOCKED | BLOCKED | — | — | — | — | 4286 | 4286 | — |

## Tóm tắt

- Turso: 0/30 câu trả dữ liệu. Lần gọi đầu là `LibsqlError BLOCKED` (SQL read bị cấm trên plan hiện tại, region hostname `aws-ap-northeast-1`). Các câu sau không gửi thêm.
- SQLite VSS, 8/14 câu chạy được: p50 4.9–11.9 giây cho trang 100 dòng, payload khoảng 78–89 KB. p95 cao nhất nhóm này là 12.1 giây (`vss-nuocsx`, 508,988 dòng khớp). Tìm giữa từ vẫn ra kết quả: `cillin` 3,916 dòng, `uroxim` 4,248 dòng.
- SQLite DAV: p50 36–399 ms ở trang đầu, payload khoảng 118–126 KB / 100 dòng. Trang sâu `cillin` (offset 1000) trả 0 dòng trong 876 ms.
- SQLite MSC: p50 182–552 ms. Hồ sơ `q=thuoc` trả 100 dòng nặng 1.85 MB.
- Meta local khoảng 6 ms. Metric VSS đã tính sẵn: 1.3 ms, 16 KB. Slice động theo hoạt chất `cefuroxim`: 4.3 giây, 9 KB.
- Trung vị p50 của 20 câu search chạy được (gồm DAV/MSC) là 413 ms. Riêng VSS đang ở mức nhiều giây.

## Lỗi đã sửa sau lần đo

Sáu câu VSS có lọc `nam` lúc đo ném `sqlite3.OperationalError: no such column: congbo`. `search_bids` đã đọc `json_extract(raw, '$.congbo')`. Bảng số ở trên vẫn là lần đo trước khi sửa, chưa chạy lại.

## Ghi chú

- Header `Server-Timing` (`auth`, `db`, `serialize`) và log một dòng JSON `requestId`, `dbMs`, `rows`, `bytes` đã gắn ở `/api/tender/search`, `/api/tender/metrics`, `/api/tender/meta`. Log không ghi Authorization hay câu SQL. Bản đo này gọi hàm DB trực tiếp nên chưa có số `auth` của production.
- Mỗi câu search Turso trong code là 1 round-trip SQL (`LIMIT size+1`, không `COUNT`). VSS và MSC local là 2 round-trip (đếm rồi lấy trang).
- `total` trên Turso search hiện là `null`. SQLite VSS trả `total` khi câu chạy được.
- RPC Supabase `search_vss_bids` không có trong schema cache của project hiện tại (một probe, không đưa vào bảng).
- Dừng tại P0. Chưa đổi schema, adapter, hay UI.
