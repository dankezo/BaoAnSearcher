# MSC - YCBG

Tìm trên MSC theo YCBG, từ khóa `thầu thuốc`, `all-1` (khớp tất cả từ, phân biệt dấu), 50 bản ghi/trang. Giữ cả kết quả ngoài thuốc mà nguồn trả về; chỉ đối chiếu khi hồ sơ có dòng thuốc.

`python scripts/crawl_ycbg.py --publish` lấy dữ liệu local và đồng bộ riêng tập YCBG lên TiDB. Lần đầu duyệt tất cả trang, đối chiếu số ID duy nhất với tổng nguồn, tải từng `get-request-quote` và lưu JSON gốc vào `data/msc_ycbg/`. Biểu mẫu `formValue` cung cấp danh mục, `nhomTCKT` là nhóm kỹ thuật; thuốc không có danh mục cấu trúc được ghi cần rà soát hồ sơ đính kèm. Chưa tự đọc PDF scan/OCR.

Tra cứu mặc định 100 dòng/trang, crawler dùng 50. Lượt sau lấy tối thiểu ba trang gần nhất, quét chồng bảy ngày từ lần hoàn tất, kiểm tra lại yêu cầu còn hạn và hồ sơ lỗi. Runner cloud khôi phục dữ liệu TiDB trước khi chạy để không tải lại toàn bộ lịch sử mỗi ngày. Nếu nguồn lỗi giữa chừng, giữ dữ liệu đã tải, đồng bộ phần có được, báo warning và giữ mốc hoàn tất cũ. Lease SQLite ngăn hai lượt local cùng chạy; mất tiến trình thì lease hết sau hai giờ.

Lịch GitHub Actions trong `daily-crawl.yml`: 05:17 giờ Việt Nam mỗi ngày, nguồn `ycbg` chạy riêng. Cần đưa thay đổi workflow lên nhánh chạy lịch mới có hiệu lực cloud. Local đã tích hợp vào cập nhật mỗi ngày khi ứng dụng mở; lịch Windows `BaoAnSearcher YCBG Daily` chạy 05:35, khởi động bù nếu bỏ lỡ và thử lại tối đa 3 lần cách 15 phút khi lỗi; `DAILY_YCBG.cmd` dùng cho Windows Task Scheduler nếu muốn cập nhật khi không mở app. Máy phải bật để lịch local chạy.

Nhóm trống ở một trong hai phía chỉ là cần rà soát. Nhóm xác minh khác nhau thì loại khỏi khớp. Lịch sử trúng nhóm theo SĐK hiện tại/SĐK cũ được lưu riêng trong `group_evidence`, không dùng làm bằng chứng đủ điều kiện hiện tại. `python scripts/enrich_baoan_groups.py --apply` cập nhật bằng chứng vào danh mục local và cloud.

Kiểm tra: `python -m unittest tests.test_ycbg tests.test_ycbg_publish tests.test_baoan_match tests.test_msc_scope_filters tests.test_match_report tests.test_regulatory_daily`; `node --test tests/ycbg.test.mjs tests/p4-search.test.mjs tests/api-router.test.mjs`; `npm --prefix web run build`.

Fallback Cloudflare đã có `/ycbg/search` và `/ycbg/details`, giữ ngân sách Browser Run chung. Local dùng `CLOUDFLARE_YCBG_WORKER_URL` + `CLOUDFLARE_YCBG_KEY` riêng; runner có thể dùng key crawl hiện có. Khóa riêng chỉ gọi YCBG/quota. Dữ liệu từng lô được ghi trước khi tải lô sau; không coi thiếu hồ sơ là thành công. `python scripts/crawl_ycbg.py --publish --cloud-cache data` phát lại các archive gzip đã lấy từ nguồn qua cùng bộ kiểm tra, không bỏ qua bước đối chiếu tổng ID.

Lần lấy đủ 14/10/2026: 24 trang, 1.186 ID duy nhất và 1.186 hồ sơ khớp đúng ID; 1.127 hồ sơ có danh mục cấu trúc, 88.856 dòng thuốc; không thiếu/lỗi. Đã đồng bộ TiDB và registry healthy. Manifest gốc local: `data/ycbg_cloud_manifest.json`. Tra cứu phân trang thông thường chỉ đối chiếu danh mục của trang cần xem; các bộ lọc dòng thuốc vẫn đối chiếu toàn bộ ứng viên để giữ kết quả đúng.
