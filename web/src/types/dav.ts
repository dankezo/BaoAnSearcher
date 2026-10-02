import type { ReactNode } from 'react'

export interface DavSectionProps {
  localMode: boolean
  embedded?: boolean
  filtersInModal?: boolean
}
export interface DrugItem {
  id?: string | number | null
  soDangKy?: string | null
  soDangKyCu?: string | null
  tenThuoc?: string | null
  ngayCap?: string | null
  ngayGiaHan?: string | null
  ngayHetHan?: string | null
  hoatChat?: string | null
  drugGroup?: string | null
  hamLuong?: string | null
  dangBaoChe?: string | null
  dongGoi?: string | null
  hanDung?: string | null
  ctySanXuat?: string | null
  ctyDangKy?: string | null
  nuocSanXuat?: string | null
  nuocDangKy?: string | null
  soQuyetDinh?: string | null
  tieuChuan?: string | null
  kyCapNam?: string | number | null
  conHieuLuc?: boolean
  ingredientCount?: number | null
  tagId?: string | null
}
export interface DavFilters {
  q: string
  tenThuoc: string
  soDangKy: string
  hoatChat: string
  drugGroup: string[]
  dangBaoChe: string
  sanXuat: string
  dangKy: string
  nuocSanXuat: string[]
  ingredientCount: string
  ingredientCountOther: string
  dosageFormCount: string
  dosageFormCountOther: string
  strengthCount: string
  strengthCountOther: string
  hangBenhVien: string[]
  tags: string[] | null
}
export interface PaginationState {
  page: number
  size: number
  total: number | null
  hasMore?: boolean
  nextCursor?: Record<string, string> | null
}
export interface DavSearchResult extends PaginationState {
  items: DrugItem[]
}
export interface DavSearchRequest {
  filters?: Partial<DavFilters>
  page?: number
  size?: number
  cursor?: Record<string, string> | null
}
export type ColumnFilters = Record<string, string>
export interface DavColumn {
  key: keyof DrugItem
  label: string
  filter?: 'select' | 'text' | false
  nowrap?: boolean
  mono?: boolean
  width?: number
  align?: 'center' | 'right'
  truncateAt?: number
  text?: (row: DrugItem) => string
  render?: (value: DrugItem[keyof DrugItem], row: DrugItem) => ReactNode
}
export interface TagConfig {
  id: string
  label: string
  colorHex: string
  shortTitle: string
  description: string
  defaultChecked: boolean
}
export interface DavSuggestion {
  id: string | number
  title: string
  subtitle: string
  meta: string
  row?: DrugItem | null
}
export type DavMetricPatch = Partial<DavFilters> & { _tag?: string; _quick?: string }
export interface DavMetricCard {
  key: string
  title: string
  mainValue: string | number
  unit?: string
  subtitle?: string
  titleTip?: string
  subMetrics: {
    id: string
    label: string
    count: string | number
    tone?: string
    info?: boolean
    title?: string
    patch?: DavMetricPatch
  }[]
}
export interface DavMetricStats {
  cards: DavMetricCard[]
  total: number
  sampleSize?: number
}
