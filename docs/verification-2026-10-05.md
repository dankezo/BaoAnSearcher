# Kiểm chứng metric, dữ liệu và AI — 05/10/2026

Đã áp dụng migration Supabase `20261005024153_persistent_news_analysis` và TiDB `007_msc_price_daily_units`, làm mới rollup từ 553.459 dòng nguồn, rồi triển khai lên https://app.baoanpharma.com.

## Kết quả đối chiếu

- Metric prod paracetamol: 407.147.198.498 VNĐ, 2.031 dòng trong kỳ hiện tại; khớp SUM/COUNT truy vấn trực tiếp cùng bộ lọc. Chọn N1: 150.103.719.335 VNĐ; bảng giữ nguyên, bấm ngoài phục hồi tổng.
- Chuỗi có 12 vị trí từ 11/2025 đến 10/2026, tính tháng hiện tại đến 05/10. Tooltip tổng và nhóm đã kiểm tra trực tiếp trên prod; số lượng tách theo ĐVT, giá bình quân gia quyền và thành tiền gốc.
- Đã kiểm tra cơ sở Chợ Rẫy trên bản đồ VSS và MSC prod, cùng truy vấn cơ sở riêng ở local. Không dùng lại hoạt chất cơ sở trước khi đổi lựa chọn; loading, empty và error riêng.
- Adofebrat: đối thủ cùng ô kỹ thuật có giá 1.750 và 1.785 VNĐ, thấp hơn 44,44% và 43,33%; prod hiện ô giá đỏ. Fresh local endpoint cũng trả các chênh lệch này.
- Link lịch sử IB2500086079 chứa định danh c3fe7953-2be7-4ebe-8562-cce2c286aef9. Mở MSC xác nhận hồ sơ Sở Y tế Sơn La, gói thuốc năm 2025–2026; không dựng URL từ TBMT.
- Màn hình trang chủ 360/390/430px không cuộn ngang toàn trang. Nút thẻ “Nhịp thầu” giảm từ 150px xuống 64–75px; nút thêm cao 44px.

## Hiệu năng local

- Metric paracetamol trước sửa: 22,6 giây; sau SQLite tổng hợp và chỉ mục tìm kiếm: 0,61 giây lần đo trực tiếp, 0,88 giây qua API. Cache cùng bộ lọc nhanh hơn; DB/WAL thay đổi làm cache metric hết hiệu lực.
- API bảng giá: 1,43 giây; DAV metric: 2,94 giây; metric gói thầu: 1,19 giây trên dữ liệu đo.
- Local dùng SQLite cho tra cứu, metric, bản đồ và danh mục. Health check lỗi trên localhost vẫn giữ chế độ local, có test render App xác nhận. Tin tức/AI tiếp tục dùng dịch vụ ngoài theo chức năng.
- Bản local mới chạy ở http://127.0.0.1:8789. Tiến trình cũ 8787 cần người dùng khởi động lại nếu tiếp tục dùng cổng đó.

## AI và quyền truy cập

- Gemini Pro ưu tiên, Groq gpt-oss-120b dự phòng; OpenRouter hỗ trợ hoàn thiện JSON khi Groq lỗi. Key chỉ nằm ở cấu hình server và .env được Git bỏ qua.
- Đã kiểm tra bài thật: phân tích hoàn tất, lưu Supabase, lần đọc sau cached=true và giữ nguyên thời điểm. Tài khoản nhân sự trên prod thấy “Đã lưu” sau tải lại; “Phân tích cập nhật” tạo thời điểm mới.
- Google đang hết quota. Groq browser search trả lỗi trong lượt kiểm tra; fallback phân tích bài gốc, ghi rõ chưa đối chiếu nguồn ngoài. Không coi kết quả này là đã xác minh độc lập.
- Chỉ lưu JSON hoàn chỉnh với URL nguồn thuộc danh sách server xác nhận. Refresh lỗi giữ bản thành công trước; lease chặn yêu cầu trùng. Đã kiểm tra RLS nhân sự đọc, chỉ service role ghi/claim.

## Kiểm tra tự động

- Root Node: 44 test qua.
- Frontend: các test qua; typecheck và production build qua. Có test render bản đồ trước chọn cơ sở, loading/error, tooltip/group selection, API tìm kiếm và deep-analysis fallback.
- Python liên quan: 22 test qua, gồm FTS insert/update/delete, metric, bản đồ và giá đối thủ.
- git diff --check qua.
- Hai test MSC scope ngoài phần sửa vẫn thất bại trên code baseline không thay đổi: `test_mcg_equals_mg_for_abbreviated_vitamin_combo` và `test_public_line_names_the_baoan_hit` (near thay vì exact).


## Map and portfolio follow-up

- Ingredient match popup opens 10px left of the row. Verified production geometry: anchor x=1245, popup x=835, width=400, right edge=1235; viewport clamping remains on narrow screens.
- MSC province/region/national cards render distinct package counts by published month, 12 positions through October 2026, with signed month-to-month deltas and keyboard-focusable point titles. Financial values stay separate. Production province series differ; local fixtures also prove 2/1/0 counts and -1 changes.
- Portfolio replaces scale/golden/bid-activation/CMO cards with award revenue, quantities separated by unit, and distinct packages over the trailing 12 months. Cycle safety remains. VSS group labels such as G1 do not count as real package identifiers.
- Flat award lookup has ingredient/name/SDK/buyer/province/package search, 50-row pagination, real MSC links, and separate technical columns. Recent SDK watch uses grants in the trailing 12 months, grouped by SDK, expandable matching drug heads; known different groups are excluded and missing group evidence is explicit.
- DAV-confirmed registration aliases are reused in cloud history. Both backends return 344 award rows. Current DAV technical matches yield 8 recent SDKs locally and 4 in cloud; this reflects their source matching/data coverage, not an inferred tender-group assignment.
- Local and cloud 12-month aggregate now agree: 68,451,529,680 VND; 7,504,566 tablets; 450,080 sachets; 32 identified packages and 77 result rows. Four VSS contract-start dates were restored from exact local fingerprint matches after finding the sync mapper omitted legacy `tungay`; the mapper now preserves it. Date-field before-images are in `tmp-portfolio-date-backup.json`.
- 26 related Python tests passed; all 78 frontend tests passed; frontend typecheck/build and JS syntax checks passed. New tests cover source duplicate handling, date boundaries, separate units, legacy date sync, distinct month sets/deltas, flat history search and SDK expansion.
- Fresh local verification server: http://127.0.0.1:8790. Portfolio API warm request 0.23s. Cold nationwide MSC map request still measured 57.96s; this follow-up changes counts, not that existing scan cost.
- Final follow-up deployment: dpl_AeBcTfCJGa9ox4eMDRNWzohEeY9n, https://app.baoanpharma.com. Production smoke checks cover metric cards, SDK tab, expanded matching head, ingredient lookup, MSC month counts and popup placement.
- Automatic approval review blocked cleanup of temporary portfolio JSON evidence; the files were left intact and contain no credentials.
