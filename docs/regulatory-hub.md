# Regulatory Hub — Bảo An Pharma

Link: https://app.baoanpharma.com/#regulatory. Dùng tài khoản Bảo An hiện có.

## Kiến trúc và cấu trúc thư mục

Giữ React/Vite hiện hữu để tái sử dụng đăng nhập và DAV/MSC/VSS; API Node trên Vercel. Kho pháp luật dùng Supabase PostgreSQL, độc lập kho thuốc Turso. API truy vấn bằng JWT của người dùng và chịu RLS. Crawler nội bộ dùng service-role key; không đưa khóa này vào frontend.

```text
web/src/
  RegulatoryHub.jsx                         Điều hướng, danh mục và liên kết dữ liệu
  components/regulatory/RegulatoryViews.jsx LegalSearch, RegulatoryAdmin, Editor, Related
  services/regulatoryService.js             Gọi API kèm JWT
  regulatoryData.js                         BE và hồ sơ nguồn ban đầu
  regulatory.css                           Giao diện bảng tin / tra cứu / quản trị
api/regulatory.js                          API GET/POST có xác thực
lib/regulatory/
  domain.js                                Chuẩn hóa, URL, ngày, bằng chứng
  parser.js                                Đọc HTML/RSS, trích thông tin
  crawler.js                               Robots, rate limit, cache, lease, lịch sử
  store.js                                 Tìm kiếm, trạng thái đọc, chỉnh sửa
  seed.js                                  Nguồn, hồ sơ ban đầu và quan hệ văn bản
scripts/crawl_regulatory.mjs                Crawler chạy thật
server/daily.py                            Pháp luật → DAV → MSC → VSS
server/regulatory_proxy.py                 Cầu nối cùng miền cho app nội bộ
supabase/migrations/
  20260928081206_regulatory_news_hub.sql     Schema, RLS, audit, RPC
  20260928082553_regulatory_manual_news.sql  Giữ bài đã duyệt trong bảng tin
web/tests/regulatory*.test.mjs              8 kiểm thử Node
 tests/test_regulatory_daily.py             Kiểm thử Python daily
```

## Schema Supabase

SQL hoàn chỉnh trong hai migration trên, đã áp dụng lên dự án baoan-auth.

| Bảng | Nội dung chính | Quyền |
|---|---|---|
| regulatory_sources | id; URL duy nhất, HTML/RSS, nhãn chính thức, từ khóa, lịch, lease, lần chạy/lỗi, version | Nhân viên xem, admin thêm/sửa |
| regulatory_documents | id; URL duy nhất, số hiệu, tiêu đề, chủ đề, tóm tắt, PDF, các ngày pháp lý, bằng chứng, hash, origin, version | Nhân viên xem, admin thêm/sửa |
| regulatory_reads | PK(user_id, document_id), read_at | Mỗi người chỉ truy cập trạng thái của mình |
| regulatory_relations | PK(document_id, related_id), relation, reason | Nhân viên xem; seed quản lý quan hệ |
| regulatory_runs | nguồn, thời gian, trạng thái, số bài, lỗi | Nhân viên xem, crawler ghi |
| regulatory_audit | actor, entity, before_json, after_json, created_at | Trigger ghi, admin xem |
| regulatory_http_cache | URL, body, ETag, Last-Modified, checked_at | Chỉ crawler |

Trạng thái: unknown / active / expired / replaced / draft / partial. Cơ sở dữ liệu yêu cầu ngày, nguồn và ghi chú đối chiếu khi xác nhận hiệu lực. Crawl mới chỉ đặt unknown hoặc draft. Sửa thủ công chuyển origin=manual; crawler không ghi đè bản này. Admin cập nhật kèm version để chống xung đột; audit ghi người sửa và trước/sau.

## Màn hình và API

- **Bảng tin:** 20 bài/trang, lọc Đấu thầu/BE/BHYT/Khác, chưa đọc; nhãn Mới khi ngày đăng hoặc ngày ban hành nằm trong 30 ngày qua. Không dùng ngày crawl để gán Mới. Tóm tắt trích từ nguồn, tối đa 3 dòng; chi tiết hiển thị đầy đủ.
- **Tra cứu:** số hiệu, từ khóa có/không dấu, BE/BHYT; lọc hiệu lực. Quan hệ liên quan được phân biệt với quan hệ thay thế/bãi bỏ. TT22/2024 gợi ý TT47/2025, TT40/2025 và Luật Đấu thầu.
- **Nguồn tin & quản trị:** lịch chạy/lỗi/số bài, thêm/sửa nguồn và văn bản bằng tài khoản admin@baoanpharma.com. Sửa văn bản từ nút Sửa trên kết quả. Nhập ngày đăng để thêm tin thủ công vào feed. TVPL là nguồn tham khảo.
- **Danh mục:** tái sử dụng 93 dòng hiện có, 1.138 dòng BHYT, 26 hoạt chất BE; tra cứu DAV/MSC/VSS bằng kết nối cũ.

