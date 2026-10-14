# Đối chiếu VSS và báo cáo thầu BHYT – 09/10/2026

## Bổ sung nghiên cứu và giao diện – 12/10/2026

Production: `dpl_AhHhvw3LPa9QdwNEy8w217h45kat`, https://baoan-searcher-jnylg46vh-baoan.vercel.app; promote lên https://app.baoanpharma.com từ workspace hiện tại. Không thêm dependency, không sửa dữ liệu nguồn trong đợt này. Phần ngày 11/10 bên dưới là lịch sử phát hành trước.

- VSS lấy dạng bào chế DAV theo SĐK hiện tại và cũ. Bảng đối chiếu có một dòng mỗi SĐK; nhiều dạng xung đột không được chọn tùy ý và không nhân dòng thầu. UI ghi “Chưa xác định” khi không đối chiếu được. Production: 100/100 dòng đầu Silymarin có dạng; Macrina và Silymax-F là “Viên nang cứng”, Lacikez là “Viên nén bao phim”. Kiểm thử API bao phủ SĐK cũ, trùng quyết định và dạng xung đột; local dùng cùng quy tắc.
- Silymarin mặc định gồm phối hợp và tên có chú thích chiết xuất; checkbox “Bao gồm phối hợp” nhớ lựa chọn. Khớp chính xác cũ có 2 SĐK còn hạn; phạm vi mới có 85 SĐK / 38 còn hạn xác định tại 12/10/2026. Tắt phối hợp: 64 / 25. Các tên Silygamma, Anbaliv, Amisea, Carsil, Macrina là tên thương mại có Silymarin; bảng ghi thêm hoạt chất dưới tên thuốc. Tổng sản phẩm giữ cách gộp quy cách cũ để không chia nhỏ giá trị theo các cách ghi hoạt chất.
- Production VSS 01/06/2025–01/10/2026: Silymarin 300 dòng / 36.661.750 Viên / 105.386.560.950 đồng; SĐK 590110425723 vẫn 34 dòng / 1.607.127 Viên / 6.570.134.000 đồng. Đây là trúng thầu, không phải lượng bán thực tế.
- Drawer bảng tin nằm phải trên desktop, có animation mở/đóng và một vùng cuộn toàn chiều cao. Kiểm thử 60 thẻ giả (30 mới, 30 sắp đóng): mép phải đúng 1528 px, nội dung 7153 px, cuộn được tới cuối; không giới hạn chiều cao panel con. Dữ liệu giả chỉ nằm trong fixture `outputs/research-acceptance.mjs`, không đưa lên production.
- Metric VSS dùng bố cục đơn giá, xu hướng bên phải, phần/lô và CSYT phía dưới, không có top tỉnh. Toàn thị trường hiển thị hai đơn vị trước; danh sách đơn vị còn lại mở bằng details. Desktop VSS tính độ rộng bảng theo cột đang hiện; dòng mẫu giảm 165 → 47 px. Điện thoại giữ thẻ. Bản đồ mở MSC gói thầu trước.
- Nghiên cứu: đường tổng nổi bật mặc định, click nhóm/click ra ngoài để đổi/reset; bảng quy cách chỉ có một vùng cuộn. Ba xếp hạng nhà thầu/địa bàn/CSYT cùng hàng trên desktop, production đo cùng top 2875 px. Nhấp đúp toàn dòng sản phẩm hoặc ma trận mở đúng phạm vi thuốc/nhóm/quy cách/nhà thầu và nguồn. Mẫu Silygamma mở 270 mã TBMT; dòng thiếu nhà thầu cùng SĐK/quy cách mở 23 mã TBMT. Nhà thầu thiếu trong nguồn được ghi rõ, không thay bằng công ty đăng ký DAV. Đối chiếu cả SĐK cũ để bổ sung công ty đăng ký.
- Doanh nghiệp: hồ sơ trái và kết quả gần đây phải; bỏ ảnh chưa xác minh. Gói nhiều hoạt chất mở thuốc/hàm lượng/dạng/nhóm tại dòng với nền đậm hơn. Nhấp đúp dòng công ty mở thông tin mã TBMT, không lặp panel kết quả gần đây. AI tổng hợp top 2 theo SĐK qua các nhóm, nêu nhóm dẫn đầu theo giá trị/tỷ trọng; không suy lợi nhuận khi thiếu chi phí. Giá Bảo An chỉ được nêu khi khớp hoạt chất, hàm lượng, dạng, nhóm và đơn vị; giữ ngày và chênh lệch %. Lê Lợi ALL: Macrina 893210119700 = 5.257.300.000 đồng; NLP-Cetam 2400 893110035424 = 1.777.500.000 đồng; không có cặp giá Bảo An hợp lệ.
- Truy vấn chiến lược doanh nghiệp cùng dữ liệu giảm 78.891 → 11.314 ms trong phép đo local→TiDB: giữ nguyên top 2, 26 quy cách giá đối thủ và 94 quy cách giá Bảo An. Lọc sơ bộ tên là tập rộng hơn, vẫn giữ điều kiện chuẩn hóa chính xác; SĐK ASCII dùng một regex trên trường gốc thay cho nhiều LIKE trên khóa chuẩn hóa. Không coi phép đo đơn lẻ là bảo đảm thời gian cho mọi truy vấn.
- PDF xuất bản tóm tắt: quy cách 3 dòng, sản phẩm/xếp hạng 4 dòng, bảng khác 5 dòng; ghi số dòng và link ứng dụng để xem đủ. Biểu đồ giữ SVG, bỏ animation số liệu để tránh ảnh trong quá trình chuyển; nhịp gói thầu sắp tháng tăng dần, bỏ tháng không xác định. Chờ chi tiết tải xong trước xuất; giữ tiêu đề và bảng cùng trang. Hai PDF Silymarin/doanh nghiệp được render và xem từng trang, 4 trang mỗi bản; bản đầy đủ vẫn có trên ứng dụng/HTML.

