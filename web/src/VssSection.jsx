import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, applyClientFilters, containsWords, fmtDate, fmtDateTime, matchesYear, sortByDateDesc } from './api'
import { cloudMetrics, cloudVssSearch, supabaseConfigured } from './supabaseCloud'
import { useAuth } from './auth'
import {
  DataTable, DetailModal, ErrorNote, Field, FilterModal, HospitalGradeField, Icons, MultiSelectField,
  IngredientText, LoadingOverlay, Pagination, SuggestField, TableToolbar, UpdatedNote,
  applyColumnFilters, exportSelectionOrAll, fetchAllPages, resolvePageSize, serverFilters, useSectionMeta,
  useSelection, useLoadProgress, useTt20, } from './components'
import { ingredientAllowedAtGrade } from './tt20'
import { loadUserJson, saveUserJson, userKeyPart } from './userPrefs'
import { VssMetrics, applyMetricQuick, VSS_METRICS_YEARS } from './metrics'

const PAGE_SIZE_DEFAULT = 100
const METRICS_CAP = 80_000

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
  { key: 'ten', label: 'Tên thuốc', width: 160, truncateAt: 72 },
  { key: 'duongdung', label: 'Đường dùng', filter: 'select' },
  { key: 'hamluong', label: 'Hàm lượng', truncateAt: 64 },
  { key: 'donvitinh', label: 'ĐVT', filter: 'select' },
  { key: 'soluong', label: 'Số lượng', align: 'right', mono: true, text: (r) => toNum(r.soluong), render: (v) => fmtNum(v) },
  { key: 'gia', label: 'Giá', align: 'right', mono: true, text: (r) => toNum(r.gia), render: (v) => fmtNum(v) },
  { key: 'thanhtien', label: 'Thành tiền', align: 'right', mono: true, text: (r) => toNum(r.thanhtien), render: (v) => fmtNum(v) },
  { key: 'nhomthau', label: 'Nhóm thầu', filter: 'select', align: 'center' },
  { key: 'nhasx', label: 'Nhà SX', width: 170, truncateAt: 72 },
  { key: 'nuocsx', label: 'Nước SX', filter: 'select' },
  { key: 'ma_tinh', label: 'Mã tỉnh', mono: true, filter: 'select' },
  { key: 'ten_tinh', label: 'Tỉnh / TP', filter: 'select' },
  { key: 'ma_cskcb', label: 'Mã CSKCB', mono: true },
  { key: 'tungay_hd', label: 'Từ ngày HĐ', nowrap: true, text: (r) => fmtDate(r.tungay_hd), render: (v) => fmtDate(v) },
  { key: 'denngay_hd', label: 'Đến ngày HĐ', nowrap: true, text: (r) => fmtDate(r.denngay_hd), render: (v) => fmtDate(v) },
]

const DETAIL_FIELDS = [
  ...ALL_COLS,
  { key: 'loai_thau', label: 'Loại thầu' },
  { key: 'ten_cskcb', label: 'CSKCB' },
  { key: 'nam', label: 'Năm' },
  { key: 'congbo', label: 'Công bố', text: (r) => fmtDate(r.congbo) },
]

const SERVER_MAP = {
  hoatchat: 'hoatchat', sodk: 'sodk', loai: 'loai', nhomthau: 'nhomthau', loai_thau: 'loai_thau',
  duongdung: 'duongdung', ma_tinh: 'ma_tinh', ten_tinh: 'ten_tinh', nuocsx: 'nuocsx',
}

const EMPTY_FILTERS = {
  q: '', loai_thau: [], loai: 'Tân dược', nhomthau: [], hoatchat: '', sodk: '',
  tuNgay: '', denNgay: '', nam: [], duongdung: [], ma_tinh: [], ten_tinh: [], nuocsx: [], hangBenhVien: [],
}

