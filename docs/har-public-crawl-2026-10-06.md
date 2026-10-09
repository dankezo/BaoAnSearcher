# Phân tích HAR VSS và MSC gói thầu — 06/10/2026

## Kết luận

VSS có export công khai đầy đủ, không cần đăng nhập. Crawler hiện dùng đúng
endpoint và parser đọc được dữ liệu thực tế. Lỗi cloud được tái hiện ở tầng kết
nối, trước khi nhận HTTP response; không phải lỗi phân trang hay thiếu cookie.
Chưa xác định được chính sách chặn IP/vùng địa lý của nguồn.

MSC có API công khai cho chi tiết gói và biểu mẫu. Tìm kiếm danh sách lại dùng
reCAPTCHA v3 của chính website. Không thể đem token trong HAR dùng lâu dài.
Hai việc này cần được kiểm chứng riêng; đọc được chi tiết chưa đồng nghĩa với
crawl được toàn bộ danh sách mỗi ngày.

Không đổi lịch production: MSC đơn giá vẫn chạy hằng ngày; VSS và gói thầu
chưa được đánh dấu là đã hoạt động trên cloud.

## VSS

`vss_1.har`: trang đầu chuyển từ `quanlythuoc.vss.gov.vn` sang
`quanlythuocv1.vss.gov.vn`. `vss_2.har`: ba trang HTML chi tiết và một export.
Các request nghiệp vụ không có `Cookie` hay `Authorization`.

```http
GET https://quanlythuocv1.vss.gov.vn/kqdt/chiTiet?ngaycongbo=02%2F10%2F2026&loai=1&page=1
GET https://quanlythuocv1.vss.gov.vn/kqdt/export?ngaycongbo=02%2F10%2F2026&loai=1
```

- HTML: 10 thuốc/trang; export SpreadsheetML XML: 219 thuốc, 219 fingerprint
  khác nhau; parser hiện tại không loại dòng nào do lỗi cột.
- Replay local không cookie/token: HTTP 200, 464.904 bytes, 219 dòng.
- Tập 219 fingerprint của replay trùng hoàn toàn với HAR; chạy thử bước ánh
  xạ của `crawl_vss` cũng tạo đủ 219 dòng TiDB, không ghi cơ sở dữ liệu.
- Có hoặc không có `page=2` đều trả 219 dòng. Export lấy cả ngày, không chỉ
  trang đang mở. Không cần browser hay tải từng trang HTML.
- Ngày 04, 05, 06/10 trả Workbook hợp lệ rỗng (423 bytes); số 0 ở các ngày này
  không phải bằng chứng request lỗi.
- Luồng tự động phù hợp: export theo ngày công bố, parse bằng
  `server/vss.py`, upsert bằng fingerprint; chạy bù ngày sau gián đoạn.

### Đối chiếu đường kết nối cloud

| Môi trường | Kết quả |
| --- | --- |
| Máy local | Export ngày 02/10 nhận đủ 219 dòng |
| GitHub Linux — requests, urllib, curl; HTTPS và HTTP | Connection reset; không có dữ liệu |
| GitHub Windows — phép thử DNS | Không resolve được hostname trong lượt thử |
| Supabase Edge — Singapore | Connection reset tại bước Connect |
| Supabase Edge — Tokyo | Connection reset tại bước Connect |