Kiểm chứng: **137/137 tests web**, **90/90 API**, **8/8 tests local analytics**, typecheck và build đạt. Viewport Edge 390/320 px: dialog và thẻ nằm trong màn hình; ở 320 px một ảnh nổi do extension trình duyệt gây 11 px tràn ngoài app, không thuộc DOM sản phẩm. Chưa kiểm trên thiết bị iOS/Android thật. Bằng chứng trong outputs: `research-final-web-tests.log`, `research-final-api-tests.log`, `research-final-local-tests.log`, `research-final-typecheck.log`, `research-release-final.json`, `research-release-promote.log`, `research-production-http.json`, `research-production-vss.json`, `company-strategy-final-proof.json`, hai `research-*.pdf`, ảnh `research-pdf-pages/` và `research-production-vss.png`.

## Trạng thái phát hành – 11/10/2026

Đã cập nhật production theo xác nhận của người dùng tại **https://app.baoanpharma.com**. Bản cuối `dpl_8qpRmA1AEetmTrBJdSCy35T6aXWW` (https://baoan-searcher-q2grmcly9-baoan.vercel.app) đã READY và promote thành công từ repo gốc, gồm frontend và API. Các mục bên dưới là nhật ký theo thời điểm; những câu “chưa triển khai/chờ xác nhận” mô tả trạng thái cũ.

### Bản bổ sung: giao diện điện thoại và kết quả lưu theo tài khoản

Điện thoại dùng thẻ, bỏ các nút đổi Thẻ/Bảng, ẩn/hiện cột và lọc cột theo yêu cầu mới nhất. Toolbar tra cứu giữ Lưu kết quả, Quét lại và Xuất Excel cùng dòng ở 320 px. Ngày cập nhật nằm cùng hàng với tên trang; ô tìm tổng hiện rõ cho DAV/VSS/MSC, trạng thái DAV chuyển vào Bộ lọc chi tiết. Máy tính giữ bảng. Nút tìm BHYT đã căn đáy với trường bên trái (chênh lệch đo được 0 px). Các đoạn nhật ký cũ nói có bảng tùy chọn trên điện thoại đã được thay thế bởi yêu cầu này.

BHYT có tóm tắt từ khóa/kỳ/phạm vi/số dòng/tổng tiền, giải thích số dòng khi hover hoặc chạm. Thẻ chính gom thông tin phụ vào details native, mẫu Lacikez cao khoảng 336 px tại 390 px. Lịch sử nay mở được ở cả dòng nhóm gộp nhiều sản phẩm, giữ đầy đủ các bản ghi con; nhóm Lacidipin 2mg/nhóm 1 có 42 dòng, tổng 1.726.127 Viên / 7.086.951.000 đồng khớp nhóm chính. Lịch sử SĐK 590110425723 có 34 dòng và tổng đúng như bên dưới. Trên bản cuối, hộp lịch sử nằm trong viewport 320/390/430 px (lề trái/phải 14 px), document không tràn ngang. Đây là kiểm tra mô phỏng Edge, chưa phải thiết bị iOS/Android thật.

Lưu kết quả dùng tài khoản Supabase hiện tại, snapshot dữ liệu và bộ lọc tại thời điểm lưu. Nút lưu có ở DAV, VSS, MSC, thống kê BHYT, phân tích và bản đồ; xem lại trong Dữ liệu → Kết quả lưu, xuất Excel, in/PDF hoặc xóa sau xác nhận. Snapshot tối đa 50.000 dòng/8 MiB; truy vấn lỗi hoặc bị cắt không được lưu như kết quả đầy đủ. Danh sách đã mở tự làm mới sau khi lưu. Mở bản lưu không chạy lại truy vấn nguồn.

Migration `20261011123109_account_saved_results.sql` đã áp dụng trên project production `baoan-auth`: bảng `user_saved_results` có RLS SELECT/INSERT/DELETE theo chủ sở hữu, không cấp UPDATE/SELECT cho anonymous. Đã kiểm tra tài khoản khác không đọc được bản lưu; kiểm tra DELETE đúng chủ sở hữu bằng transaction rồi rollback, giữ lại bản lưu thật. Không thay quyền truy cập dữ liệu nguồn.

