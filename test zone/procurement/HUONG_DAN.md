# Lọc thầu thuốc — Mua sắm công

Nhấp đúp **MO_LOC_THAU_THUOC.cmd** ở thư mục ngoài để mở ứng dụng. Máy này đã cài Python, Tcl/Tk và Playwright trong thư mục `vendor`. Khi chuyển sang máy khác, cài Python có Tcl/Tk, Edge hoặc Chrome rồi chạy **CAI_DAT_LOC_THAU.cmd** một lần. Dữ liệu nằm riêng tại `procurement/data/procurement.sqlite3`.

## Cập nhật ngay trong app

1. Bấm **Cập nhật dữ liệu**.
2. Lần đầu chọn **200 trang**, những lần sau chọn **20 trang mới nhất**, hoặc nhập từ 1 đến 200.
3. Bấm **Bắt đầu cập nhật**. App mở Edge/Chrome, ưu tiên trình duyệt mặc định nếu là một trong hai. Đăng nhập trong cửa sổ này; app tự tiếp tục khi nhận được phiên đăng nhập.
4. Mỗi trang tải xong được lưu ngay. Bạn có thể tiếp tục tìm kiếm trong cửa sổ chính trong lúc tải.

Không cần xuất HAR hoặc nhập JSON trong quy trình thường ngày. App sử dụng thao tác tìm kiếm của trang gốc, không lưu mật khẩu/cookie/token vào kho dữ liệu. Phiên trình duyệt dùng lại trong thời gian app mở; mở app lần sau có thể phải đăng nhập lại.

- **Dừng và lưu** giữ các trang đã hoàn tất. Chọn cùng số trang rồi **Tải tiếp lượt dở** để tiếp tục từ trang chưa lưu.
- **Bắt đầu cập nhật** luôn bắt đầu từ trang đầu, phù hợp để lấy dữ liệu mới.
- Nếu gặp xác minh hoặc nguồn chưa phản hồi, xử lý trên trình duyệt rồi bấm **Thử lại** trong app.
- **Kiểm tra lại các gói cũ chưa có kết quả** tìm lại từng mã gói chưa đóng, chưa rõ trạng thái xét hoặc đang xét nằm ngoài cửa sổ mới nhất. Tùy chọn này có thể thêm nhiều yêu cầu và thời gian. Không tìm thấy không có nghĩa gói đã hoàn tất; dữ liệu cũ được giữ nguyên.
- **Cập nhật thêm đơn giá trong 30 ngày gần nhất** chạy sau phần gói thầu. Lịch sử xa hơn nằm trong menu **Dữ liệu → Tải lịch sử đơn giá theo ngày**.
- 200 trang × 50 = tối đa 10.000 kết quả của cửa sổ tìm kiếm nguồn, **không phải toàn bộ lịch sử đấu thầu**. Nguồn có thể thay đổi giữa các trang; cập nhật 20 trang không bảo đảm bắt được mọi sửa đổi của gói đã hoàn tất từ lâu.

Trạng thái lấy từ mã nguồn: đang xét thầu, có/không có nhà thầu trúng, hủy/vô hiệu. Khi chưa có mã trạng thái, app mới đối chiếu ngày đóng. **Đã đóng · chưa có trạng thái xét** không khẳng định gói chưa được xét ngoài thực tế. Cột **Lần kiểm tra** cho biết lần quan sát; dữ liệu nhập HAR dùng thời gian ghi HAR.

## Hai bảng dữ liệu

**Đơn giá từng thuốc:** lọc không dấu theo tên thuốc, hoạt chất, hàm lượng, SĐK/GPNK, bệnh viện, tỉnh/thành, nhà thầu trúng, nhà sản xuất, mã TBMT, nhóm thuốc, đơn vị tính và loại thuốc. Có khoảng đơn giá, số lượng, ngày đăng kết quả; tìm tất cả từ, một trong các từ hoặc cả cụm; loại trừ các cụm phân cách bằng dấu `;`.

