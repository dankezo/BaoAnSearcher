import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, applyClientFilters, containsWords, fmtDate, fmtDateTime, matchesYear, sortByDateDesc } from './api'
import { cloudMeta, cloudVssSearch, supabaseConfigured } from './supabaseCloud'
import { useAuth } from './auth'
import {
  ColumnPicker, DataTable, DetailModal, ErrorNote, Field, FilterModal, HospitalGradeField, Icons,
  IngredientText, LoadingOverlay, Pagination, SuggestField, TableToolbar, UpdatedNote, ViewModeSelect,
  applyColumnFilters, exportSelectionOrAll, fetchAllPages, resolvePageSize, serverFilters, useSectionMeta,
  useSelection, useSimProgress, useTt20, isFullPageSize, PAGE_SIZE_FULL_CAP,
} from './components'
import { ingredientAllowedAtGrade } from './tt20'
import { loadUserJson, saveUserJson, userKeyPart } from './userPrefs'
import { VssMetrics } from './metrics'

const PAGE_SIZE_DEFAULT = 100

const toNum = (v) => {
  if (v == null || v === '') return ''
  const n = Number(String(v).replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : v
}
const fmtNum = (v) => {
  const n = toNum(v)
  return typeof n === 'number' ? n.toLocaleString('vi-VN') : (v ?? '')
}

const ALL_COLS = [
  { key: 'hoatchat', label: 'Tên hoạt chất', width: 200, render: (v) => <IngredientText text={v} /> },
  { key: 'sodk', label: 'Số ĐK', mono: true, nowrap: true },
  { key: 'ten', label: 'Tên thuốc', width: 160 },
  { key: 'duongdung', label: 'Đường dùng', filter: 'select' },
  { key: 'hamluong', label: 'Hàm lượng' },
  { key: 'donvitinh', label: 'ĐVT', filter: 'select' },
  { key: 'soluong', label: 'Số lượng', align: 'right', mono: true, text: (r) => toNum(r.soluong), render: (v) => fmtNum(v) },
  { key: 'gia', label: 'Giá', align: 'right', mono: true, text: (r) => toNum(r.gia), render: (v) => fmtNum(v) },
  { key: 'thanhtien', label: 'Thành tiền', align: 'right', mono: true, text: (r) => toNum(r.thanhtien), render: (v) => fmtNum(v) },
  { key: 'nhomthau', label: 'Nhóm thầu', filter: 'select', align: 'center' },
  { key: 'nhasx', label: 'Nhà SX', width: 170 },
  { key: 'nuocsx', label: 'Nước SX', filter: 'select' },
  { key: 'ma_tinh', label: 'Mã tỉnh', mono: true, filter: 'select' },
  { key: 'ma_cskcb', label: 'Mã CSKCB', mono: true },
  { key: 'tungay_hd', label: 'Từ ngày HĐ', nowrap: true, text: (r) => fmtDate(r.tungay_hd), render: (v) => fmtDate(v) },
  { key: 'denngay_hd', label: 'Đến ngày HĐ', nowrap: true, text: (r) => fmtDate(r.denngay_hd), render: (v) => fmtDate(v) },
  { key: 'loai_thau', label: 'Loại thầu', filter: 'select' },
  { key: 'dangbaoche', label: 'Dạng bào chế' },
  { key: 'donggoi', label: 'Đóng gói' },
  { key: 'tennhathau', label: 'Nhà thầu', width: 170 },
  { key: 'ten_tinh', label: 'Tỉnh', filter: 'select' },
  { key: 'ten_cskcb', label: 'CSKCB' },
  { key: 'quyetdinh', label: 'Quyết định', mono: true },
  { key: 'goithau', label: 'Gói thầu' },
  { key: 'congbo', label: 'Công bố', nowrap: true, text: (r) => fmtDate(r.congbo), render: (v) => fmtDate(v) },
]

const DEFAULT = [
  'hoatchat', 'sodk', 'ten', 'duongdung', 'hamluong', 'donvitinh',
  'soluong', 'gia', 'thanhtien', 'nhomthau', 'nhasx', 'nuocsx',
  'ma_tinh', 'ma_cskcb', 'tungay_hd', 'denngay_hd',
]

const EXTRA_DETAIL = [
  { key: 'ma', label: 'Mã thuốc' }, { key: 'ma_gy', label: 'Mã GY' }, { key: 'maduongdung', label: 'Mã đường dùng' },
  { key: 'madd_gy', label: 'Mã ĐD GY' }, { key: 'ten_don_vi', label: 'Đơn vị' },
  { key: 'tungay', label: 'Từ ngày', text: (r) => fmtDate(r.tungay) }, { key: 'denngay', label: 'Đến ngày', text: (r) => fmtDate(r.denngay) },
  { key: 'tieuchuan', label: 'Tiêu chuẩn' }, { key: 'sttpheduyet', label: 'STT phê duyệt' }, { key: 'hieuluc', label: 'Hiệu lực' },
  { key: 'ht_thau', label: 'Hình thức thầu' }, { key: 'loai', label: 'Loại' },
  { key: 'created_date', label: 'Ngày tạo', text: (r) => fmtDateTime(r.created_date) },
]

const SERVER_MAP = {
  hoatchat: 'hoatchat', sodk: 'sodk', loai: 'loai', nhomthau: 'nhomthau', loai_thau: 'loai_thau',
  duongdung: 'duongdung', ma_tinh: 'ma_tinh', nuocsx: 'nuocsx',
}

const EMPTY_FILTERS = {
  q: '', loai_thau: '', loai: 'Tân dược', nhomthau: '', hoatchat: '', sodk: '',
  tuNgay: '', denNgay: '', nam: '', duongdung: '', ma_tinh: '', nuocsx: '', hangBenhVien: '',
}

function filterStatic(items, f, tt20Index) {
  let out = items
  if ((f.q || '').trim()) {
    out = out.filter((r) => containsWords(`${r.ten} ${r.hoatchat} ${r.sodk} ${r.nhasx} ${r.tennhathau} ${r.ten_cskcb} ${r.ten_tinh}`, f.q))
  }
  out = applyClientFilters(out, [
    { value: f.loai_thau, keys: ['loai_thau'] }, { value: f.loai, keys: ['loai'] }, { value: f.nhomthau, keys: ['nhomthau'] },
    { value: f.hoatchat, keys: ['hoatchat'] }, { value: f.sodk, keys: ['sodk'] }, { value: f.duongdung, keys: ['duongdung'] },
    { value: f.ma_tinh, keys: ['ma_tinh'] }, { value: f.nuocsx, keys: ['nuocsx'] },
  ])
  if (f.nam) out = out.filter((r) => matchesYear(r, f.nam))
  if (f.tuNgay) out = out.filter((r) => String(r.tungay_hd || '') >= f.tuNgay)
  if (f.denNgay) out = out.filter((r) => String(r.denngay_hd || '') <= `${f.denNgay} 23:59:59`)
  if (f.hangBenhVien) {
    out = out.filter((r) => ingredientAllowedAtGrade(tt20Index, r.hoatchat, f.hangBenhVien))
  }
  return sortByDateDesc(out, ['congbo', 'tungay_hd', 'tungay', 'denngay_hd', 'created_date'])
}

export default function VssSection({ localMode, embedded = false, filtersInModal = false }) {
  const { user } = useAuth()
  const userId = userKeyPart(user)
  const { index: tt20Index } = useTt20()
  const [colPicker, setColPicker] = useState(false)
  const [viewMode, setViewMode] = useState('compact')
  const [visible, setVisible] = useState(DEFAULT)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [columnFilters, setColumnFilters] = useState({})
  const [filtersRow, setFiltersRow] = useState(false)
  const [filterModalOpen, setFilterModalOpen] = useState(false)
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT)
  const [page, setPage] = useState(0)
  const [data, setData] = useState({ total: 0, items: [] })
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportPct, setExportPct] = useState(0)
  const [err, setErr] = useState('')
  const [infoNote, setInfoNote] = useState('')
  const [detail, setDetail] = useState(null)
  const [staticFallback, setStaticFallback] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [prefsReady, setPrefsReady] = useState(false)
  const [fullNote, setFullNote] = useState('')
  const sim = useSimProgress(loading, 'Đang lọc BHYT VSS')
  const sel = useSelection()
  const reqSeq = useRef(0)
  const meta = useSectionMeta('vss', localMode, staticFallback, refreshKey)

  useEffect(() => {
    const saved = loadUserJson(userId, 'vss', 'session', null)
    if (saved && typeof saved === 'object') {
      if (saved.filters) setFilters({ ...EMPTY_FILTERS, ...saved.filters })
      if (saved.viewMode) setViewMode(saved.viewMode)
      if (Array.isArray(saved.visible) && saved.visible.length) setVisible(saved.visible)
      if (saved.pageSize != null) setPageSize(saved.pageSize)
      if (saved.columnFilters) setColumnFilters(saved.columnFilters)
    }
    setPrefsReady(true)
  }, [userId])

  useEffect(() => {
    if (!prefsReady) return
    saveUserJson(userId, 'vss', 'session', { filters, viewMode, visible, pageSize, columnFilters })
  }, [userId, prefsReady, filters, viewMode, visible, pageSize, columnFilters])

  useEffect(() => {
    if (localMode || !supabaseConfigured) return undefined
    let alive = true
    cloudMeta('vss').then((m) => {
      if (alive && m) setStaticFallback({ updated: m.updated, count: m.count })
    }).catch(() => {})
    return () => { alive = false }
  }, [localMode])

  useEffect(() => {
    if (viewMode === 'compact') setVisible(DEFAULT)
    else if (viewMode === 'full') setVisible(ALL_COLS.map((c) => c.key))
  }, [viewMode])

  const cols = useMemo(() => ALL_COLS.filter((c) => visible.includes(c.key)), [visible])

  const filtersRef = useRef(filters)
  const columnFiltersRef = useRef(columnFilters)
  const pageSizeRef = useRef(pageSize)
  filtersRef.current = filters
  columnFiltersRef.current = columnFilters
  pageSizeRef.current = pageSize

  const mergedFilters = useCallback(
    (cf) => ({ ...filtersRef.current, ...serverFilters(cf ?? columnFiltersRef.current, SERVER_MAP), loai: 'Tân dược' }),
    [],
  )

  const search = useCallback(async (p = 0, cf, override = null) => {
    const id = ++reqSeq.current
    const stale = () => id !== reqSeq.current
    const full = isFullPageSize(pageSizeRef.current)
    const size = resolvePageSize(pageSizeRef.current)
    setLoading(true)
    setErr('')
    setInfoNote('')
    setFullNote('')
    const active = { ...mergedFilters(cf), ...(override || {}), loai: 'Tân dược' }
    try {
      const useRemote = localMode || supabaseConfigured
      if (useRemote) {
        const needGrade = !!active.hangBenhVien
        const searchFn = localMode
          ? (page, sz) => api.vssSearch({ filters: active, page, size: sz })
          : (page, sz) => cloudVssSearch({ filters: active, page, size: sz })

        if (full || needGrade) {
          const allRaw = await fetchAllPages(searchFn, {
            size: Math.max(size, 400),
            cap: PAGE_SIZE_FULL_CAP,
          })
          if (stale()) return
          let items = allRaw
          if (needGrade) {
            items = items.filter((r) => ingredientAllowedAtGrade(tt20Index, r.hoatchat, active.hangBenhVien))
          }
          items = sortByDateDesc(items, ['congbo', 'tungay_hd', 'tungay', 'denngay_hd'])
          if (full && allRaw.length >= PAGE_SIZE_FULL_CAP) {
            setFullNote(`Đã tải tối đa ${PAGE_SIZE_FULL_CAP.toLocaleString('vi-VN')} dòng — thu hẹp lọc nếu cần xem thêm.`)
          }
          setData({ total: items.length, items, page: 0, size: items.length || size })
          setPage(0)
        } else {
          const res = await searchFn(p, size)
          if (stale()) return
          setData(res)
          setPage(p)
        }
        return
      }
      setErr('Chưa cấu hình Supabase. Thêm VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY rồi build lại.')
      setData({ total: 0, items: [] })
    } catch (e) {
      if (!stale()) setErr(String(e.message || e))
    } finally {
      if (!stale()) {
        setLoading(false)
        setRefreshKey((k) => k + 1)
      }
    }
  }, [localMode, mergedFilters, tt20Index])

  useEffect(() => {
    if (!prefsReady) return
    search(0)
  }, [prefsReady, pageSize]) // eslint-disable-line react-hooks/exhaustive-deps

  const setF = (k, v) => setFilters((f) => ({ ...f, [k]: v }))
  const setCF = (k, v) => setColumnFilters((f) => ({ ...f, [k]: v }))
  const runSearch = useCallback((override) => search(0, undefined, override || null), [search])
  const onEnter = (e) => {
    if (e.key === 'Enter' && !e.nativeEvent?.isComposing) runSearch()
  }
  const activeCF = Object.values(columnFilters).filter((v) => String(v ?? '').trim()).length
  const detailActive = ['duongdung', 'ma_tinh', 'nuocsx', 'hangBenhVien', 'loai_thau', 'nhomthau', 'hoatchat', 'sodk', 'tuNgay', 'denNgay', 'nam']
    .filter((k) => String(filters[k] ?? '').trim()).length

  const fieldSuggest = useCallback((fieldKey) => async (q) => {
    const needle = String(q || '').trim()
    if (needle.length < 1) return []
    try {
      let items = []
      if (localMode || supabaseConfigured) {
        const res = localMode
          ? await api.vssSearch({ filters: { ...mergedFilters(), [fieldKey]: needle, q: '' }, page: 0, size: 30 })
          : await cloudVssSearch({ filters: { ...mergedFilters(), [fieldKey]: needle, q: '' }, page: 0, size: 30 })
        items = res?.items || []
      }
      const seen = new Set()
      const out = []
      for (const r of items) {
        const t = String(
          fieldKey === 'q'
            ? (r.hoatchat || r.ten || r.sodk || '')
            : (r[fieldKey] || ''),
        ).trim()
        if (!t || seen.has(t)) continue
        seen.add(t)
        out.push(t)
        if (out.length >= 3) break
      }
      return out
    } catch { return [] }
  }, [localMode, mergedFilters])

  const rows = useMemo(() => applyColumnFilters(data.items, cols, columnFilters), [data.items, cols, columnFilters])
  const rowKey = useCallback((r, i) => `${r.sodk}|${r.ma}|${r.ma_tinh}|${r.quyetdinh}|${r.stt ?? `${page}-${i}`}`, [page])
  const fullMode = isFullPageSize(pageSize)
  const pageSizeNum = fullMode ? Math.max(data.items?.length || 0, 1) : resolvePageSize(pageSize)
  const metricsItems = rows.length ? rows : data.items

  const fetchAll = useCallback(async () => {
    const searchFn = localMode
      ? (p, size) => api.vssSearch({ filters: mergedFilters(), page: p, size })
      : (p, size) => cloudVssSearch({ filters: mergedFilters(), page: p, size })
    if (!localMode && !supabaseConfigured) return []
    const all = await fetchAllPages(searchFn, { onProgress: setExportPct })
    if (filtersRef.current.hangBenhVien) {
      return all.filter((r) => ingredientAllowedAtGrade(tt20Index, r.hoatchat, filtersRef.current.hangBenhVien))
    }
    return all
  }, [localMode, mergedFilters, tt20Index])

  const doExport = async () => {
    setExporting(true)
    setExportPct(5)
    try {
      const n = await exportSelectionOrAll({
        columns: cols, selected: sel.selected, fetchAll, filename: 'VSS_BHYT_trung_thau', sheetName: 'VSS', columnFilters,
      })
      if (!n) setErr('Không có dòng nào để xuất.')
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setExporting(false)
    }
  }

  const primaryFilters = (
    <div className="filter-grid cols-5">
      <Field label="Nhóm thầu">
        <select value={filters.nhomthau} onChange={(e) => setF('nhomthau', e.target.value)}>
          <option value="">Tất cả</option>
          {['N1', 'N2', 'N3', 'N4', 'N5'].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </Field>
      <HospitalGradeField value={filters.hangBenhVien} onChange={(v) => setF('hangBenhVien', v)} />
      <SuggestField label="Hoạt chất" value={filters.hoatchat} onChange={(v) => setF('hoatchat', v)} onSearch={(v) => runSearch({ hoatchat: v })} suggest={fieldSuggest('hoatchat')} />
      <SuggestField label="Số ĐK" value={filters.sodk} onChange={(v) => setF('sodk', v)} onSearch={(v) => runSearch({ sodk: v })} suggest={fieldSuggest('sodk')} />
      <SuggestField label="Loại thầu" value={filters.loai_thau} onChange={(v) => setF('loai_thau', v)} onSearch={(v) => runSearch({ loai_thau: v })} suggest={fieldSuggest('loai_thau')} placeholder="vd: thau_tinh" />
    </div>
  )

  const detailFilters = (
    <div className="filter-grid tight cols-6">
      <Field label="HĐ từ ngày"><input type="date" value={filters.tuNgay} onChange={(e) => setF('tuNgay', e.target.value)} /></Field>
      <Field label="HĐ đến ngày"><input type="date" value={filters.denNgay} onChange={(e) => setF('denNgay', e.target.value)} /></Field>
      <Field label="Năm" hint="hiệu lực HĐ">
        <input value={filters.nam} onChange={(e) => setF('nam', e.target.value)} onKeyDown={onEnter} placeholder="2024 · 2025 · 2026" inputMode="numeric" />
      </Field>
      <SuggestField label="Đường dùng" value={filters.duongdung} onChange={(v) => setF('duongdung', v)} onSearch={(v) => runSearch({ duongdung: v })} suggest={fieldSuggest('duongdung')} />
      <SuggestField label="Mã tỉnh" value={filters.ma_tinh} onChange={(v) => setF('ma_tinh', v)} onSearch={(v) => runSearch({ ma_tinh: v })} suggest={fieldSuggest('ma_tinh')} />
      <SuggestField label="Nước SX" value={filters.nuocsx} onChange={(v) => setF('nuocsx', v)} onSearch={(v) => runSearch({ nuocsx: v })} suggest={fieldSuggest('nuocsx')} />
    </div>
  )

  /** In multi-view: everything except keyword goes into the modal. */
  const modalFilters = (
    <div className="filter-grid">
      <Field label="Nhóm thầu">
        <select value={filters.nhomthau} onChange={(e) => setF('nhomthau', e.target.value)}>
          <option value="">Tất cả</option>
          {['N1', 'N2', 'N3', 'N4', 'N5'].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </Field>
      <HospitalGradeField value={filters.hangBenhVien} onChange={(v) => setF('hangBenhVien', v)} />
      <SuggestField label="Hoạt chất" value={filters.hoatchat} onChange={(v) => setF('hoatchat', v)} onSearch={(v) => runSearch({ hoatchat: v })} suggest={fieldSuggest('hoatchat')} />
      <SuggestField label="Số ĐK" value={filters.sodk} onChange={(v) => setF('sodk', v)} onSearch={(v) => runSearch({ sodk: v })} suggest={fieldSuggest('sodk')} />
      <SuggestField label="Loại thầu" value={filters.loai_thau} onChange={(v) => setF('loai_thau', v)} onSearch={(v) => runSearch({ loai_thau: v })} suggest={fieldSuggest('loai_thau')} placeholder="vd: thau_tinh" />
      <Field label="HĐ từ ngày"><input type="date" value={filters.tuNgay} onChange={(e) => setF('tuNgay', e.target.value)} /></Field>
      <Field label="HĐ đến ngày"><input type="date" value={filters.denNgay} onChange={(e) => setF('denNgay', e.target.value)} /></Field>
      <Field label="Năm" hint="hiệu lực HĐ"><input value={filters.nam} onChange={(e) => setF('nam', e.target.value)} onKeyDown={onEnter} placeholder="2024 · 2025 · 2026" inputMode="numeric" /></Field>
      <SuggestField label="Đường dùng" value={filters.duongdung} onChange={(v) => setF('duongdung', v)} onSearch={(v) => runSearch({ duongdung: v })} suggest={fieldSuggest('duongdung')} />
      <SuggestField label="Mã tỉnh" value={filters.ma_tinh} onChange={(v) => setF('ma_tinh', v)} onSearch={(v) => runSearch({ ma_tinh: v })} suggest={fieldSuggest('ma_tinh')} />
      <SuggestField label="Nước SX" value={filters.nuocsx} onChange={(v) => setF('nuocsx', v)} onSearch={(v) => runSearch({ nuocsx: v })} suggest={fieldSuggest('nuocsx')} />
    </div>
  )

  return (
    <div className={`section${embedded ? ' embedded' : ''}`}>
      {!embedded && (
        <header className="section-head">
          <div>
            <span className="kicker">Bảo hiểm xã hội Việt Nam · Kết quả đấu thầu thuốc</span>
            <h1>Thuốc trúng thầu BHYT (VSS)</h1>
            <p>Danh mục kết quả lựa chọn nhà thầu thuốc BHYT (Tân dược) — lọc theo nhóm thầu, hạng bệnh viện TT20, SĐK và thời hạn hợp đồng.</p>
          </div>
          <UpdatedNote updated={meta.updated} count={meta.count} />
        </header>
      )}

      <div className="panel">
        <div className="filters">
          <div className={`filters-split${embedded ? ' no-stats' : ''}`}>
            <div className="filters-left">
              {filtersInModal ? (
                <div className="filter-keyword">
                  <SuggestField label="Từ khóa" value={filters.q} onChange={(v) => setF('q', v)} onSearch={(v) => runSearch({ q: v })} suggest={fieldSuggest('q')} placeholder="Tên · hoạt chất · SĐK · nhà thầu…" />
                </div>
              ) : (
                <>
                  <div className="filter-keyword">
                    <SuggestField label="Từ khóa" value={filters.q} onChange={(v) => setF('q', v)} onSearch={(v) => runSearch({ q: v })} suggest={fieldSuggest('q')} placeholder="Tên · hoạt chất · SĐK · nhà thầu…" />
                  </div>
                  {primaryFilters}
                  {detailFilters}
                </>
              )}
              <div className="filter-actions">
                {filtersInModal && (
                  <button
                    type="button"
                    className={`btn ghost${detailActive ? ' on' : ''}`}
                    onClick={() => setFilterModalOpen(true)}
                  >
                    {Icons.filter} Bộ lọc chi tiết
                    {detailActive > 0 && <span className="pill">{detailActive}</span>}
                  </button>
                )}
                <button type="button" className="btn" onClick={() => runSearch()}>{Icons.search} Tìm kiếm</button>
                <button type="button" className="btn secondary" onClick={() => { setFilters(EMPTY_FILTERS); setColumnFilters({}) }}>Xóa lọc</button>
              </div>
            </div>
            {!embedded && <VssMetrics items={metricsItems} tt20Index={tt20Index} />}
          </div>
        </div>

        <TableToolbar
          kicker="Bảng chính"
          title={embedded ? 'VSS BHYT' : 'Kết quả trúng thầu'}
          selectedCount={sel.size}
          onClearSelection={sel.clear}
          onExport={doExport}
          exporting={exporting}
          filtersVisible={filtersRow}
          onToggleFilters={() => setFiltersRow((v) => !v)}
          activeColumnFilters={activeCF}
          onClearColumnFilters={() => { setColumnFilters({}); search(0, {}) }}
        >
          <ViewModeSelect value={viewMode} onChange={(v) => { setViewMode(v); if (v === 'custom') setColPicker(true) }} />
          {viewMode === 'custom' && (
            <button type="button" className="btn ghost sm" onClick={() => setColPicker((v) => !v)}>{Icons.columns} Cột</button>
          )}
        </TableToolbar>

        <ColumnPicker allColumns={ALL_COLS} visible={visible} onChange={setVisible} open={colPicker} onClose={() => setColPicker(false)} />
        {infoNote && <div className="info-note">{infoNote}</div>}
        {fullNote && <div className="info-note">{fullNote}</div>}
        <ErrorNote>{err}</ErrorNote>

        <DataTable
          columns={cols}
          rows={rows}
          rowKey={rowKey}
          startIndex={fullMode ? 0 : page * pageSizeNum}
          selected={sel.selected}
          onToggleRow={sel.toggle}
          onToggleAll={sel.setMany}
          columnFilters={columnFilters}
          onColumnFilter={setCF}
          filtersVisible={filtersRow}
          onFilterEnter={() => search(0)}
          onFilterSuggest={async (key, q) => fieldSuggest(key)(q)}
          onRowDoubleClick={setDetail}
          loading={loading}
          emptyText="Không có dữ liệu — import Excel hoặc crawl VSS trong mục Quản trị"
          minWidth={embedded ? 720 : 1300}
        />
        <Pagination
          page={page}
          size={pageSizeNum}
          total={data.total || 0}
          shown={rows.length}
          onPage={(p) => search(p)}
          pageSize={pageSize}
          onPageSize={(v) => { setPageSize(v); setPage(0) }}
          extra={sel.size > 0 && <span className="chip">{sel.size} dòng đã chọn</span>}
        />
      </div>

      <FilterModal
        open={filtersInModal && filterModalOpen}
        onClose={() => setFilterModalOpen(false)}
        onApply={() => runSearch()}
      >
        {modalFilters}
      </FilterModal>

      <DetailModal
        row={detail}
        fields={[...ALL_COLS, ...EXTRA_DETAIL]}
        title={detail?.ten || detail?.hoatchat || 'Chi tiết'}
        subtitle={detail ? `BHYT VSS · SĐK ${detail.sodk || '—'} · ${detail.ten_tinh || ''}` : ''}
        onClose={() => setDetail(null)}
        renderValue={(f, row, val) => (f.key === 'hoatchat' ? <IngredientText text={row.hoatchat} /> : val)}
      />
      <LoadingOverlay show={loading} percent={sim.percent} message={sim.message} onCancel={() => { reqSeq.current += 1; setLoading(false) }} />
      <LoadingOverlay show={exporting} percent={exportPct} message="Đang gom dữ liệu để xuất Excel…" onCancel={() => setExporting(false)} />
    </div>
  )
}