Hai bản lưu kiểm chứng trong tài khoản hiện tại: “Đối chiếu Lacikez · 01/06/2025–01/10/2026” (1 dòng sản phẩm, kèm 34 dòng lịch sử) và “VSS Lacikez · 01/06/2025–01/10/2026” (34 dòng VSS). Tải lại trang và mở bản lưu trên production vẫn cho 1.607.127 Viên / 6.570.134.000 đồng. Hàm xuất Excel thực tế chạy với snapshot VSS đã lưu tạo `outputs/saved-vss-lacikez.xlsx`: CRC ZIP đạt, 34 dòng, số lượng/thành tiền numeric, SĐK text, sheet Bo_loc đúng hai ngày và không NaN/undefined. Nhấn xuất ở giao diện không phát sinh lỗi nhưng event download của công cụ timeout, nên chưa xác nhận trình duyệt hoàn tất tải tệp này. Nút In / Xuất PDF mở đúng cửa sổ in với bản lưu; chưa lưu PDF thật qua hộp in hệ thống.

Lịch cập nhật cloud thật trên GitHub đã đổi thành 05:17 giờ Việt Nam, thứ Hai–thứ Bảy; bỏ Chủ nhật. Cron UTC `17 22 * * 0-5`, commit `88f176e5da4447ce456830cdf450c09ceed153c0`, đã đọc lại nội dung workflow từ remote để xác nhận. Nhãn lịch local cũng đồng nhất. Không chạy crawler mới chỉ để đổi nhãn ngày cập nhật.

Kiểm chứng bổ sung: **134 tests web đạt**, typecheck/build đạt; **9 tests model báo cáo/API liên quan đạt**. Hai tests giao diện Data Hub/danh sách bản lưu đã chạy lại sau chỉnh header; bốn tests lưu kết quả và build đã chạy lại sau làm rõ nhãn dòng sản phẩm, đều đạt. Không thêm dependency. Bằng chứng mới: `web-current-task-tests.log`, `web-current-task-build.log`, `saved-vss-export-proof.json`, `saved-history-phone-geometry.json`, `cloud-sunday-proof.json`, `account-saved-release.json`, `account-saved-release-promote.log`, `saved-final-caption-tests.log`, ảnh `saved-results-mobile-final.png` trong outputs.

Đã bổ sung đúng **173 dòng VSS thiếu** theo fingerprint, không prune dữ liệu gốc. Kho local và TiDB đều có **744.954 dòng**, không thiếu hoặc thừa hash. Khi đối chiếu ngày, phát hiện **76 dòng mới** có ngày bắt đầu HĐ để trống trong nguồn nhưng bộ nhập lấy nhầm ngày công bố. Đã bỏ fallback đó cho trường nguồn trống, sửa cột ngày dẫn xuất của đúng 76 dòng và dựng lại tổng hợp tháng trong transaction. Nội dung raw nguồn được giữ nguyên; backup trước sửa nằm trong outputs. Đối chiếu toàn bộ 744.954 dòng: ngày bắt đầu và kết thúc HĐ local/cloud không còn khác nhau. Tổng hợp 12 tháng cũng khớp facts theo ngày bắt đầu HĐ.

Giao diện production, metrics và báo cáo BHYT cùng bộ lọc **SĐK 590110425723, 01/06/2025–01/10/2026** cho **34 dòng / 1.607.127 Viên / 6.570.134.000 đồng**. Request giữ đúng ngày ISO; ô nhập hiển thị dd/mm/yyyy. Không tái hiện đúng số 2,… tỷ đã được báo trước đây; lỗi mất ngày đã tái hiện và sửa. Không thấy dữ liệu SĐK bị nhân 1.000. Các con số là lượng/giá trị trúng thầu ghi nhận, không phải bán thực tế hay thanh toán BHYT.

Phạm vi tìm kiếm cần giữ khi so sánh: phân tích chọn chính xác “Lacidipin” có **181 dòng / 47.430.533.480 đồng**. Tra cứu hoạt chất dạng chứa chuỗi có **186 dòng / 47.751.173.480 đồng**, gồm thêm 4 dòng “Lacidipine” và 1 dòng “Lacidipin 2mg”. Đây là khác phạm vi ghép tên, không phải lỗi cộng. Cùng kỳ đến 10/10/2026, mẫu Losartan sau đồng bộ có 1.511 dòng / 250.642.593 Viên / 550.873.668.436 đồng, khớp local.

Đã phát hành cả CSV và XLSX cho bốn nguồn. Tất cả tám URL công khai trả HTTP 200; file XLSX tải lại và kiểm tra CRC ZIP, số dòng khớp facts và metadata:

| Nguồn | Dòng Excel | Dung lượng Excel |
|---|---:|---:|
| DAV | 55.005 | 6.686.534 byte |
| MSC_PRICE | 555.322 | 94.922.080 byte |
| MSC_BID | 10.114 | 882.468 byte |
| VSS | 744.954 | 117.134.126 byte |

VSS Excel khoảng 112 MiB, so với CSV khoảng 770 MiB; tải toàn bộ dùng file dựng sẵn trên R2. Đã xử lý ký tự điều khiển không hợp lệ trong nội dung Excel và kết nối TiDB hết thời gian chờ trong lúc tạo file lớn. SĐK trong snapshot là text; các cột lượng/giá/tiền là numeric. Thời gian tạo toàn bộ Excel được trả trước ở bước phát hành, không buộc người tải chờ dựng lại 744 nghìn dòng.