```text
GET /api/regulatory?view=news&q=thuốc&category=BE&unread=1&page=0
GET /api/regulatory?q=22/2024/TT-BYT&status=expired
GET /api/regulatory?related=tt22-2024
GET /api/regulatory?view=sources
POST /api/regulatory { action: "read", id: "...", read: true }
POST /api/regulatory { entity: "document" | "source", data: {...} }
```

Mọi request cần Bearer JWT và thuộc allowlist nhân viên. Khi sửa gửi id+version; khi thêm bỏ id.

## Logic crawl

```text
Đọc các nguồn được bật
Với mỗi nguồn:
  Kiểm tra lịch và lấy lease nguyên tử 15 phút
  Ghi lượt chạy, kiểm tra HTTPS / allowlist / robots.txt
  Dùng cache 6 giờ, ETag / If-Modified-Since khi có
  Cách request ít nhất 2,5 giây, tuân thủ Crawl-delay
  Timeout 18 giây; tối đa 2 MB/trang
  Lọc link dược / từ khóa; tối đa 15 bài/nguồn/lượt
  Trích tiêu đề, số hiệu, tóm tắt, ngày có căn cứ, PDF
  Upsert URL, giữ bản sửa thủ công và trạng thái pháp lý
  Dừng nguồn khi 403 / 429 / robots từ chối
  Ghi đầy đủ/một phần/lỗi rồi thả lease
Xóa cache không dùng trong 14 ngày; giữ văn bản và lịch sử
```

Không vượt CAPTCHA, không hạ TLS, không theo redirect khác miền. Nguồn chuyển hướng cần cập nhật URL trong admin. Crawler chỉ nhận moh.gov.vn, dav.gov.vn, thuvienphapluat.vn (và www). HTML hiện đọc link trên trang được cấu hình; chưa quét toàn bộ lịch sử hoặc OCR PDF. RSS cung cấp danh sách link, nội dung đọc tại trang gốc.

Chạy từ thư mục dự án trên máy nội bộ:

```powershell
npm install
node scripts/crawl_regulatory.mjs --init-only
node scripts/crawl_regulatory.mjs
```

--force bỏ qua khoảng cách lịch để chẩn đoán nhưng vẫn giữ lease, cache, robots và rate limit. Cần SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY trong môi trường/.env nội bộ. Không đặt service-role trong biến VITE_.

server.daily đã thêm pháp luật trước DAV/MSC/VSS. Lỗi tin không chặn các crawl thuốc. Lịch nội bộ chạy khi mở app hoặc đăng nhập Windows nếu bật tự cập nhật; máy phải chạy và có mạng. Đã bổ sung lịch cloud ngày 29/09/2026, xem kết quả kiểm tra ở cuối tài liệu. Khởi động lại server nội bộ để nạp mã mới.

## Dữ liệu thật và giới hạn — 28/09/2026

Kho có 15 bài DAV crawl thật + 9 hồ sơ văn bản, 3 nguồn cấu hình. DAV đã trích ngày ban hành 15 bài; ngày đăng chưa rõ thì để trống.

- MOH: lỗi TLS ERR_SSL_DH_KEY_TOO_SMALL, chưa lấy được tin.
- TVPL: HTTP 403, chưa lấy được tin. Có thể nhập thủ công hoặc cấu hình RSS/API được nguồn cho phép sau khi xác minh.
- TT22/2024 thanh toán trực tiếp đã bị bãi bỏ từ 15/02/2026 theo khoản 42 Điều 1 TT47/2025: https://vbpl.vn/boyte/Pages/vbpq-toanvan.aspx?ItemID=185588. TT40/2025 liên quan về thầu, không gán là văn bản thay thế TT22.
- BE dùng 26 mục tại trang PDF 20, Phụ lục I TT07/2022: https://datafiles.chinhphu.vn/cpp/files/vbpq/2022/09/07-byt.pdf. Tệp Vibonline 2021 là dự thảo, không dùng làm danh mục bắt buộc.
- Danh mục 93 là dữ liệu nội bộ theo TT03/2024, chưa đối chiếu từng dòng với bản ký mới nhất. Văn bản chưa rà soát đủ sửa đổi giữ nhãn Chưa xác minh.