Log thật:
[lượt crawler VSS](https://github.com/dankezo/BaoAnSearcher/actions/runs/37407881678),
[probe Linux](https://github.com/dankezo/BaoAnSearcher/actions/runs/37408014566),
[probe Windows](https://github.com/dankezo/BaoAnSearcher/actions/runs/37408074816).
Lượt probe chỉ đo mạng, không ghi TiDB; trạng thái job probe thành công không
có nghĩa là crawl thành công.

Supabase probe đã thay bằng handler HTTP 410, không còn gọi nguồn.
Nhánh GitHub chẩn đoán đã xóa. Không có token HAR, proxy hoặc thư viện mới
được đưa vào production.

## MSC gói thầu

### Danh sách và đổi trang (`msc_goithau_1.har`)

```http
POST /o/egp-portal-contractor-selection-v2/services/smart/search?token=<reCAPTCHA-v3>
Content-Type: application/json
```

```json
[{"pageSize":10,"pageNumber":0,"query":[{
  "index":"es-contractor-selection",
  "matchType":"all-1",
  "matchFields":["notifyNo","bidName"],
  "filters":[
    {"fieldName":"type","searchType":"in","fieldValues":["es-notify-contractor"]},
    {"fieldName":"isMedicine","searchType":"in","fieldValues":[1]},
    {"fieldName":"caseKHKQ","searchType":"not_in","fieldValues":["1"]}
  ]
}]}]
```

Đổi trang tăng `pageNumber`. Tab chưa đóng thầu thêm range `bidCloseDate`.
Response có `page.content`, `totalPages`, `currentPage`, `totalElements`.
Lượt không lọc ngày chạm cửa sổ 10.000 kết quả; muốn quét lịch sử phải chia
khoảng thời gian, không chỉ tăng số trang vô hạn.

HTML tìm kiếm trong HAR vẫn là Vue (`#search-home`, `axiosSearch`). Chính
website gọi `grecaptcha.execute(..., {action:'submit'})` trước mỗi tìm kiếm.
Replay không token trả HTTP 400. Chưa có bằng chứng endpoint danh sách chạy
độc lập không reCAPTCHA, cũng chưa có bằng chứng phải đăng nhập.
Theo [tài liệu Google](https://developers.google.com/recaptcha/docs/v3), token
có thời hạn ngắn và cần tạo ở thời điểm thực hiện hành động.

### Chi tiết và biểu mẫu (`msc_goithau_2.har`)

Trang E-HSMT trong ảnh là Angular; khác với trang tìm kiếm Vue. Các API sau
không có cookie/token/Authorization trong HAR:

```http
POST /api/unau/portal/ebidorg/bid-no-contractor/get-detail
{"body":{"id":"74f2085c-b318-4aae-9b8e-007e57109bba"}}

POST /api/unau/portal/ebidinv/bido-inv-biddings-sign
{"body":{"notifyId":"74f2085c-b318-4aae-9b8e-007e57109bba","bidField":"HH"}}
```

- Chi tiết trả `body.bidNotification`, có 17 dòng `lotDTOList` của phạm vi
  cung cấp. Replay local nhận lại 17 dòng. Crawler phạm vi hiện đã dùng API này.
- Biểu mẫu trả 9 phần, mỗi phần có `formCode`, `chapterCode`, `formValue`.
  `formValue` là chuỗi JSON chứa bảng/tiêu chí/tham chiếu file. Replay local
  không đăng nhập cũng nhận 9 phần.
- Các lần gọi MSC tiếp theo trong phiên thử có cả reset/timeout TLS ngay
  trên local. Thành công ban đầu chứng minh API công khai; chưa chứng minh
  đường kết nối đủ ổn định để vận hành crawler hằng ngày.
- Có thêm API `bid-pack-info/get-detail` trả thông tin và 17 lô; request lấy
  cấu hình chương/biểu mẫu dùng `bida-inv-chapter-confs`.
- HAR thứ hai không có response Excel/PDF tải xuống riêng. Bundle frontend
  có hàm tạo Excel phía browser; các bảng có thể lấy trực tiếp từ JSON.
  File đính kèm là trường hợp riêng, chưa được chứng minh tải toàn bộ không
  đăng nhập từ các HAR này.

## Bước triển khai khả thi

VSS: giữ crawler export hiện tại, chọn môi trường có đường kết nối nguồn
hoạt động. Một máy chủ ở Việt Nam là hướng thử hợp lý vì local đang thành
công, nhưng cần thử URL công khai trước khi đăng ký/trả phí. Không thể cam
kết mọi VPS Việt Nam đều được nguồn chấp nhận. Thêm Turso làm kho dữ liệu
không giải quyết lỗi kết nối này.

MSC: dùng API chi tiết/biểu mẫu khi đã có notifyId; tìm kiếm danh sách phải
đi qua luồng bình thường của website với reCAPTCHA do website phát hành.
Không lưu token HAR, không giả token hay bỏ kiểm tra reCAPTCHA.

Không cần bật máy local nếu tìm được runner có kết nối được chấp nhận.
Với các môi trường vừa kiểm chứng, chưa thể bật hai nguồn này chạy cloud
hằng ngày rồi coi là hoàn tất.

## Thử mở rộng: AI cloud và Cloudflare

Tiếp tục theo yêu cầu dùng các đường miễn phí:

- [GitHub macOS/ARM/Windows](https://github.com/dankezo/BaoAnSearcher/actions/runs/37408883118):
  MSC chi tiết đều HTTP 200, 17 lô. VSS vẫn reset/timeout; cố định DNS và
  giới hạn TLS 1.2 không khắc phục. Windows DNS mặc định còn không resolve được.
- [Trình duyệt GitHub](https://github.com/dankezo/BaoAnSearcher/actions/runs/37409037874):
  trang MSC HTTP 200 nhưng title là `Error`; không có component tìm kiếm.
  Probe này chỉ đọc dữ liệu, không dùng login, token nguồn hay khóa TiDB.
- Cursor có [Automations và Computer Use trên cloud](https://cursor.com/docs/cloud-agent/automations).
  Thử thực tế trong tài khoản Pro bị chặn trước khi chạy vì hết Cloud Agent
  usage đi kèm gói; UI yêu cầu bật on-demand có tính phí. Đã Cancel theo
  lựa chọn của người dùng; không bật chi tiêu hay lịch Cursor.
- Cloudflare account đang ở Workers Free. [Browser Run Free](https://developers.cloudflare.com/browser-run/pricing/)
  có 10 phút/ngày. Playground HTML lấy được trang tìm kiếm MSC thật; chưa
  kiểm chứng được tìm kiếm/đổi trang tự động. VSS báo `Network connection closed`.
- Workers Playground chạy native `fetch` (không deployment, không credential):
  VSS HTTP 525, 16 ký tự, không có Workbook; MSC HTTP 200, 17 lô.
  525 không phải dữ liệu hợp lệ và không được coi là crawl thành công.
- Live View đã được thử và đóng; chưa có bằng chứng luồng tìm kiếm thành công.

## Kết quả triển khai sau phép thử

Cloudflare Quick Actions đã thực hiện được tìm kiếm/đổi trang MSC qua
handler Vue bình thường của website. CDP từng trả trang Error; đường chạy
production dùng Browser binding native trong Worker, không dùng token
Cloudflare 7 ngày hay Workers AI.

Worker `baoan-public-crawl` nằm trong account Dannyphan190@gmail.com.
Endpoint runner: https://baoan-public-crawl.dannyphan190.workers.dev.
Tên miền crawl.baoanpharma.com cũng đã tạo; runner GitHub bị HTTP 403 trên
tên miền này nên dùng workers.dev, không giảm bảo vệ WAF của website.
Mọi endpoint crawl yêu cầu invocation key trong GitHub Secrets; chỉ health
là công khai. Worker không có khóa TiDB, không nhận URL/code tùy ý.

[Chạy GitHub bằng native Worker thành công](https://github.com/dankezo/BaoAnSearcher/actions/runs/37413131657):
2 trang, 100 gói thuốc upsert TiDB; hồ sơ đã cache được dùng lại.
[Lượt đầy đủ trước đó](https://github.com/dankezo/BaoAnSearcher/actions/runs/37411414967)
đã lấy 100 gói và 66 webform, không lỗi/không hoãn hồ sơ.

Budget Durable Object SQLite nhất quán trên toàn Worker: tối đa 480.000 ms
trong 24 giờ trượt; mỗi trang mới đặt trước 90.000 ms, tối đa 5 trang nếu
không có header đo thời gian thực. Cache mỗi trang 30 phút; hit cache không
mở browser. 429 khi hết budget, không tự nâng gói. Browser Run Free có
10 phút/ngày theo https://developers.cloudflare.com/browser-run/pricing/.
Đây là giới hạn riêng của crawler; tác vụ Browser Run khác trong cùng account
vẫn có thể tiêu thụ phần quota chung. Không chạy model AI, không tốn AI tokens.

Workflow daily-crawl chạy MSC gói thầu và đơn giá lúc 05:17 giờ Việt Nam.
VSS chưa đưa vào lịch: Google Apps Script trên tài khoản chính báo Address
unavailable với cả HTTP/HTTPS; Cloudflare native fetch HTTP 525. Các runner
GitHub/Supabase đã thử cũng chưa có đường kết nối hoạt động. Local VSS vẫn
có thể tải export công khai; thêm skill CAPTCHA không sửa lỗi mạng này.

Đã kiểm tra 18 tests Python cloud/local/daily và 2 tests budget Worker;
frontend build thành công. Hai tests đối chiếu vitamin trong suite scope
đang lỗi cả trên bản HEAD trước thay đổi (near thay vì exact), nằm ngoài
thay đổi crawler này. Xem local-incremental-crawl.md cho logic mới trên local.

Không cần record HTML thêm: HAR đã có payload phân trang và JSON webform.
Chưa chứng minh mọi file đính kèm/Excel riêng đều tải được không đăng nhập.