Tải tùy chỉnh trên production với bộ lọc SĐK/kỳ trên tạo Excel **34 dòng**, tổng lượng/tiền đúng, SĐK dạng string và lượng/tiền dạng số. Phát hiện và sửa sheet `Bo_loc` bị dựng bằng renderer heatmap: nay có bảng Tiêu chí/Giá trị, hai ngày ISO, số dòng và bộ lọc đúng; không còn NaN/undefined. Mở lại file tải qua Edge xác nhận cả dữ liệu và sheet bộ lọc. Công cụ chờ download của phiên này chưa xác nhận đổi tên `.crdownload` cuối cùng; đã kiểm tra nội dung XLSX nhận được và lưu bản `.xlsx` để đối chiếu. Không suy diễn đây là lỗi tải trên mọi trình duyệt.

Thử tải snapshot toàn bộ từ Data Hub đã chuyển đúng tới URL `snapshots/vss.xlsx`, nhưng Edge của phiên kiểm thử hiển thị **“blocked by Microsoft Edge / ERR_BLOCKED_BY_CLIENT”** trên miền R2. Kiểm tra HTTP bằng runtime Node và tải lại qua R2 API đều thành công. **Người dùng đã xác nhận tải được Excel toàn bộ trên điện thoại.** Vì vậy đường tải sử dụng thật đã được xác nhận; lỗi chặn ghi nhận ở Edge của phiên kiểm thử, không thay đổi hoặc vượt bảo vệ trình duyệt. Chưa xác nhận bước tải toàn bộ hoàn tất qua Edge này.

Trên production, hộp lịch sử SĐK và chi tiết gói MSC thật IB2600302039 được đo ở viewport CSS **320/390/430 px**: hộp/nội dung không tràn ngang. Thẻ lịch sử mẫu giảm khoảng **26% chiều cao** (233 → 172 px tại 390 px); chế độ Bảng vẫn giữ đủ dòng và cuộn ngang trong vùng bảng. Chi tiết gói compact, thuốc trong gói có details native, tiêu đề/nút đóng giữ khi cuộn. Không kiểm tra trên iPhone/Safari hay Android thật.

Sửa metadata TiDB xuất timestamp có UTC (`Z`), giao diện hiển thị giờ Việt Nam đúng thay vì lệch 7 giờ. Đã xác nhận Data Hub hiển thị VSS cập nhật 11/10/2026 18:55. Nhãn Cloud không còn khẳng định kho Supabase; tooltip ghi Supabase dùng đăng nhập. Project production `baoan-auth` không có bảng VSS hoặc RPC `search_vss_bids`, nên migration legacy không có đối tượng để áp dụng ở project này; đường dữ liệu hiện tại dùng API/TiDB. Migration vẫn dành cho kho Supabase legacy nếu được khôi phục riêng.

Kiểm chứng: **130 tests web đạt**, build đạt sau sửa Excel cuối; trước đó bộ **88 tests API** đạt, chạy thêm 13 tests API liên quan sau sửa metadata cũng đạt. Các nhóm Python nhập ngày, rollup, báo cáo và xuất dữ liệu đạt; kiểm tra diff không lỗi whitespace. Không thêm dependency production. Độ khớp dữ liệu là so sánh các kho đang có, chưa xác minh từng dòng với hợp đồng gốc; các bất thường nguồn đã liệt kê bên dưới vẫn cần đối chiếu hồ sơ khi dùng để quyết định.

Bằng chứng trong `outputs/`: `production-date-parity.json`, `pre-ship-vss-parity.json`, `pre-ship-rollup.json`, `production-sdk-metrics-proof.json`, `production-sdk-report-proof.json`, `production-ingredient-match-proof.json`, `production-snapshots-proof.json`, `production-public-downloads-proof.json`, `production-custom-sdk-proof.json`, `production-custom-sdk.xlsx`, `production-mobile-history-proof.json`, `production-mobile-package-proof.json` và các log deploy/promote/test tương ứng. Thư mục này được gitignore, không đưa credentials hoặc file tải lớn vào Git.

Ảnh mobile bản cuối: `outputs/production-download-mobile-final.png` (hộp tải theo ngày/SĐK, nhãn Cloud); `outputs/production-mobile-package-390.png` (chi tiết gói compact, trước khi thay nhãn Cloud).

## Nhật ký đối chiếu ban đầu

Kỳ đối chiếu: **01/06/2025–01/10/2026**, theo **ngày bắt đầu hợp đồng**, loại Tân dược. Đây là lượng trúng thầu; dữ liệu không chứng minh lượng đã bán hay đã thanh toán BHYT.

| Phạm vi | Dòng thầu | Số lượng (Viên) | Thành tiền (đồng) |
|---|---:|---:|---:|
| Lacidipin | 186 | 11.315.471 | 47.751.173.480 |
| SĐK 590110425723 | 34 | 1.607.127 | 6.570.134.000 |
| Lisinopril, gồm phối hợp | 1.340 | 69.935.144 | 196.381.972.014 |
| Losartan, gồm phối hợp | 1.509 | 250.442.593 | 550.807.068.436 |