**Gói thầu thuốc:** lọc tên gói, mã TBMT, chủ đầu tư, tỉnh, hình thức LCNT, KHLCNT, giá gói và tình trạng theo ngày đóng. Các thông báo gốc được nhập từ dữ liệu trình duyệt. Mã gói chỉ xuất hiện trong bảng đơn giá được ghi rõ **Từ bảng đơn giá — chưa có TBMT**; tên gói, ngày đóng và giá gói được để trống khi chưa có nguồn. Ngày đăng của những dòng này là ngày KQLCNT lấy từ đơn giá, không phải ngày đăng TBMT. Mã bắt đầu DC hoặc các mã khác cũng được giữ nguyên.

Chọn một dòng → **Xem gói thầu / Xem các thuốc** để chuyển bảng và lọc chính xác theo mã TBMT. Nếu không có dòng liên quan, nghĩa là dữ liệu cục bộ chưa có, không phải nguồn không có. Không tự ghép thuốc dựa vào tên gần giống.

Nhấp đúp để xem toàn bộ trường chuẩn hóa và JSON gốc. Nút **Mở trang nguồn** mở thông báo gốc khi có thông báo đã nhập; đối với đơn giá hoặc gói suy ra từ đơn giá, mở trang dữ liệu đơn giá.

## Tải đơn giá

Chọn **Dữ liệu → Tải lịch sử đơn giá theo ngày**, nhập khoảng ngày `YYYY-MM-DD`, rồi **Bắt đầu / tải tiếp**. Công cụ tải ba loại trong tab thuốc của nguồn: Generic, biệt dược gốc và thuốc dược liệu. Chưa thu thập các tab nguyên liệu dược liệu, vị thuốc cổ truyền hoặc dữ liệu hệ thống cũ.

- Mỗi yêu cầu đề nghị 200 dòng và có khoảng nghỉ. Máy chủ có thể trả ít hơn theo kích thước trang thực tế.
- Nếu khoảng ngày chạm 10.000 kết quả, tự chia nhỏ khoảng thời gian và tiếp tục.
- Lưu dữ liệu và tiến độ sau từng trang; mở lại cùng khoảng ngày để tiếp tục.
- **Quét lại khoảng đã hoàn tất** cập nhật bản ghi theo ID. Không tự xóa bản ghi đã lưu nhưng biến mất khỏi nguồn.
- **Tạm dừng lượt đang chạy** nằm trong cửa sổ tải. Đóng ứng dụng cũng dừng tiến trình do ứng dụng khởi chạy; trang chưa lưu sẽ được tải lại lần sau.
- Tab **Phạm vi dữ liệu** hiển thị phạm vi cụ thể. “Đủ theo API” nghĩa là số ID riêng biệt nhận được khớp tổng API cho bộ lọc của lần quét, không khẳng định toàn bộ hệ thống hoặc ảnh chụp nhất quán theo thời gian.
- Nếu nguồn đang thay đổi, trả trang lặp hoặc sai cấu trúc, công cụ dừng và giữ tiến độ thay vì báo hoàn tất sai. Có thể quét lại khoảng đó.
- Bản ghi không có ngày đăng sẽ không nằm trong truy vấn theo ngày. Các dòng thiếu tên, đơn giá hoặc nhà thầu vẫn được lưu nếu xác định được loại thuốc và ID nguồn.

## Nhập dữ liệu dự phòng

API gói thầu dùng bước xác thực của trang; lần kiểm tra gọi trực tiếp không có phiên trả HTTP 400. Công cụ không lấy/gắn cứng token, không tự xử lý CAPTCHA.

Nút cập nhật trong app thay thế quy trình dấu trang cũ. `HUONG_DAN_TRINH_DUYET.html` chỉ giữ lại làm công cụ dự phòng khi cần thu thập thủ công.

Tiện ích chỉ thu dữ liệu các trang đã xem, không đảm bảo vượt giới hạn kết quả của nguồn. Thu hẹp khoảng ngày trên trang nguồn nếu cần. Trước khi đổi trang toàn bộ, tải lại hoặc đóng, cần lưu JSON. Bộ lọc thuốc dựa vào cờ `isMedicine` nếu có; thông báo chỉ nhận diện theo từ khóa tên được đánh dấu “Ứng viên theo tên gói — cần đối chiếu”.