## Kiểm thử và phát hành

8 kiểm thử Node qua: RLS trên PostgreSQL PGlite, staff/admin, cô lập đã đọc, audit, lease, bảo vệ bản thủ công, parser, tìm kiếm và luồng UI. Kiểm thử Python qua: lỗi tin không chặn DAV/MSC/VSS. Build và typecheck qua.

Cache không có policy trình duyệt là chủ ý, chỉ service-role truy cập. Advisor Supabase còn báo cấu hình sẵn có ngoài phạm vi tính năng: [extension trong public](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public) và [bảo vệ mật khẩu rò rỉ tắt](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Bản web triển khai từ staging production trước đó, chỉ bổ sung Regulatory Hub/API/thư viện; không gộp các thay đổi DAV/MSC/VSS khác đang làm dở. Daily/proxy nằm ở bản nội bộ. Chưa kiểm tra end-to-end bằng phiên nhân viên thật nếu trình duyệt kiểm thử chưa đăng nhập.

## Prompt refine tiếp theo

“Nâng Regulatory Hub với hàng đợi chuyên viên duyệt tin: phát hiện đổi nội dung theo hash, hiển thị khác biệt trước/sau, xác nhận hiệu lực kèm căn cứ và lịch sử duyệt. Tìm RSS/API hợp lệ cho MOH/TVPL; giữ lỗi minh bạch nếu không truy cập được. Ưu tiên số hiệu khớp chính xác khi xếp hạng, thêm quản trị quan hệ sửa đổi/thay thế. Giữ RLS, không tự suy luận hiệu lực pháp luật.”

## Bản tin lãnh đạo trên điện thoại — 29/09/2026

Giao diện mới giữ hai lối chính: **Bản tin cần đọc** và **Tra cứu**. Bỏ khối thống kê và cảnh báo dài khỏi đầu trang; menu danh mục thu gọn. Tìm kiếm luôn ở trên, gõ từ bản tin tự chuyển sang tra cứu. Tin trọng tâm có tiêu đề rút gọn, phần ảnh hưởng và việc cần kiểm tra; tên pháp lý đầy đủ nằm trong Căn cứ & văn bản. Tin khác xếp thành các dòng mở rộng. Không tự đánh dấu đã đọc chỉ vì người dùng mở trang.

Đã rà lại: TT22/2024 bị bãi bỏ theo TT47/2025; ngày hiệu lực 15/02/2026 có trên [Cổng Chính phủ](https://chinhphu.vn/?classid=0&docid=216427&pageid=27160), danh sách bãi bỏ có trên [Báo Chính phủ](https://baochinhphu.vn/bai-bo-toan-bo-mot-phan-van-ban-quy-pham-phap-luat-linh-vuc-y-te-102251231101817322.htm). TT40/2025 và BE vẫn không được tự nâng thành trạng thái hiệu lực hiện hành vì chưa rà hết sửa đổi. Hồ sơ danh mục 93 năm 2026 tìm thấy vẫn là dự thảo; không dùng thay văn bản ban hành.

Đã sửa sàng lọc: thu hồi công bố mỹ phẩm và dự toán ngân sách cơ quan không được đưa lên nhóm ưu tiên thầu thuốc. Xử phạt đơn vị dược không đồng nghĩa cấm thầu. Dự thảo chỉ theo dõi, không khuyến nghị áp dụng. Ưu tiên hiện tại trên dữ liệu thật là QĐ800/QĐ-QLD; gia hạn đăng ký nằm dưới. Chưa cá nhân hóa theo danh mục thuốc doanh nghiệp.

### LLM và chi phí

Tích hợp REST Gemini **gemini-3.1-flash-lite** ổn định, JSON schema, không dùng web grounding. [Model](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite), [giá](https://ai.google.dev/gemini-api/docs/pricing). Giá kiểm tra 29/09/2026: text input 0,25 USD/triệu token; output gồm thinking 1,50 USD/triệu token. Chỉ gửi tiêu đề/tóm tắt công khai origin=crawl, không gửi ghi chú nội bộ hay dữ liệu thuốc doanh nghiệp.

- Tối đa một API attempt/ngày theo ngày Việt Nam, kể cả lần lỗi; không retry ngầm.
- Chỉ phân tích bài trong 30 ngày chưa được AI xử lý theo hash hiện tại; tối đa 12 bài/lượt, bài quan trọng trước.
- Request serialized tối đa 24.000 byte; output tối đa 4.096 token, thinking minimal. Không thêm dịch vụ grounding, cache trả phí hoặc model fallback đắt hơn.
- Mỗi attempt dự phòng 0,025 USD trong ledger, tối đa 0,775 USD/31 ngày, có chốt tổng dự phòng 0,90 USD/tháng. Đây là giới hạn của tác vụ này dựa trên giá đã đối chiếu, không kiểm soát các ứng dụng khác dùng cùng tài khoản/key, thuế hoặc thay đổi giá nhà cung cấp.
- Kết quả phải trả đúng id, đủ bài và trích dẫn có thật trong đầu vào; nếu sai, bị cắt, timeout/429 hoặc thiếu khóa: giữ sàng lọc theo quy tắc, có nhãn rõ. Phân tích AI chưa được chuyên viên duyệt; không đổi trường hiệu lực.
- Mỗi đánh giá lưu hash đầu vào, model, phương pháp, thời gian; dữ liệu đổi thì không hiển thị phân tích cũ như hiện hành.

Tệp mới: lib/regulatory/brief.js, lib/regulatory/ai.js, api/regulatory-daily.js. Migration **20260928174406_regulatory_editorial_brief.sql** thêm regulatory_insights và regulatory_ai_runs, RLS chỉ đọc cho nhân viên, ghi bởi service-role. RPC regulatory_ai_reserve dùng khóa giao dịch và khóa chính ngày để chống chạy trùng và bảo vệ ngân sách.

### Lịch cloud và kích hoạt AI

Đã triển khai Vercel Cron, mỗi sáng **06:00–07:00 giờ Việt Nam**; gói Hobby không đảm bảo phút chính xác. [Giới hạn lịch Vercel](https://vercel.com/docs/cron-jobs/usage-and-pricing). Chạy độc lập máy Windows. Lịch source dài hơn 24 giờ do admin đặt vẫn được tôn trọng; với nguồn mặc định, ngày mới không bị bỏ qua vì cron chạy sớm hơn lần trước vài phút. Lease/cache/rate limit vẫn giữ nguyên.

Endpoint /api/regulatory-daily chỉ nhận CRON_SECRET; biến server CRON_SECRET và SUPABASE_SERVICE_ROLE_KEY đã cấu hình dạng Secret trên Production. API chỉ trả trạng thái, không lộ khóa. Lịch cron đã kiểm tra có trong cấu hình project production. Khi nguồn bị chặn, hiện partial và giữ dữ liệu cũ.

**Chưa có Gemini key tại lần kiểm tra cuối.** Người dùng sẽ thêm GEMINI_API_KEY vào Production của baoan-searcher trên Vercel. Sau khi thêm cần redeploy để nhận biến mới, gọi endpoint nội bộ có xác thực một lần và kiểm tra regulatory_ai_runs / regulatory_insights. Không gửi key trong chat, không dùng tiền tố VITE_. Có thể dùng khóa riêng cho bản tin để theo dõi ngân sách dễ hơn. Chưa có lượt LLM thật nào được tính là đã kiểm thử.

11 kiểm thử Node đã qua, gồm chống ưu tiên nhầm mỹ phẩm, dự thảo, quote giả, id giả, secret cron thiếu/sai, ngân sách reserve một lần/ngày và quyền RLS. Typecheck/build đã qua. Giao diện kiểm tra bằng snapshot dữ liệu công khai ở 390px; phiên production vẫn yêu cầu đăng nhập thật, không thay đổi cổng xác thực.

### Kiểm tra cloud thực tế — 29/09/2026

Production: dpl_BUXSsQ2Y3DPM5QAfNuqSMLAp34ot, https://app.baoanpharma.com/#regulatory. Riêng chức năng regulatory-daily chạy tại Singapore (sin1), đã xác nhận từ header lần gọi thật; không đổi khu vực các API khác.

Gọi endpoint có CRON_SECRET trả HTTP 200 với partial=true: DAV và MOH bị UND_ERR_CONNECT_TIMEOUT, TVPL trả 403 ở robots.txt. Kết quả tương tự cả máy chủ Mỹ và Singapore. Vì vậy **chưa xác nhận được luồng tự lấy tin hằng ngày hoàn chỉnh trên cloud**. DAV vẫn truy cập được từ máy nội bộ; dữ liệu đang hiển thị là 15 bài đã crawl trước đó và các hồ sơ đã lưu. Giữ lỗi nguồn và thời gian thành công cũ trên UI, không coi một lượt cron hoàn tất là dữ liệu mới. Không vượt chặn nguồn hay giảm kiểm tra TLS. Cần nguồn RSS/API được phép hoặc đường kết nối phù hợp để hoàn tất vận hành cloud; crawler nội bộ hiện có vẫn dùng được khi máy chạy.

Lần gọi trên trả AI state=unconfigured; chưa phát sinh lượt AI thật. Chỉ người vận hành có CRON_SECRET mới gọi được ?refresh=1 để kiểm tra lại nguồn trước lịch; tham số này không bỏ lease, robots, cache, rate limit hay giới hạn AI một lần/ngày. Không có nút gọi công khai. Sau thay đổi cấu hình vùng, build production và ba kiểm thử AI/cron đều qua.

### Đã kích hoạt Gemini và mở rộng nguồn — lượt tiếp theo 29/09/2026

GEMINI_API_KEY đã cấu hình dạng Secret trên Vercel Production và biến server nội bộ được gitignore. Google chấp nhận khóa, model có sẵn. Đã chạy một lượt thật thành công: 11 bài, 3.305 input token và 2.103 output token, chi phí ước tính 0,00398075 USD theo giá đã đối chiếu (không phải hóa đơn). Ledger giữ dự phòng 0,025 USD. Không gửi khóa vào client, tài liệu hoặc bản phát hành.

Phạm vi tin được tự tìm từ chuyên mục, không khóa vào các văn bản ví dụ của người dùng. Bổ sung hai nguồn Báo Chính phủ: [Y tế](https://baochinhphu.vn/xa-hoi/y-te.htm) và [Chính sách mới](https://baochinhphu.vn/chinh-sach-va-cuoc-song/chinh-sach-moi.htm). Đã đọc robots.txt cho phép, giới hạn tên miền HTTPS tại ứng dụng và database. Migration 20260928181307_regulatory_official_news_sources.sql mở rộng đúng miền này. Lấy được 3 bài riêng biệt (một bài xuất hiện ở cả hai chuyên mục). DAV lấy lại 15 bài từ máy nội bộ. Trích thêm đoạn nội dung tối đa 1.200 ký tự; sửa đọc ngày ISO có giờ. Bài đề xuất kê đơn 90 ngày có nhãn draft dựa trên tiêu đề/đoạn dẫn, không gán ngày hiệu lực.

Đã xóa riêng cache HTTP của Báo Chính phủ và gọi lại cron production: hai chuyên mục đều lấy thành công từ cloud (3 và 1 lượt bài, có trùng URL). DAV/MOH vẫn timeout từ cloud; TVPL 403. Lịch sáng nay có nguồn cloud hoạt động thật nhưng chưa phủ đầy đủ DAV/MOH. Nguồn lỗi không được báo là cập nhật thành công. Crawler local vẫn được tích hợp trong daily.

Kiểm tra diễn giải AI thật phát hiện 7/11 đánh giá không đạt mức thận trọng cần thiết, gồm suy từ cấp đăng ký sang đủ điều kiện thầu và từ xử phạt sang điểm năng lực. Đã thay các đánh giá đó bằng ruleInsight có điều kiện. guardedInsight được áp dụng cả lúc lưu lẫn khi đọc bản tin; trích dẫn thật không được coi là đủ để chứng minh suy luận đúng. Những bài đã được AI đánh giá nhưng bị chặn lưu method=rules và model hiện hành để không phân tích lặp hằng ngày. Đây là bộ lọc bảo thủ, không phải chứng nhận pháp lý hay bảo đảm bắt mọi sai sót.

AI chỉ phân tích tin crawl trong 30 ngày từ tên miền nguồn chính thức, gồm ngày đăng hoặc ngày ban hành, loại ngày tương lai. Dự thảo/đề xuất bị giới hạn ưu tiên. Không ép phải có tin nổi bật nếu không bài nào đạt ngưỡng. Nội dung AI vẫn ghi rõ cần chuyên viên đối chiếu; xác thực bài nguồn và xác nhận hiệu lực văn bản là hai việc riêng.

13 kiểm thử đã qua; typecheck và build production qua. Các cảnh báo Supabase không thay đổi so với mục kiểm thử phía trên.