TiDB và kho VSS local cùng cho SĐK trên tổng **6,57 tỷ**, giá **3.900–4.200 đồng/Viên**. Chưa tái hiện phép tính nhân 1.000. Format cũ thêm số 0 thành `6,570 tỷ` theo dấu thập phân tiếng Việt, rất dễ đọc nhầm thành 6.570 tỷ. Đã bỏ phần đệm và thêm tooltip số đồng đầy đủ.

Lỗi xác nhận được: danh sách cloud giữ dòng thiếu ngày HĐ trong kỳ; một số nhánh static/Supabase dùng ngày kết thúc HĐ ở cận trên. Nay danh sách và metrics thống nhất ngày bắt đầu HĐ, bao gồm cả ngày cuối kỳ, loại ngày thiếu. Migration `20261009000100_vss_contract_start_window.sql` sửa RPC Supabase cũ mà giữ các bộ lọc và quyền hiện có. Migration mới cần được áp dụng khi triển khai nhánh này; chưa đổi DB production.

Module **Nâng cao → Thống kê thầu BHYT** dùng VSS và bổ sung DAV theo SĐK hiện tại/cũ. Không nhân số dòng khi DAV có nhiều hồ sơ; thông tin DAV mâu thuẫn để trống. Mỗi nhóm tách thành phần, hàm lượng, đường dùng, dạng bào chế, nhóm kỹ thuật và đơn vị. Một SĐK tính là một sản phẩm trong nhóm. Thành tiền cộng từng dòng thực tế; đơn giá là giá thấp nhất, nên không dùng đơn giá thấp nhất nhân tổng lượng làm doanh thu.

Có tìm hoạt chất/tên/SĐK đầy đủ, đơn chất/phối hợp, mở dòng con, lịch sử SĐK trong bộ lọc của khối, Stack, Xóa bảng và Excel 15 cột. SĐK xuất dạng text; lượng/giá/tiền vẫn là số. Báo cáo từ chối hơn 5.000 dòng để tránh âm thầm thiếu dữ liệu.

Kho VSS hiện thiếu phân hạng bệnh viện, mã TBMT và ngày có kết quả đầy đủ. Bộ lọc tuyến viện hiển thị chưa có dữ liệu; lịch sử ghi rõ ngày bắt đầu HĐ và đếm dòng thay vì suy đoán số gói. Bảng Excel của sếp chỉ là đối chiếu: chưa đủ thông tin kỳ, đơn vị và quy tắc tổng hợp để khẳng định cách sếp tra cứu.

Tái lập từ thư mục gốc với cấu hình TiDB hiện có: `node scripts/audit-tender-report.mjs`. Lệnh chỉ đọc DB, ghi ba bộ dữ liệu đối chiếu và file Excel vào `outputs/` (đã gitignore). Sau đó chạy `node tests/tender-report-browser.mjs` trong `web/` để kiểm tra giao diện tại `/report-test`; trang này phát lại bộ dữ liệu đối chiếu, không thay thế kiểm tra API nguồn.

Kiểm chứng: tests số liệu/nhóm/NULL/đơn vị/giới hạn, ngày cuối kỳ, RPC PostgreSQL thật qua PGlite, local SQLite và chặn API chưa đăng nhập; build/typecheck; thao tác giao diện và mở lại XLSX. Không thêm dependency.

## Kiểm tra local và tải Excel – 10/10/2026

Với SĐK **590110425723**, kỳ **01/06/2025–01/10/2026**, API local của tra cứu VSS và báo cáo đều trả **34 dòng / 1.607.127 Viên / 6.570.134.000 đồng**. Đã kiểm tra cả số trên giao diện. Chưa tái hiện đúng triệu chứng **2,… tỷ** người dùng từng thấy; không kết luận dữ liệu nguồn sai từ triệu chứng này.

Lỗi giao diện đã tái hiện: nhập ngày bằng ô date rồi tìm kiếm khiến hai ngày mất khỏi state; cả request bảng và metrics gửi ngày trống. Sau sửa xử lý sự kiện date, thao tác đó giữ nguyên hai giá trị ISO trong cả hai request. Chuyển tab giữ bộ lọc và kết quả của các màn tra cứu, bao gồm báo cáo; tải lại toàn bộ trang vẫn khởi tạo lại state.

Báo cáo có ba ô riêng cho hoạt chất, SĐK và tên thuốc, kết hợp các ô đã nhập bằng AND; bỏ hai nút ngày nhanh trùng chức năng, chỉnh bố cục và nền xám nhạt cho dòng con. Truy vấn DAV local chỉ đọc hồ sơ của các SĐK cần bổ sung, tránh flatten toàn bộ kho DAV. Đo SĐK qua HTTP: trước khoảng **26,48 giây**, sau khoảng **1,61 giây**; chạy trực tiếp hàm sau sửa khoảng **0,58–0,63 giây**, tổng lượng/tiền giữ nguyên.