function filterStatic(items, f, tt20Index) {
  let out = items
  if ((f.q || '').trim()) {
    out = out.filter((r) => containsWords(`${r.ten} ${r.hoatchat} ${r.sodk} ${r.nhasx} ${r.tennhathau} ${r.ten_cskcb} ${r.ten_tinh}`, f.q))
  }
  out = applyClientFilters(out, [
    { value: f.loai_thau, keys: ['loai_thau'] }, { value: f.loai, keys: ['loai'] }, { value: f.nhomthau, keys: ['nhomthau'] },
    { value: f.hoatchat, keys: ['hoatchat'] }, { value: f.sodk, keys: ['sodk'] }, { value: f.duongdung, keys: ['duongdung'] },
    { value: f.ma_tinh, keys: ['ma_tinh'] }, { value: f.ten_tinh, keys: ['ten_tinh'] }, { value: f.nuocsx, keys: ['nuocsx'] },
  ])
  if (f.nam && (Array.isArray(f.nam) ? f.nam.length : String(f.nam).trim())) {
    out = out.filter((r) => matchesYear(r, f.nam))
  }
  if (f.tuNgay) out = out.filter((r) => String(r.tungay_hd || '') >= f.tuNgay)
  if (f.denNgay) out = out.filter((r) => String(r.denngay_hd || '') <= `${f.denNgay} 23:59:59`)
  const grades = Array.isArray(f.hangBenhVien) ? f.hangBenhVien : (f.hangBenhVien ? [f.hangBenhVien] : [])
  if (grades.length) {
    out = out.filter((r) => grades.some((g) => ingredientAllowedAtGrade(tt20Index, r.hoatchat, g)))
  }
  return sortByDateDesc(out, ['congbo', 'tungay_hd', 'tungay', 'denngay_hd', 'created_date'])
}