Cũng có thể nhập HAR có nội dung phản hồi hoặc JSON `page.content`, `resultList`, `records`. Công cụ chỉ đọc phản hồi của đúng hai API Mua sắm công từ HAR, không nhập cookie hoặc header vào cơ sở dữ liệu. Nhập lặp không nhân đôi bản ghi cùng ID. Các bản ghi không phải thuốc được bỏ qua.

## Xuất và lưu bộ lọc

**Xuất XLSX / CSV / JSON** lấy toàn bộ kết quả của bộ lọc đã áp dụng, không chỉ 50 dòng trên màn hình. Giá và số lượng là ô số trong Excel, SĐK giữ dạng văn bản. JSON gồm trường chuẩn hóa và bản ghi gốc để nối dữ liệu sau này. Đặt lại bộ lọc để xuất tất cả dữ liệu đã lưu. Lưu bộ lọc bằng tên để dùng lại.

Nhập số không có dấu phân cách hàng nghìn: `12500` hoặc `12500.5`. Giá thiếu không được quy về 0. Đơn giá trúng thầu không phải lợi nhuận; không cộng/so sánh đơn giá khác đơn vị, hoạt chất hoặc hàm lượng như một mặt hàng đồng nhất.

## Phạm vi dữ liệu đã chuẩn bị

Lần khởi tạo ngày 21/09/2026:

- Khoảng yêu cầu đơn giá: 01–21/09/2026; 5.193 dòng Generic, 235 biệt dược gốc, 115 thuốc dược liệu, tổng 5.543 ID riêng biệt.
- HAR đăng nhập mới đã được nhập; số gói thực tế hiển thị ở đầu app. Lượt quét 200 trang chỉ được tính hoàn tất khi app tải xong và báo hoàn tất.
- Có thêm các mã gói tổng hợp từ 5.543 dòng đơn giá, ghi rõ nguồn ở bảng gói thầu.

## Chuẩn bị ghép DAV / VSS

Mỗi bản ghi giữ `source_system=MSC`, `source_id`, `collected_at`, JSON nguồn và `schema_version=1`. Các trường thống nhất gồm `tender_no`, `registration`, `registration_keys`, `name`, `ingredient`, `strength`, `manufacturer`, `unit`, `unit_price`, `quantity`, `buyer`, `winner`.

`registration_keys` chỉ là các mã có hình thức giống SĐK được trích xuất; không phải kết luận đã khớp DAV. Bản gốc luôn được giữ để kiểm tra. Chưa kết nối DAV/VSS hoặc suy đoán mã ánh xạ. Khi tích hợp cần bảng ánh xạ riêng, giữ nguồn và bằng chứng ghép.

## Chạy kỹ thuật (tùy chọn)

Trong thư mục `procurement`:

```
python app.py
python -X utf8 cli.py --download --from-date 2026-09-01 --to-date 2026-09-21
python -X utf8 cli.py --download --from-date 2026-09-01 --to-date 2026-09-21 --refresh
python -X utf8 cli.py --import-file du_lieu.json
python -X utf8 cli.py --export don_gia.xlsx --kind prices
python -X utf8 cli.py --status
python -m unittest test_core.py
node test_collector.cjs
```

API đơn giá đã xác minh: `POST /o/egp-portal-winning-bid-data/services/smart/search_prc`, dữ liệu tại `page.content`.

API gói thầu quan sát từ trình duyệt: `POST /o/egp-portal-contractor-selection-v2/services/smart/search`, dữ liệu tại `page.content`. Phiên xác thực do trang gốc quản lý.

TLS luôn xác minh chứng chỉ; chỉ loại bỏ nhóm mã hóa DHE cũ để tương thích máy chủ. Không hạ mức bảo mật toàn hệ thống hoặc tắt xác minh SSL.

Đóng ứng dụng và lượt tải trước khi sao lưu toàn bộ thư mục `procurement/data`.