Data Hub có hộp tải tùy chỉnh theo nguồn, ngày, hoạt chất/SĐK/tên/nhóm/tỉnh phù hợp và Excel hoặc CSV. Export VSS local đọc SQLite theo bộ lọc của tra cứu, ghi XLSX nén, giữ SĐK dạng text, số dạng numeric và ngày dạng date; tệp có sheet ghi bộ lọc. Có cache theo nguồn dữ liệu và phiên bản mã xuất. Tải từ tra cứu VSS cũng dùng đường này khi không chọn dòng/bộ lọc cột. Nhánh phân trang đã chuyển tiếp cursor và từ chối dữ liệu bị cắt hoặc lặp trang.

Tệp Lacidipin local có **186 dòng / 11.315.471 Viên / 47.751.173.480 đồng**. Request giao diện nhận tệp lần đầu khoảng **2,12 giây**, gọi lại cache khoảng **0,05 giây**. Đây là phép đo với Lacidipin; chưa đo thời gian xuất toàn bộ kho 744.954 dòng. Local không giới hạn 50.000 dòng; XLSX tách sheet khi vượt giới hạn số dòng của Excel.

Cloud tải tùy chỉnh giới hạn rõ **50.000 dòng**, lỗi nếu vượt thay vì xuất thiếu; tải toàn bộ đi trực tiếp R2. Script snapshot có tùy chọn `--excel` để tạo và phát hành XLSX nén bên cạnh CSV. Chưa chạy phát hành snapshot Excel, áp dụng migration hoặc triển khai production trong lượt này.

Kiểm chứng bổ sung: fixture **5.102 dòng** kiểm tra không cắt 5.000 dòng, tổng số, SĐK có số 0 đầu, chuỗi giống công thức, ngày cuối kỳ có phần giờ và cache; SQL DAV/MSC kiểm tra ngày cuối kỳ và ngày thiếu; render Data Hub, routing local và RPC VSS; typecheck/build đều đạt.

Theo yêu cầu bổ sung, ô ngày của VSS, báo cáo, tải dữ liệu, bộ lọc phân tích và cập nhật MSC hiển thị **dd/mm/yyyy**; giữ lịch native bằng nút lịch, chuyển ngày hợp lệ về ISO trước khi lọc. Chặn ngày không tồn tại và bỏ qua ô không hợp lệ trong tab đang ẩn. SVG xu hướng trong StatCards căn sát phải, co theo vùng chứa. Tests nhập ngày nhuận, ngày sai, xóa ngày, chọn lại cùng ngày trên lịch và đổi giá trị từ bên ngoài đều đạt.

Kiểm tra cuối: **124 tests web** đạt; sau đó thêm một test phân trang strict và chạy lại nhóm tests liên quan, đạt. Build/typecheck đạt. Trên trình duyệt, cạnh phải SVG và cạnh phải vùng chứa trùng nhau; ô nhập hiển thị ngày Việt Nam và VSS vẫn cho 34 dòng, 1.607.127 Viên, 6.570.134.000 đồng. Chuyển CSV snapshot sang Excel đã thử cục bộ với số thập phân canonical và SĐK có số 0 đầu; không upload R2.

Đối chiếu mở rộng xác nhận một lỗi chỉ số local nữa: `dots:false` bỏ qua cả phép đếm CSYT, nên thẻ hiển thị 0 dù các dòng có mã CSKCB. Đã tách phép đếm khỏi tải điểm bản đồ, đếm mã CSKCB phân biệt trong mỗi tỉnh, loại mã trống và chỉ dùng kỳ hiện tại. Với SĐK trên: **34 CSYT**, khớp đọc trực tiếp SQLite và cách cloud tính. Fixture kiểm tra cùng cơ sở có hai dòng vẫn đếm một, cơ sở ngoài kỳ không tính, bật/tắt dots giữ cùng số cơ sở. Tổng tiền và số lượng giữ nguyên.

## Kiểm tra trước khi ship – 10/10/2026

**Production chưa sẵn sàng để ship bản sửa này.** Đã kiểm tra qua trình duyệt production và truy vấn chỉ đọc TiDB; chưa triển khai app, đồng bộ DB hay upload snapshot trong lượt kiểm tra này.

Trình duyệt production tái hiện lỗi mất ngày: nhập SĐK 590110425723 và kỳ 01/06/2025–01/10/2026, hai request search/metrics lại gửi ngày trống. Thẻ trở về mặc định 12 tháng: **26 dòng, 1.295.543 Viên, 5.279.896.400 đồng**. Chưa tái hiện đúng số 2,… tỷ được báo trước đó. Khi lọc 68 dòng production của SĐK theo ngày bắt đầu HĐ, kết quả đúng là **34 dòng, 1.607.127 Viên, 6.570.134.000 đồng**, khớp SQLite local và TiDB. Fingerprint của 68 dòng production trùng bộ TiDB; không thấy lỗi nhân 1.000 ở dữ liệu của SĐK này.

Phát hiện lỗi khác trong bảng tổng hợp toàn thị trường: `agg_vss_monthly` dùng ngày công bố thay ngày bắt đầu HĐ khi ngày HĐ bị thiếu. Trong 12 tháng lịch 11/2025–10/2026, tổng bảng này cao hơn tổng facts theo ngày HĐ **54.026.571.012.036,4 đồng**. Riêng 02/2026, thêm 1.167 dòng thiếu ngày HĐ, tương ứng **44.354.214.062.626,4 đồng**. Đây là sai quy tắc chọn kỳ; các giá trị thành tiền lớn vẫn là dữ liệu nguồn, chưa kết luận chúng đúng hay sai với hợp đồng gốc.