export default function VssSection({ localMode, embedded = false, filtersInModal = false }) {
  const { user } = useAuth()
  const userId = userKeyPart(user)
  const { index: tt20Index } = useTt20()
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
  const [refreshKey, setRefreshKey] = useState(0)
  const [prefsReady, setPrefsReady] = useState(false)
  const [loadPct, setLoadPct] = useState(null)
  const [metricsTotal, setMetricsTotal] = useState(null)
  const [metricsSample, setMetricsSample] = useState(null)
  const [metricsCards, setMetricsCards] = useState(null)
  const [metricsProvinces, setMetricsProvinces] = useState(null)
  const [metricsLoading, setMetricsLoading] = useState(false)
  const [tableReady, setTableReady] = useState(false)
  const [metricActiveId, setMetricActiveId] = useState(null)
  const [metricQuick, setMetricQuick] = useState(null)
  const sim = useLoadProgress(loading, 'Đang lọc BHYT VSS', loadPct)
  const sel = useSelection()
  const reqSeq = useRef(0)
  const sawTableLoad = useRef(false)
  useEffect(() => () => { reqSeq.current += 1 }, [])
  const meta = useSectionMeta('vss', localMode, null, refreshKey)

  useEffect(() => {
    const saved = loadUserJson(userId, 'vss', 'session', null)
    if (saved && typeof saved === 'object') {
      if (saved.filters) setFilters({ ...EMPTY_FILTERS, ...saved.filters })
      if (saved.columnFilters) setColumnFilters(saved.columnFilters)
    }
    setPrefsReady(true)
  }, [userId])

  useEffect(() => {
    if (!prefsReady) return
    saveUserJson(userId, 'vss', 'session', { filters, columnFilters })
  }, [userId, prefsReady, filters, columnFilters])

  const cols = ALL_COLS

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
    const size = resolvePageSize(pageSizeRef.current)
    setLoading(true)
    setErr('')
    setInfoNote('')
    const active = { ...mergedFilters(cf), ...(override || {}), loai: 'Tân dược' }
    try {
      const useRemote = localMode || supabaseConfigured
      if (useRemote) {
        const needGrade = Array.isArray(active.hangBenhVien)
          ? active.hangBenhVien.length > 0
          : !!active.hangBenhVien
        const searchFn = localMode
          ? (page, sz) => api.vssSearch({ filters: active, page, size: sz })
          : (page, sz) => cloudVssSearch({ filters: active, page, size: sz })

        if (needGrade) {
          const allRaw = await fetchAllPages(searchFn, {
            size: Math.max(size, 400),
            onProgress: (pct) => { if (!stale()) setLoadPct(pct) },
          })
          if (stale()) return
          let items = allRaw
          const grades = Array.isArray(active.hangBenhVien)
            ? active.hangBenhVien
            : (active.hangBenhVien ? [active.hangBenhVien] : [])
          items = items.filter((r) => grades.some((g) => ingredientAllowedAtGrade(tt20Index, r.hoatchat, g)))
          items = sortByDateDesc(items, ['congbo', 'tungay_hd', 'tungay', 'denngay_hd'])
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
        setLoadPct(null)
        setRefreshKey((k) => k + 1)
      }
    }
  }, [localMode, mergedFilters, tt20Index, embedded])

  // Metrics: cloud aggregate after first table paint; local page-backfill
  useEffect(() => {
    if (!prefsReady || embedded) return
    if (loading) sawTableLoad.current = true
    else if (sawTableLoad.current) setTableReady(true)
  }, [prefsReady, embedded, loading])

  useEffect(() => {
    if (!prefsReady || embedded || !tableReady) return undefined
    if (!(localMode || supabaseConfigured)) return undefined
    let cancelled = false
    setMetricsLoading(true)
    const finish = () => { if (!cancelled) setMetricsLoading(false) }
    if (!localMode) {
      cloudMetrics('vss')
        .then((payload) => {
          if (cancelled || !payload) return
          setMetricsCards(payload.cards || [])
          setMetricsTotal(payload.total ?? payload.sampleSize ?? null)
          setMetricsProvinces(payload.provinces || null)
          setMetricsSample(null)
        })
        .catch(() => { if (!cancelled) { setMetricsCards(null); setMetricsSample([]) } })
        .finally(finish)
      return () => { cancelled = true }
    }
    const base = { loai: 'Tân dược', nam: VSS_METRICS_YEARS.map(String) }
    const metricsFn = async (page, size) => {
      const result = await api.vssSearch({ filters: base, page, size })
      if (!cancelled) setMetricsTotal(result.total)
      return result
    }
    fetchAllPages(metricsFn, { size: 500, cap: METRICS_CAP, shouldCancel: () => cancelled })
      .then((all) => { if (!cancelled) { setMetricsSample(all); setMetricsCards(null) } })
      .catch(() => { if (!cancelled) setMetricsSample([]) })
      .finally(finish)
    return () => { cancelled = true }
  }, [prefsReady, localMode, embedded, tableReady])

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
  const detailActive = ['duongdung', 'ma_tinh', 'ten_tinh', 'nuocsx', 'hangBenhVien', 'loai_thau', 'nhomthau', 'hoatchat', 'sodk', 'tuNgay', 'denNgay', 'nam']
    .filter((k) => {
      const v = filters[k]
      if (Array.isArray(v)) return v.length > 0
      return String(v ?? '').trim() !== ''
    }).length

  const fieldSuggest = useCallback((fieldKey) => async (q) => {
    const needle = String(q || '').trim()
    try {
      let items = []
      if (localMode || supabaseConfigured) {
        const filters = needle
          ? { ...mergedFilters(), [fieldKey]: needle, q: '' }
          : { ...mergedFilters(), q: '' }
        const res = localMode
          ? await api.vssSearch({ filters, page: 0, size: needle ? 40 : 80 })
          : await cloudVssSearch({ filters, page: 0, size: needle ? 40 : 80 })
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
        if (out.length >= (needle ? 8 : 12)) break
      }
      return out
    } catch { return [] }
  }, [localMode, mergedFilters])

  const rows = useMemo(() => {
    let list = applyColumnFilters(data.items, cols, columnFilters)
    list = applyMetricQuick(list, metricQuick, 'vss')
    return list
  }, [data.items, cols, columnFilters, metricQuick])
  const rowKey = useCallback((r, i) => `${r.sodk}|${r.ma_tinh}|${r.tungay_hd}|${r.stt ?? `${page}-${i}`}`, [page])
  const pageSizeNum = resolvePageSize(pageSize)
  const metricsItems = metricsSample ?? data.items

  const onMetricFilter = useCallback((patch, id) => {
    if (metricActiveId === id) {
      setMetricActiveId(null)
      setMetricQuick(null)
      return
    }
    setMetricActiveId(id)
    if (patch?._quick) {
      setMetricQuick(patch._quick)
      setMetricsLoading(true)
      window.setTimeout(() => setMetricsLoading(false), 180)
      return
    }
    const { _quick, ...rest } = patch || {}
    if (!Object.keys(rest).length) return
    setFilters((f) => ({ ...f, ...rest }))
    setMetricQuick(null)
    search(0, undefined, rest)
  }, [metricActiveId, search])

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
  }, [localMode, mergedFilters, tt20Index, embedded])

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

  /** Shared fields keep single-view and pane filters consistent. */
  const modalFilters = (
    <div className="filter-grid">
      <MultiSelectField
        label="Nhóm thầu"
        value={filters.nhomthau}
        onChange={(v) => setF('nhomthau', v)}
        options={['N1', 'N2', 'N3', 'N4', 'N5']}
      />
      <HospitalGradeField value={filters.hangBenhVien} onChange={(v) => setF('hangBenhVien', v)} />
      <SuggestField label="Hoạt chất" value={filters.hoatchat} onChange={(v) => setF('hoatchat', v)} onSearch={(v) => runSearch({ hoatchat: v })} suggest={fieldSuggest('hoatchat')} />
      <SuggestField label="Số ĐK" value={filters.sodk} onChange={(v) => setF('sodk', v)} onSearch={(v) => runSearch({ sodk: v })} suggest={fieldSuggest('sodk')} />
      <MultiSelectField label="Loại thầu" value={filters.loai_thau} onChange={(v) => setF('loai_thau', v)} suggest={fieldSuggest('loai_thau')} placeholder="vd: thau_tinh…" />
      <Field label="HĐ từ ngày"><input type="date" value={filters.tuNgay} onChange={(e) => setF('tuNgay', e.target.value)} /></Field>
      <Field label="HĐ đến ngày"><input type="date" value={filters.denNgay} onChange={(e) => setF('denNgay', e.target.value)} /></Field>
      <MultiSelectField
        label="Năm hiệu lực"
        value={filters.nam}
        onChange={(v) => setF('nam', v)}
        options={Array.from({ length: 4 }, (_, i) => String(new Date().getFullYear() - i))}
        placeholder="Chọn năm…"
      />
      <MultiSelectField label="Đường dùng" value={filters.duongdung} onChange={(v) => setF('duongdung', v)} suggest={fieldSuggest('duongdung')} placeholder="Chọn đường dùng…" />
      <MultiSelectField label="Tỉnh / TP" value={filters.ten_tinh} onChange={(v) => setF('ten_tinh', v)} suggest={fieldSuggest('ten_tinh')} placeholder="Chọn tỉnh…" />
      <MultiSelectField label="Mã tỉnh" value={filters.ma_tinh} onChange={(v) => setF('ma_tinh', v)} suggest={fieldSuggest('ma_tinh')} placeholder="Chọn mã tỉnh…" />
      <MultiSelectField label="Nước sản xuất" value={filters.nuocsx} onChange={(v) => setF('nuocsx', v)} suggest={fieldSuggest('nuocsx')} placeholder="Chọn nước…" />
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
                  {modalFilters}
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
            {!embedded && (
              <VssMetrics items={metricsItems} cards={metricsCards} provinces={metricsProvinces} total={metricsTotal ?? metricsSample?.length ?? data.total} activeId={metricActiveId} onFilter={onMetricFilter} loading={metricsLoading} />
            )}
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
          <button type="button" className="btn ghost sm" onClick={() => runSearch()} title="Quét lại dữ liệu">
            {Icons.refresh} Quét lại
          </button>
        </TableToolbar>

        {infoNote && <div className="info-note">{infoNote}</div>}
        <ErrorNote>{err}</ErrorNote>

        <DataTable
          columns={cols}
          rows={rows}
          rowKey={rowKey}
          startIndex={page * pageSizeNum}
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
          emptyAction={(
            <button type="button" className="btn" onClick={() => runSearch()}>
              {Icons.refresh} Tìm kiếm lại
            </button>
          )}
          cardKeys={['hoatchat', 'sodk', 'ten', 'thanhtien', 'ten_tinh']}
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
        fields={DETAIL_FIELDS}
        title={detail?.ten || detail?.hoatchat || 'Chi tiết'}
        subtitle={detail ? `BHYT VSS · SĐK ${detail.sodk || '—'} · ${detail.ten_tinh || ''}` : ''}
        onClose={() => setDetail(null)}
        renderValue={(f, row, val) => (f.key === 'hoatchat' ? <IngredientText text={row.hoatchat} /> : val)}
      />
      <LoadingOverlay show={loading} percent={sim.percent} message={sim.message} etaSec={sim.etaSec} onCancel={() => { reqSeq.current += 1; setLoading(false) }} />
      <LoadingOverlay show={exporting} percent={exportPct} message="Đang gom dữ liệu để xuất Excel…" onCancel={() => setExporting(false)} />
    </div>
  )
}
