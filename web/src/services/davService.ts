import { api as legacyApi } from '../api'
import { cloudDavSearch as legacyCloudSearch, cloudMetrics as legacyMetrics } from '../supabaseCloud'
import { EMPTY_FILTERS } from '../components/dav/davConfig'
import type {
  ColumnFilters,
  DavFilters,
  DavMetricStats,
  DavMetricCard,
  DavMetricPatch,
  DavSearchRequest,
  DavSearchResult,
  DrugItem,
} from '../types/dav'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
export function parseDavPage(value: unknown): DavSearchResult {
  if (!record(value) || !Array.isArray(value.items) || !Number.isFinite(Number(value.total)))
    throw new Error('Dữ liệu DAV trả về chưa hợp lệ.')
  const items: DrugItem[] = value.items.map((row: unknown) => {
    if (!record(row)) throw new Error('Dòng dữ liệu DAV chưa hợp lệ.')
    for (const key of [
      'soDangKy',
      'soDangKyCu',
      'tenThuoc',
      'ngayCap',
      'ngayGiaHan',
      'ngayHetHan',
      'hoatChat',
      'hamLuong',
      'dangBaoChe',
      'dongGoi',
      'hanDung',
      'ctySanXuat',
      'ctyDangKy',
      'nuocSanXuat',
      'nuocDangKy',
      'tagId',
      'soQuyetDinh',
      'tieuChuan',
    ]) {
      if (row[key] != null && typeof row[key] !== 'string') throw new Error('Trường dữ liệu DAV chưa hợp lệ.')
    }
    if (row.id != null && typeof row.id !== 'string' && typeof row.id !== 'number') throw new Error('Mã DAV chưa hợp lệ.')
    if (row.kyCapNam != null && typeof row.kyCapNam !== 'string' && typeof row.kyCapNam !== 'number') throw new Error('Kỳ cấp DAV chưa hợp lệ.')
    if (row.ingredientCount != null && (typeof row.ingredientCount !== 'number' || !Number.isFinite(row.ingredientCount))) throw new Error('Số hoạt chất chưa hợp lệ.')
    if (row.conHieuLuc != null && typeof row.conHieuLuc !== 'boolean') throw new Error('Trạng thái hiệu lực chưa hợp lệ.')
    return row as DrugItem
  })
  return { total: Number(value.total), page: Number(value.page) || 0, size: Number(value.size) || 100, items }
}
export const api = {
  davSearch: async (request: DavSearchRequest): Promise<DavSearchResult> =>
    parseDavPage(await legacyApi.davSearch(request)),
  davValidity: (): Promise<unknown> => legacyApi.davValidity(),
}
export async function cloudDavSearch(request: DavSearchRequest): Promise<DavSearchResult> {
  return parseDavPage(await legacyCloudSearch(request))
}
export async function cloudMetrics(section: 'dav'): Promise<DavMetricStats | null> {
  const value: unknown = await legacyMetrics(section)
  if (!record(value) || !Array.isArray(value.cards)) return null
  if (!value.cards.every(isMetricCard)) throw new Error('Chỉ số DAV chưa hợp lệ.')
  return { cards: value.cards, total: Number(value.total ?? value.sampleSize) || 0 }
}
function isMetricPatch(value: unknown): value is DavMetricPatch {
  if (!record(value)) return false
  return Object.entries(value).every(([key, val]) => {
    if (key === '_tag' || key === '_quick') return typeof val === 'string'
    if (!(key in EMPTY_FILTERS)) return false
    if (key === 'tags') return val === null || Array.isArray(val) && val.every(v => typeof v === 'string')
    if (Array.isArray(EMPTY_FILTERS[key as keyof DavFilters])) return Array.isArray(val) && val.every(v => typeof v === 'string')
    return typeof val === 'string'
  })
}
function isMetricCard(value: unknown): value is DavMetricCard {
  if (!record(value) || typeof value.key !== 'string' || typeof value.title !== 'string') return false
  if (typeof value.mainValue !== 'string' && typeof value.mainValue !== 'number') return false
  if (!['unit', 'subtitle', 'titleTip'].every(key => value[key] == null || typeof value[key] === 'string')) return false
  return Array.isArray(value.subMetrics) && value.subMetrics.every((item: unknown) => {
    if (!record(item) || typeof item.id !== 'string' || typeof item.label !== 'string') return false
    if (typeof item.count !== 'string' && typeof item.count !== 'number') return false
    if (!['tone', 'title'].every(key => item[key] == null || typeof item[key] === 'string')) return false
    return (item.info == null || typeof item.info === 'boolean') && (item.patch == null || isMetricPatch(item.patch))
  })
}
export function davErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/search_dav_drugs|schema cache|PGRST202/.test(message))
    return 'Nguồn dữ liệu DAV đang gián đoạn; nguồn dự phòng chưa được thiết lập. Vui lòng thử lại sau.'
  if (/Unauthorized|401|403|đăng nhập/i.test(message))
    return 'Phiên đăng nhập chưa hợp lệ. Vui lòng đăng nhập lại để tra cứu.'
  return 'Chưa thể hoàn tất yêu cầu DAV. Vui lòng thử lại.'
}
export function readDavSession(value: unknown): { filters: DavFilters; columnFilters: ColumnFilters } | null {
  if (!record(value)) return null
  const filters = { ...EMPTY_FILTERS }
  if (record(value.filters)) {
    for (const key of Object.keys(filters) as (keyof DavFilters)[]) {
      const saved = value.filters[key]
      if (
        Array.isArray(filters[key]) &&
        Array.isArray(saved) &&
        saved.every((v: unknown) => typeof v === 'string')
      )
        Object.assign(filters, { [key]: saved })
      else if (typeof filters[key] === 'string' && typeof saved === 'string')
        Object.assign(filters, { [key]: saved })
    }
  }
  const columnFilters: ColumnFilters = {}
  if (record(value.columnFilters))
    for (const [key, val] of Object.entries(value.columnFilters))
      if (typeof val === 'string') columnFilters[key] = val
  return { filters, columnFilters }
}
