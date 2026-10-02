const help = {
  sdk_1_2: 'Hoạt chất có 1–2 số đăng ký trong danh mục; mức độ cạnh tranh thấp.',
  sdk_3_5: 'Hoạt chất có 3–5 số đăng ký trong danh mục.',
  sdk_red: 'Hoạt chất có hơn 5 số đăng ký; nhiều sản phẩm cùng hoạt chất.',
  tag_xanh: 'Hồ sơ được phân loại sẵn sàng theo dữ liệu đăng ký hiện có.',
  tag_vang: 'Hồ sơ cần xác minh thêm hiệu lực hoặc thông tin đăng ký.',
  tag_cam: 'Hồ sơ thuộc diện cảnh báo DM93, cần đối chiếu trước khi sử dụng.',
  tag_xam: 'Hồ sơ được đánh dấu hết hạn hoặc ngừng hiệu lực.',
  form_1: 'Hoạt chất chỉ có một dạng bào chế trong danh mục.',
  form_2: 'Hoạt chất có hai dạng bào chế khác nhau.',
  form_3: 'Hoạt chất có ba dạng bào chế khác nhau.',
  form_4: 'Hoạt chất có từ bốn dạng bào chế trở lên.',
  new_3m: 'Số đăng ký được cấp trong 3 tháng gần nhất.',
  new_6m: 'Số đăng ký được cấp trong 6 tháng gần nhất.',
  new_12m: 'Số đăng ký được cấp trong 12 tháng gần nhất.',
  expire_6m: 'Số đăng ký dự kiến hết hiệu lực trong 6 tháng tới.',
  match_exact: 'Gói đang mở có thuốc trùng hoạt chất, dạng bào chế và hàm lượng với danh mục Bảo An.',
  match_near: 'Gói đang mở có thuốc cùng hoạt chất nhưng khác dạng bào chế hoặc hàm lượng.',
  open_all: 'Gói đang mời thầu và chưa qua thời điểm đóng thầu.',
  new_72h: 'Gói đang mở được đăng trong 72 giờ gần nhất.',
  closing_7d: 'Gói đang mở sẽ đóng thầu trong 7 ngày tới.',
  reviewing: 'Gói đã đóng thầu, đang xét hoặc chưa có kết quả.',
}
export function metricHelp(item) {
  return item.title || help[item.id] || `${item.label}: ${item.count ?? '—'} trong phạm vi dữ liệu của thẻ.`
}
