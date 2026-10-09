# Cập nhật MSC local theo mốc hoàn tất

- Gói thầu: lấy trang mới nhất, 50 dòng/trang; dừng khi qua ngày lần chạy
  thành công trừ 2 ngày. Lần đầu dùng cửa sổ 3 ngày. Giới hạn 200 trang chỉ
  là chốt an toàn; chạm chốt khi chưa tới mốc thì báo chưa hoàn tất.
- Xác minh số trang, bộ lọc thuốc, thứ tự ngày và trang lặp trước khi ghi
  mốc. Khi lỗi/dừng, giữ dữ liệu đã lấy và không tiến mốc thành công.
- Các gói đang mở, chờ kết quả và đang xét nằm ngoài các trang vừa lấy
  được tìm lại theo mã. Gói đã kiểm tra thành công hôm nay được bỏ qua ở
  lượt kiểm tra theo mã; trang gần đây vẫn đọc lại để bắt sửa đổi mới.
  Không tìm thấy mã cũ không có nghĩa là đã trúng/hủy.
- Chỉ ghi lại bản ghi khi JSON nguồn đổi. Giữ thời điểm thay đổi thực tế
  của cache; không thay timestamp chỉ vì crawler đọc lại một dòng giống hệt.
- Hồ sơ thuốc của gói đang mở: tải khi chưa có cache, thông báo đã đổi,
  hoặc cache quá 24 giờ. Nút quét lại riêng vẫn có thể ép tải.
- Đơn giá: mỗi nhóm có mốc riêng từ khoảng ngày đã tải đủ. Quét chồng
  3 ngày và lấy đủ tất cả trang trong cửa sổ đó, không giới hạn 20 trang.
  Nhóm tải lỗi không dùng mốc của nhóm thành công. Khi chưa có mốc, dùng
  khoảng ngày đã chọn (auto mặc định 20 ngày).
- Auto local ưu tiên gói thầu/hồ sơ, rồi đơn giá. Các nút Export quét đủ
  khoảng chọn và toàn bộ lịch sử vẫn hoạt động riêng.

Đây là cập nhật cửa sổ gần đây và trạng thái gói đang hoạt động. Nguồn chưa
có change-feed được kiểm chứng: nếu sửa đơn giá/gói đã kết thúc rất lâu mà
không đổi ngày công bố, cần quét lại lịch sử để phát hiện. Không tuyên bố
cửa sổ 3 ngày bắt được mọi sửa đổi của toàn bộ kho.

Kiểm chứng: 6 tests riêng bao gồm dừng sớm, sửa gói đã có, không ghi dòng
không đổi, kiểm tra lại trong ngày, thiếu gói không tiến mốc, lỗi/thứ tự
nguồn, mốc riêng từng nhóm và cache hồ sơ mới/đến hạn.
