# Đồng bộ TiDB — P6

Ghi local SQLite và file rollup lên TiDB bằng `INSERT ... ON DUPLICATE KEY UPDATE`. Chạy lại an toàn. Mặc định mọi lệnh chỉ in kế hoạch, không mở kết nối.

Thứ tự: dò kết nối, áp schema, đồng bộ, kiểm tra. Schema 002/003 phải xong trước khi upsert, vì cột tiền và ngày đã là `DECIMAL` / `DATE`, còn `ingredient_f` là chỉ mục tra cứu MSC.

## Biến môi trường

Một trong hai cách, không commit giá trị:

- `TIDB_DATABASE_URL=mysql://user:password@host:4000/database`
- hoặc `TIDB_HOST`, `TIDB_USER`, `TIDB_DATABASE`, tùy chọn `TIDB_PORT` (4000) và `TIDB_PASSWORD`

Kết nối dùng TLS. `TIDB_SSL=0` chỉ khi TiDB local không có TLS. Cần `pymysql` (`pip install pymysql`). Driver HTTP không giữ biến session `@sql` của file 002, nên áp schema đi cổng MySQL.

Trên Vercel đặt `SEARCH_BACKEND=tidb` cùng một trong các biến TiDB ở trên. Nếu không, API sẽ tiếp tục dùng backend legacy dù bảng TiDB đã được đồng bộ.

## Lệnh

```text
python scripts/tidb/probe.py
python scripts/tidb/apply_schema.py
python scripts/tidb/apply_schema.py --yes-remote
python scripts/tidb/sync_to_tidb.py
python scripts/tidb/sync_to_tidb.py --yes-remote
python scripts/tidb/verify.py
python scripts/tidb/verify.py --yes-remote
```

`probe.py` chỉ `SELECT`. `apply_schema.py` chạy `tidb/001_search_schema.sql`, `tidb/002_perf_schema.sql`, rồi `tidb/003_msc_fast_lookup.sql`. Lệnh dừng nếu TiFlash không kích hoạt được — không được deploy metric khi replica chưa sẵn sàng. Chạy lại vẫn idempotent.

Migration 003 chuẩn hóa `ingredient_f`, tạo `idx_msc_prices_ingredient_f (ingredient_f, published, source_id)`, và dùng `ingredient_f LIKE 'silymarin%'` để TiDB có thể chạy `IndexRangeScan`. Không dùng `FULLTEXT`: TiDB Dedicated/self-managed chỉ nhận cú pháp nhưng không dùng index này. [TiDB docs](https://docs.pingcap.com/tidb/stable/sql-statement-add-index/)

`sync_to_tidb.py` đọc:

| Nguồn | Bảng |
|---|---|
| `data/vss_bhyt.sqlite3` | `vss_bids` |
| `test zone/data/thuoc.sqlite3` | `dav_drugs` |
| `test zone/procurement/data/procurement.sqlite3` | `msc_prices`, `msc_tenders` |
| `data/rollups/agg_vss_monthly.jsonl` | `agg_vss_monthly` |
| `data/rollups/suggest_values.jsonl` | `suggest_values` |

Sinh jsonl bằng `python scripts/build_rollups.py` trước. Lô 1000 dòng. Khóa chính trùng thì cập nhật các cột còn lại.

Giá trị tiền và ngày không parse được thành `NULL` ở cột typed, chữ gốc nằm ở `*_raw`. `380.000` là 380000. Cột `*_f` tính bằng `fold()` lúc ghi. Chiều rollup trống là `''`.

Sau mỗi bảng xong, `app_metadata` nhận `vss_total`, `dav_total`, `msc_prices_total`, `msc_total`. Không ghi `app_meta`.

## Checkpoint

`data/.tidb_sync_state.json` ghi sau mỗi lô đã commit. Chạy lại tiếp từ `id` / `source_id` / số dòng jsonl. File nguồn đổi kích thước hoặc mtime thì con trỏ bảng đó về đầu; upsert vẫn không nhân đôi. `--from-start` bỏ con trỏ. `--only vss,dav,prices,tenders,rollup,suggest` chọn phần.

## Kiểm tra

`verify.py` không có `--yes-remote` chỉ kiểm tra mẫu local: `380.000`, chữ bẩn, ngày sai, fold `cillin` / `uroxim`. Có cờ thì kiểm tra `AVAILABLE=1`, `PROGRESS=1` trong `information_schema.tiflash_replica`, so COUNT với SQLite và in `EXPLAIN` cho lookup `ingredient_f LIKE 'silymarin%'`. TiFlash chỉ sẵn khi `AVAILABLE=1` và `PROGRESS=1`. [TiFlash docs](https://docs.pingcap.com/tidb/stable/create-tiflash-replicas/)

Backend đang chạy của app vẫn là `SEARCH_BACKEND` hiện tại. Các script này không đổi biến đó và không ghi Turso hay Supabase.
