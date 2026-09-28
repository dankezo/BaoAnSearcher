# Refactor màn hình Tra cứu thuốc DAV

## Cấu trúc

- `web/src/DavSection.tsx`: bố cục trang, chi tiết thuốc và tiến độ thao tác (thay `DavSection.jsx`).
- `web/src/types/dav.ts`: kiểu dữ liệu thuốc, bộ lọc, metrics và phân trang.
- `web/src/hooks/useDavSearch.ts`: truy vấn, gợi ý debounce, lưu bộ lọc theo tài khoản, metrics, chọn dòng và xuất Excel.
- `web/src/components/dav/`: `DavFilterSection.tsx`, `DavDataTable.tsx`, `DavMetricCards.tsx`, `useDavColumns.tsx`, `davConfig.ts`, `dav.css`.
- `web/src/services/davRpc.ts`: chuẩn hóa RPC; `davService.ts`: kiểm tra dữ liệu trả về và thông báo lỗi.
- `web/src/components.d.ts`: hợp đồng kiểu cho các component JavaScript dùng chung được DAV sử dụng.
- `web/tsconfig.json`: strict TypeScript, noUnusedLocals/noUnusedParameters; các màn hình JavaScript khác chưa được chuyển đổi.

Giữ cơ chế gõ để gợi ý, Enter/nút Tìm kiếm để áp dụng; trạng thái được chọn trước rồi áp dụng. Bảng giữ lọc cột, chọn toàn trang, phân trang, chi tiết thuốc, liên kết DAV, Quét lại, xuất dòng đã chọn hoặc toàn bộ kết quả. Bổ sung bộ chọn ẩn/hiện cột độc lập với nút Lọc cột. Metrics giữ các thao tác nhấp đúp lọc nhanh.

## Nguyên nhân và triển khai SQL

Kiểm tra chỉ đọc ngày 28/09/2026 xác nhận cấu hình hiện trỏ tới dự án Supabase `baoan-auth` (`gojdltnquedwpcqvecob`), không có `public.dav_drugs`. Luồng chính dùng `/api/tender/search` → Turso; khi API chính lỗi, fallback RPC không thể hoạt động chỉ bằng thay chuỗi rỗng thành null.

Chạy `supabase/migrations/20260928030408_search_dav_drugs.sql` bằng SQL Editor trên dự án được chọn làm nguồn DAV dự phòng. Script tự tạo bảng nếu thiếu, giữ RLS chỉ đọc cho authenticated, tạo RPC SECURITY INVOKER, thống nhất đếm và lấy dòng, rồi reload schema. Có 7 tham số chuẩn và `p_filters jsonb default null` cho bộ lọc nâng cao; lời gọi 7 tham số vẫn hoạt động. Script này không chèn dữ liệu.

Nếu tạo bảng mới, cần đồng bộ DAV (công cụ hiện có: `python scripts/sync_to_supabase.py --only dav`, với cấu hình nguồn SQLite và thông tin xác thực tương ứng). Trong đợt refactor này **chưa áp dụng migration hoặc đồng bộ lên production**. Nguồn Turso chính vẫn cần được triển khai/cấu hình đúng để API tìm kiếm và metrics hoạt động.

## Dọn dẹp

- Xóa `DavSection.jsx` sau khi chuyển sang các module TypeScript, không giữ bản backup trùng lặp.
- Xóa renderer `DavMetrics` không còn nơi sử dụng trong `metrics.jsx`; giữ hàm tính toán được kiểm thử và các metrics màn hình khác.
- Bỏ biến `refreshConfigs` không dùng, timeout tạo trạng thái tải metrics giả và dependency thừa.
- Không phát hiện file backup/tạm DAV cũ có thể xóa an toàn; các file công việc ngoài phạm vi có sẵn được giữ nguyên.

## Kiểm thử

Trong `web`: `npm run typecheck`, `npm run build`, `npm test`.

Kiểm thử mới chạy SQL thật bằng PostgreSQL/PGlite, kiểm tra migration chạy lại được, chữ ký cũ/mới, null, số trang, lọc nâng cao, tổng/dòng nhất quán và quyền anon/authenticated. Kiểm thử React chạy load → metrics → bộ lọc → đổi trang → chọn dòng → ẩn cột → lỗi/thử lại → tạo XLSX có nội dung thực. Các test dùng dữ liệu fixture; chưa xác nhận luồng production hoặc kiểm tra trực quan trên trình duyệt.
