# Crawl hằng ngày trên cloud

Giao diện: Bảng tin / Tra cứu (DAV, MSC đơn giá, MSC gói thầu, VSS) /
Nâng cao (Bản đồ, Đa khung) / Quản lý danh mục / Dữ liệu. Ẩn tổng số lượng
đơn vị «gói» ở thẻ KPI danh mục; giữ các đơn vị khác và dữ liệu chi tiết.

## Hạ tầng đã cài

- GitHub Actions: `.github/workflows/daily-crawl.yml`, 22:17 UTC = 05:17 Việt Nam.
- Ba nguồn có job riêng; lịch mặc định chỉ bật MSC đơn giá đã kiểm chứng.
  Có thể chọn nguồn khác khi chạy thủ công trên GitHub để kiểm tra kết nối.
- TiDB credentials nằm trong GitHub Secrets, không nằm trong Git.
- Upsert dữ liệu mới; không xóa archive production. Lặp lại tối thiểu 3 ngày,
  bắt kịp tối đa 30 ngày dựa trên mốc cập nhật thành công. Lỗi không tăng mốc này.
- MSC đơn giá dùng API phân trang công khai, chia khoảng ngày để tránh cửa sổ
  10.000 bản ghi, kiểm tra đủ số dòng/ID trước khi ghi TiDB. Export trả lỗi
  cả trên local nên không dùng nó cho lịch cloud.
- Gói thầu dùng trình duyệt guest, không tự giải captcha. Webform công khai
  lưu tại `msc_scope_lots` và được đọc vào tra cứu online, cache 60 giây.
- Local → Dữ liệu: bật/tắt lịch, chạy cloud ngay, kiểm tra log, tải MSC/VSS
  từ TiDB về SQLite. Kéo về theo lô; không xóa dữ liệu local; chống nhân đôi
  đơn giá bằng khóa nghiệp vụ và giữ fingerprint VSS.
- File CSV R2 là snapshot riêng; thao tác kéo về local đọc trực tiếp TiDB.

## Kết quả kiểm tra nguồn

Cập nhật sau khi có HAR: xem [phân tích HAR VSS/MSC](har-public-crawl-2026-10-06.md).
VSS replay local nhận đúng 219 dòng của ngày 02/10, không cần cookie; GitHub
và Supabase Singapore/Tokyo vẫn lỗi kết nối. MSC chi tiết và 9 biểu mẫu đọc
được công khai, còn tìm kiếm danh sách dùng reCAPTCHA của website.

Lượt Linux [37403956003](https://github.com/dankezo/BaoAnSearcher/actions/runs/37403956003)
và [37404372556](https://github.com/dankezo/BaoAnSearcher/actions/runs/37404372556):
MSC Export mất kết nối, VSS bị reset kết nối, trang guest gói thầu timeout.
Lượt Windows [37404728720](https://github.com/dankezo/BaoAnSearcher/actions/runs/37404728720)
cũng gặp reset / timeout. Đây chưa phải bằng chứng nguồn bắt đăng nhập.

Do đó không được coi việc workflow đã cài là crawl thành công. Kiểm tra
`conclusion` từng job và `last_synced_at` TiDB để xác nhận một lượt thực sự xong.
Nguồn lỗi được đánh dấu warning, dữ liệu cũ được giữ lại.

Đường kết nối thử qua Vercel Singapore cũng trả ECONNRESET với VSS và đã được
gỡ, cùng khóa truy cập thử nghiệm. Không giữ thêm proxy hay dependency.

Sau khi chuyển sang phân trang và sửa chuẩn ngày Việt Nam, kiểm tra thực tế
local đã upsert 726 dòng vào TiDB, cập nhật metadata và rollup thành công.
Lượt [37406115959](https://github.com/dankezo/BaoAnSearcher/actions/runs/37406115959)
đã chạy thành công trên GitHub: upsert 397 dòng cho 3 ngày, tổng TiDB
554.116 dòng đơn giá, rebuild 11.575 dòng rollup. Đây là xác nhận chạy trên
cloud, không cần máy local. Lịch mặc định hiện chỉ chạy nguồn này.

MSC gói thầu và VSS chưa được xác nhận chạy cloud: giữ crawl local và dữ liệu
production cũ. Muốn đưa hai nguồn này lên cloud phải giải quyết đường kết nối
được nguồn chấp nhận trước; không được suy diễn rằng chỉ đăng ký thêm một kho
Turso/Supabase sẽ khắc phục được.

## Lựa chọn dịch vụ

GitHub runner tiêu chuẩn miễn phí cho repo public, dùng lại repo hiện tại:
https://docs.github.com/en/billing/concepts/product-billing/github-actions

Cloudflare Workers Free có 10 ms CPU mỗi invocation, không phù hợp để chạy
nguyên crawler Python/Excel/trình duyệt hiện tại:
https://developers.cloudflare.com/workers/platform/limits/

Supabase Edge Functions Free giới hạn wall-clock 150 giây và CPU 2 giây.
Phải chia lại crawler thành nhiều job nhỏ nếu chuyển sang hệ này:
https://supabase.com/docs/guides/functions/limits

Điểm cần giải quyết là kết nối từ cloud đến nguồn. Thêm Turso làm kho dữ liệu
không tự giải quyết việc crawl hay lỗi kết nối. Không thêm dependency production.

## Kiểm chứng

Frontend build; kiểm thử điều hướng/MSC và local fallback; kiểm thử cloud
webform cache; kiểm thử pull lặp lại, khóa chống trùng, số tiền gốc VSS và
không upload khi Export chưa hoàn tất. Cần khởi động lại Local API để có các
endpoint cloud mới.