Đã sửa builder local chỉ dùng ngày bắt đầu HĐ và cộng thành tiền ghi nhận, không suy đoán giá × lượng khi thành tiền thiếu. Đã dựng lại 6.770 dòng tổng hợp; đối chiếu đủ 12 tháng với facts local, số dòng khớp từng tháng, sai số cộng số thực tối đa 0,001 đồng. Pipeline TiDB nay tạo lại toàn bộ bảng tổng hợp từ facts trong một transaction thay vì UPSERT file cũ; nếu lỗi sẽ rollback. Cách này loại được các khóa tháng cũ còn sót. Tests kiểm tra thiếu ngày HĐ, thiếu thành tiền, bỏ khóa cũ và rollback đều đạt. **Bảng tổng hợp TiDB production vẫn cần được chạy lại.**

Đối chiếu fingerprint toàn bộ VSS: local **744.954 dòng**, TiDB **744.781 dòng**; **173 dòng local chưa có trên TiDB**, không có dòng chỉ xuất hiện trên TiDB, không có fingerprint local trùng sau chuẩn hóa. Trong số thiếu, 97 dòng có ngày HĐ và 50 dòng thuộc kỳ mẫu. Lacidipin và Lisinopril khớp local/cloud. Losartan khớp nếu dừng 01/10/2026; nếu lấy đến 10/10/2026, local có thêm hai dòng ngày 08/10: **200.000 Viên / 66.600.000 đồng**, SĐK 893110214300. Do đó không nên khẳng định dữ liệu local và production đã đồng bộ.

Kiểm tra chất lượng toàn kho TiDB ghi nhận 94.984 dòng thiếu ngày bắt đầu HĐ, 4 dòng thiếu thành tiền, 2.252 dòng có ngày kết thúc trước ngày bắt đầu và 351 dòng có thành tiền lệch giá × lượng hơn 1%. Không có lượng/giá/tiền âm trong phép kiểm tra này. Riêng 3.035 dòng của ba hoạt chất mẫu trong kỳ: không thiếu thành tiền, không có lệch hơn 1%, nhưng có hai dòng đảo ngày HĐ (Lisinopril SĐK 893110832424 và Losartan SĐK 893110877024). Giữ dữ liệu gốc và lọc theo ngày bắt đầu HĐ đã thống nhất; chưa tự sửa ngày hay thành tiền. Các trường hợp bất thường cần đối chiếu hợp đồng nguồn khi đánh giá độ chính xác thực tế.

Snapshot R2: bốn CSV đều trả HTTP 200 nhưng ngày sửa cuối là 01/10/2026; MSC live đã cập nhật 10/10/2026. Bốn đường XLSX đều trả 404. Production Data Hub còn giao diện CSV cũ và báo VSS chậm cập nhật. Cần phát hành snapshot mới trước khi giới thiệu tải toàn bộ Excel cho sếp.

Thứ tự cập nhật production đã chuẩn bị:

1. Từ nguồn local đã kiểm tra, chạy `python scripts/tidb/sync_to_tidb.py --yes-remote --only vss,rollup,suggest`. Không dùng prune cho VSS. Việc tạo lại rollup chỉ thay bảng dẫn xuất, có transaction/rollback.
2. Phát hành lại CSV và XLSX bằng `python scripts/tidb/publish_r2_snapshots.py --yes-remote --excel`, rồi kiểm tra file tải về và metadata nguồn.
3. Deploy **repo gốc gồm frontend và API**, theo `.vercel/project.json` và `vercel.json`; không deploy riêng thư mục web. Áp dụng migration Supabase ngày HĐ nếu còn dùng RPC dự phòng cũ.
4. Kiểm tra lại trên production: hai request giữ ngày ISO, SĐK trả 34 dòng / 6.570.134.000 đồng, Losartan đến hôm nay khớp nguồn sau sync, tổng từng tháng khớp facts, tải Excel thật và các luồng mobile.

Connector Vercel hiện trả **403 Forbidden** khi đọc project đã liên kết; cần kết nối Vercel có quyền đúng project/team trước bước deploy. Không thêm CLI/dependency để tự vượt hạn chế quyền. Không thay đổi production trong lượt này.

## Kiểm tra giao diện điện thoại – 10/10/2026

Các danh sách VSS/DAV/MSC dùng chung DataTable nay mặc định dạng thẻ trên màn hình ≤640 px, có nút **Thẻ / Bảng**. Báo cáo BHYT, lịch sử SĐK, danh sách gói liên quan và thuốc trong gói cũng có hai chế độ. Chế độ bảng giữ đủ cột và chỉ cuộn ngang trong vùng bảng. Thẻ có nút **Xem chi tiết** riêng; chọn dòng và nút tra DAV không mở nhầm chi tiết. Chuyển chế độ giữ lựa chọn và không truy vấn lại dữ liệu. Máy tính vẫn mở chi tiết bằng nhấp đúp.

