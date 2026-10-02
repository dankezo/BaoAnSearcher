# Rollup chỉ số — P5

`POST /api/tender/metrics` không trả 503 khi hết cache. Thiếu cấu hình hoặc lỗi đọc trả `{ cards: [], total: null }` với HTTP 200. Lỗi đăng nhập vẫn là 401 hoặc 403.

## Thứ tự đọc trên TiDB

1. `agg_vss_monthly` cho BHYT: tổng thành tiền, số dòng, nhóm thầu, tỉnh. Khóa đúng như P3: `(loai, nam, ym, ma_tinh, nhomthau)`. Chiều trống là `''`. Năm không rõ là `0`.
2. Nếu rollup có dòng, số cơ sở KCB lấy thêm một câu có hint `READ_FROM_STORAGE(TIFLASH[vss_bids])`. Câu đó lỗi thì thẻ cơ sở là `—`, các thẻ tiền vẫn trả về.
3. Rollup trống thì aggregate trên TiFlash, cùng hint, không `SELECT *`.
4. DAV, đơn giá MSC và gói thầu chưa có bảng rollup. Cache miss của chúng chỉ chạy câu đã gắn hint TiFlash.

Không có câu đọc `vss_bids`, `dav_drugs`, `msc_prices`, `msc_tenders` mà thiếu hint TiFlash. Turso vẫn dùng cache `app_meta` rồi mới tính. Lỗi Turso cũng thành thẻ rỗng, không 503.

Gợi ý TiDB đọc `suggest_values`, không quét bảng sự kiện. Bảng chưa có thì danh sách rỗng.

## Sinh rollup

```text
python scripts/build_rollups.py
```

Đọc SQLite local, ghi `data/rollups/agg_vss_monthly.jsonl` và `data/rollups/suggest_values.jsonl`. Không mở TiDB. Nạp các file này bằng `python scripts/tidb/sync_to_tidb.py` sau khi schema 002 đã chạy. Mặc định vẫn là dry-run.
