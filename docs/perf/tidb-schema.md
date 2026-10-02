# Schema TiDB — P3

File áp dụng: `tidb/002_perf_schema.sql`, chạy sau `tidb/001_search_schema.sql`. Lệnh nằm ở `docs/perf/RUNBOOK-TIDB.md`. Mặc định dry-run, không mở cluster.

## Kiểu dữ liệu

Tiền một dòng (`gia`, `thanhtien`, `unit_price`, `bid_price`) là `DECIMAL(15,2)`. Số lượng (`soluong`, `quantity`) là `DECIMAL(18,3)`. Ngày nghiệp vụ là `DATE`. `nam` là `SMALLINT`.

Giá trị không parse được để `NULL` ở cột typed và giữ nguyên chữ ở cột cùng tên với hậu tố `_raw` (`gia_raw`, `tungay_hd_raw`, …). Tổng rollup dùng `DECIMAL(20,2)` vì cộng nhiều dòng.

## Cột fold

Tính lúc import, không phải generated column. Cùng thuật toán với `fold()` trong `server/common.py` và `web/src/api.js`: chữ thường, `đ`/`Đ` thành `d`, tách dấu NFD, bỏ combining mark.

| Bảng | Cột |
|---|---|
| `vss_bids` | `hoatchat_f`, `ten_f`, `ten_tinh_f` |
| `dav_drugs` | `hoat_chat_f`, `ten_thuoc_f` |
| `msc_prices` | `name_f`, `ingredient_f`, `province_f` |
| `msc_tenders` | `name_f`, `province_f` |

`fp_hash` là SHA-256 của `fingerprint` đầy đủ và là khóa chính của `vss_bids`. Giá trị nguồn dài hơn 2.000 ký tự, không làm khóa utf8mb4 được. Cột `fingerprint` vẫn giữ nguyên chuỗi để phân trang.

## Index

Btree phục vụ bằng, khoảng ngày, và tiền tố khóa. `LIKE '%từ%'` không đi btree; câu đó quét cột đã fold trên TiFlash.

| Index | Cột | Dùng cho |
|---|---|---|
| `idx_vss_loai_nam_tinh` | `(loai, nam, ma_tinh)` | Lọc loại + năm, thêm mã tỉnh |
| `idx_vss_nhom_nam` | `(nhomthau, nam)` | Nhóm thầu trong một năm |
| `idx_vss_tungay` | `(tungay_hd)` | Khoảng ngày hợp đồng |
| `idx_vss_sodk` | `(sodk)` | Số đăng ký bằng đúng |
| `idx_dav_tag_id` | `(tag_id)` | Lọc tag DAV |
| `idx_dav_ngay_cap` | `(ngay_cap)` | Sắp và lọc ngày cấp |
| `idx_msc_prices_pub` | `(published, source_id)` | Đơn giá mới nhất |
| `idx_msc_prices_province` | `(province)` | Lọc tỉnh đơn giá |
| `idx_msc_tenders_pub` | `(published, source_id)` | Gói thầu mới nhất |
| `idx_msc_tenders_province` | `(province)` | Lọc tỉnh gói thầu |

Không đặt btree trên `hoatchat_f` / `ten_f`: tiền tố `%` không dùng được index đó.

## Rollup và gợi ý

`agg_vss_monthly` khóa chính `(loai, nam, ym, ma_tinh, nhomthau)`. Chiều trống lưu `''`. Tra theo loại + năm dùng tiền tố khóa. `idx_agg_vss_tinh_nam (ma_tinh, nam)` cho câu đi từ tỉnh.

`suggest_values` khóa chính `(section, field, value)`. Tra một giá trị là một điểm trên khóa. `value` tối đa 512 ký tự để vừa giới hạn index utf8mb4.

## TiFlash

`ALTER TABLE … SET TIFLASH REPLICA 1` trên `vss_bids`, `dav_drugs`, `msc_prices`, `msc_tenders`.

Plan ghi `msc_records`. Schema 001 tách đơn giá và gói thầu thành hai bảng, nên replica gắn vào hai bảng đó. Câu `ALTER` này chỉ chạy trên TiDB.