Trong phân tích, chạm hoạt chất trên điện thoại mở danh sách liên quan; Enter/Space cũng mở được, máy tính giữ nhấp đúp và menu chuột phải. Chi tiết gói đã chọn nằm trước danh sách gói liên quan trên điện thoại; danh sách thuốc có thể mở/thu gọn bằng details native. Tiêu đề và nút đóng giữ trên đầu hộp khi cuộn. Giữ giới hạn hiển thị thuốc 50 dòng cùng thông báo hiện có; không diễn giải đó là toàn bộ thuốc của gói.

Đã thao tác trên trình duyệt Edge với dữ liệu local thật và đo viewport CSS **320, 390, 430 px**. Hộp VSS, lịch sử SĐK, gói MSC và DAV không tràn ngang; chiều rộng cuộn thân hộp bằng chiều rộng hiển thị ở cả ba cỡ. Hộp tải tùy chỉnh cũng đạt ở 320 px (292/292 px). Sửa thêm grid tối thiểu 280 px và nhãn trạng thái DAV dài gây tràn ở 320 px. Kiểm tra bảng tùy chọn có 34 dòng lịch sử, 50 dòng thuốc/gói liên quan và cuộn ngang trong vùng riêng; thẻ số tiền dùng định dạng Việt Nam. Đã mở gói thật IB2600302039, chuyển chế độ, chạm hoạt chất và đóng hộp sau khi cuộn dài. Đã kiểm tra nhấp đúp VSS trên máy tính vẫn mở đúng dòng.

Tải tùy chỉnh VSS từ giao diện điện thoại với SĐK 590110425723, kỳ 01/06/2025–01/10/2026 tạo XLSX có **34 dòng / 1.607.127 Viên / 6.570.134.000 đồng**. Mở lại workbook xác nhận SĐK dạng string, lượng/tiền dạng số, ngày HĐ trong kỳ và sheet Bo_loc giữ đúng ngày ISO. Trình duyệt còn giữ tệp ở tên `.crdownload`, nên phép chờ hoàn tất download của công cụ bị timeout; đã kiểm tra nội dung ZIP/XLSX tải được và lưu bản đối chiếu tại `outputs/pre-ship-mobile-sdk.xlsx`, chưa xác nhận bước đổi tên cuối của trình duyệt.

Kiểm thử cuối: **128 tests web, 88 tests API, 18 tests Python** đạt; typecheck/build đạt. Tests giao diện bao phủ chọn dòng độc lập, giữ lựa chọn khi đổi chế độ, hiển thị giá đã format, trang 500 dòng có virtualizer, chạm hoạt chất giữ phạm vi bộ lọc và đổi Thẻ/Bảng không refetch. Không thêm dependency. Đây là kiểm tra viewport mô phỏng trên Edge, chưa phải kiểm tra Safari/iPhone hoặc Android thật. Độ khớp số liệu là đối chiếu kho dữ liệu hiện có; chưa xác minh từng dòng với hợp đồng gốc.

Ảnh kiểm chứng và file JSON nằm trong thư mục outputs đã gitignore: `mobile-report-history-430.png`, `mobile-package-detail-430.png`, `mobile-dav-detail-430.png`, `pre-ship-mobile-excel.json`.

## Thu gọn thẻ và kết nối triển khai – 10/10/2026

Giảm padding và khoảng cách giữa trường, tăng phần nhãn lên 110 px để lượng/ngày không xuống dòng thừa, giữ chữ giá trị 12,5 px và nút hành động cao ít nhất 44 px. Thẻ lịch sử mẫu ở viewport 390 px giảm từ 233 px xuống khoảng 172 px (26%); vẫn đủ 34 dòng và tổng lượng 1.607.127 Viên. Các viewport 320/390/430 px không tràn ngang; bảng tùy chọn vẫn đủ 34 dòng, cuộn ngang trong vùng bảng. Chi tiết gói MSC dùng nhãn/giá trị trên cùng hàng để giảm chiều cao. Các quy tắc mobile của analytics được đưa sau quy tắc nền để không bị ghi đè. Build và 128 tests web đạt sau thay đổi CSS. Ảnh mới: `outputs/mobile-history-compact-390.png`.

Plugin Vercel vẫn trả 403 ở scope baoan trong phiên này. Đã kiểm tra CLI chính thức 63.1.2: tài khoản **dannyphan190@gmail.com**, username dannyphan190-5070, team **baoan**, project **baoan-searcher** và ID trùng `.vercel/project.json`. Đây là quyền sẵn có trên máy; không cần thêm luồng Accept. Không đổi package.json/lock hay thêm dependency production. Thêm `/db` vào `.vercelignore` để không upload kho dữ liệu local không dùng cho API deploy.

Đã tạo bản **preview** từ repo gốc, gồm frontend và API: https://baoan-searcher-f6m07jmzr-baoan.vercel.app, deployment dpl_8K62WBZBJ9iC7hPT9zKZuDTzZ2uh, trạng thái READY. Preview có đăng nhập app hiện có; API `/api/tender/meta` trả Unauthorized khi chưa đăng nhập (đúng guard), `/api/health` không phải route cloud. Chưa chuyển domain production, sửa TiDB hay phát hành snapshot trong bước này; đang chờ xác nhận cập nhật production gồm các bước đã liệt kê ở trên.
