# Sửa số gói, lịch sử và DAV — 05/10/2026

- Tổng MSC dùng metadata gói thầu riêng, đếm mã gói duy nhất thay vì dòng đơn giá.
- Nhịp mở thầu dùng `bidOpenDate`, giữ mọi trạng thái và bộ lọc địa phương/thuốc. Gói chưa xác định tỉnh vẫn tính vào tổng quốc gia; thiếu ngày mở thì không suy từ ngày đăng/đóng.
- Lịch sử trúng cuộn tải thêm từng 50 dòng từ dữ liệu đã tải, có nút tải thêm dự phòng. Tên thuốc và SĐK tách cột. SĐK mới có công ty đăng ký.
- DAV sửa lỗi generator bị đọc hai lần, tra cả SĐK hiện tại/cũ, bổ sung nhóm VSS và bộ lọc trên local/TiDB/Turso. Các nhóm này là dữ liệu thầu đã quan sát, không xác nhận điều kiện pháp lý. Supabase RPC dự phòng chưa hỗ trợ nhóm: khi chọn nhóm, lỗi nguồn chính được hiển thị thay vì âm thầm bỏ bộ lọc.
- Bảng DAV thêm SĐK cũ, quyết định, tiêu chuẩn và hạn dùng.

Kiểm tra: 81 test web, 20 test Node backend, 28 test Python, typecheck và build. Truy vấn dữ liệu thật xác nhận 10.041 mã gói MSC; DAV trả được thuốc có Nhóm 2 và thuốc thuộc cả Nhóm 2/4.

## Triển khai production

Đã chạy migration TiDB 008 và đồng bộ lại riêng gói thầu:

```powershell
python scripts/tidb/apply_schema.py --only 008 --yes-remote
python scripts/tidb/sync_to_tidb.py --only tenders --from-start --yes-remote
```

Không dùng `--prune`. Database có 10.044 dòng, 10.041 mã gói duy nhất và cả 10.044 dòng có ngày mở thầu.

Production: https://app.baoanpharma.com — deployment `dpl_GX7sSu69Bp43UJVYMnvuWGhShLnV`, trạng thái READY.

Đính chính KPI Bảo An: 450.080 là số gói thuốc, không phải số gói thầu. Prod có 344 dòng lịch sử; KPI 12 tháng có 32 mã gói thầu, 77 dòng kết quả. Nhãn đã tách rõ “gói thuốc” / “gói thầu”.

Kiểm tra giao diện prod: cuộn lịch sử tự tăng 50 → 100/344 dòng, tên thuốc và SĐK tách cột; SĐK mới hiện công ty đăng ký; lọc DAV Nhóm 2 trả 3.417 kết quả và cột nhóm có N2. Truy vấn nhóm dùng hai phép EXISTS với so sánh SĐK bằng nhau để tránh kế hoạch Cartesian; trang 100 dòng và đếm nhóm mất khoảng 1,6–1,7 giây trong kiểm tra database thật. 14 test truy vấn liên quan đạt sau bản sửa hiệu năng. Hàm map chạy với dữ liệu cloud trả tháng 09/2026 = 167, 10/2026 = 55; gói IB2600521250 có lịch cũ 29/09 và lịch mới 05/10 nên đếm một gói theo bản đang đọc.
