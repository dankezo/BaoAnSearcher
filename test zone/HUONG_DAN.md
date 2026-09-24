# Công cụ tra cứu thuốc DAV

Mở **MO_CONG_CU.cmd** để sử dụng. Máy này đã có Python; ứng dụng không cần cài thư viện ngoài.

- **Tải toàn bộ / Tải tiếp**: tải từ API công khai, mỗi lần đề nghị 200 bản ghi, nghỉ 0,5 giây giữa các lần. Không giới hạn số trang. Nếu máy chủ chỉ trả 20 dòng, vẫn tải tuần tự đầy đủ.
- **Tạm dừng**: dừng sau yêu cầu đang xử lý. Đóng rồi mở lại ứng dụng vẫn tiếp tục được. Cần giữ máy hoạt động và có mạng khi tải.
- **Cập nhật từ đầu**: quét lại từ vị trí 0 và cập nhật theo ID. Giữ các bản ghi cũ để không mất dữ liệu; không tự xóa bản ghi biến mất khỏi nguồn.
- Tìm kiếm không phân biệt hoa/thường hoặc dấu tiếng Việt. Các từ và các ô tìm kiếm được kết hợp bằng AND. Nhấn Enter hoặc Tìm kiếm để áp dụng.
- Nhấp đúp một dòng để xem thông tin đầy đủ và JSON gốc.
- **Xuất XLSX / CSV / JSON**: xuất toàn bộ kết quả của bộ lọc đã áp dụng, không giới hạn 100 dòng trên màn hình. Xóa bộ lọc để xuất tất cả. JSON giữ đầy đủ cấu trúc nguồn; Excel/CSV chứa những trường chính.
- Có thể mở **TAI_TOAN_BO.cmd** để chỉ tải. Chỉ một tiến trình tải được chạy cùng lúc.

## Dữ liệu và phục hồi

Cơ sở dữ liệu nằm tại `data/thuoc.sqlite3`, lưu giao dịch sau mỗi trang. Có thể sao lưu toàn bộ thư mục `data` sau khi đóng ứng dụng và tiến trình tải. Không xóa thư mục này nếu muốn giữ dữ liệu và tiến độ.

Lỗi mạng được thử lại tối đa 6 lần với thời gian chờ tăng dần. Khi lỗi kéo dài, tiến độ vẫn được giữ; bấm Tải tiếp sau. Không lưu cookie hoặc token từ HAR; phiên mạng được tạo mới khi tải. Không chia sẻ file HAR gốc vì nó có thể chứa thông tin phiên duyệt web.

HAR cung cấp chỉ một số trang đã truy cập, không phải toàn bộ danh mục. Bản ghi nhập từ HAR không được tính là đã hoàn tất quét trực tuyến.

API nguồn: https://dichvucong.dav.gov.vn/api/services/app/soDangKy/GetAllPublicServerPaging

Ứng dụng giữ `sorting: null` như HAR. Nguồn có thể thay đổi trong lúc tải; phân trang offset không bảo đảm ảnh chụp nhất quán. ID trùng sẽ cập nhật thay vì nhân đôi. So sánh số bản ghi riêng biệt và tổng nguồn, và quét lại từ đầu nếu cần. Tổng lưu có thể cao hơn tổng nguồn do giữ bản ghi lịch sử. Công cụ không khẳng định bản ghi cũ vẫn đang được công bố.

Đây là dữ liệu cấp số đăng ký gốc; theo thông báo trên trang nguồn, chưa bao gồm đầy đủ đính chính, thay đổi, bổ sung, thu hồi trong quá trình lưu hành. Không suy ra tình trạng hiệu lực hiện tại chỉ từ danh mục này.

## Chạy bằng dòng lệnh (tùy chọn)

```
python drug_tool.py
python -X utf8 drug_tool.py --download
python -X utf8 drug_tool.py --download --restart
python -X utf8 drug_tool.py --export danh_muc.xlsx
python -X utf8 drug_tool.py --import-har dichvucong.dav.gov.vn.har
```

Máy khác cần Python 3.10 trở lên với Tcl/Tk (có trong bộ cài Python Windows thông thường). Không cần pandas, máy chủ web hay tài khoản DAV.
