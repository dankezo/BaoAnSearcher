import { fmtDate } from '../../api'
import type { DavColumn, DrugItem, DavFilters } from '../../types/dav'

export const ALL_COLS: DavColumn[] = [
  { key: 'tagId', label: 'Trạng thái', filter: 'select', nowrap: true, width: 52, align: 'center' },
  { key: 'soDangKy', label: 'Số đăng ký', mono: true, nowrap: true },
  { key: 'ngayCap', label: 'Ngày cấp', text: (r) => fmtDate(r.ngayCap), nowrap: true },
  { key: 'tenThuoc', label: 'Tên thuốc', width: 180, truncateAt: 80 },
  { key: 'hoatChat', label: 'Hoạt chất', width: 220 },
  { key: 'drugGroup', label: 'Phân loại thuốc', width: 160, truncateAt: 64 },
  { key: 'hamLuong', label: 'Hàm lượng', width: 120, truncateAt: 72 },
  { key: 'dangBaoChe', label: 'Dạng bào chế', truncateAt: 64 },
  { key: 'dongGoi', label: 'Quy cách đóng gói', truncateAt: 72 },
  { key: 'ngayHetHan', label: 'Ngày hết hạn', text: (r) => fmtDate(r.ngayHetHan), nowrap: true },
  { key: 'ctyDangKy', label: 'Công ty đăng ký', width: 180, truncateAt: 80 },
  { key: 'ctySanXuat', label: 'Công ty sản xuất', width: 200, truncateAt: 80 },
  { key: 'nuocSanXuat', label: 'Nước SX', filter: 'select' },
]

export const SERVER_MAP: Partial<Record<keyof DrugItem, keyof DavFilters>> = {
  tenThuoc: 'tenThuoc',
  soDangKy: 'soDangKy',
  hoatChat: 'hoatChat',
  drugGroup: 'drugGroup',
  dangBaoChe: 'dangBaoChe',
  ctySanXuat: 'sanXuat',
  ctyDangKy: 'dangKy',
  nuocSanXuat: 'nuocSanXuat',
}

export const EMPTY_FILTERS: DavFilters = {
  q: '',
  tenThuoc: '',
  soDangKy: '',
  hoatChat: '',
  drugGroup: [],
  dangBaoChe: '',
  sanXuat: '',
  dangKy: '',
  nuocSanXuat: [],
  ingredientCount: '',
  ingredientCountOther: '',
  dosageFormCount: '',
  dosageFormCountOther: '',
  strengthCount: '',
  strengthCountOther: '',
  hangBenhVien: [],
  tags: null,
}
