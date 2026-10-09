import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, applyClientFilters, containsWords, fmtDate, fmtDateTime, matchesYear, SHORT_SEARCH_NOTE, skipShortTextSearch, sortByDateDesc } from './api'
import { cloudSuggest, cloudVssSearch, cloudMap, supabaseConfigured } from './supabaseCloud'
import { loadSuggestStatic } from './suggestClient'
import { FilterDraft } from './filterDraft'
import {
  DataTable, DetailModal, ErrorNote, Field, FilterModal, Icons, Modal, MultiSelectField,
  IngredientText, LoadingOverlay, Pagination, SuggestField, TableToolbar, UpdatedNote,
  applyColumnFilters, exportSelectionOrAll, fetchAllPages, resolvePageSize, serverFilters, useSectionMeta,
  useSelection, useLoadProgress, } from './components'
import { StatCards } from './areaStats'
import { applyMetricQuick } from './metrics'

const PAGE_SIZE_DEFAULT = 100
const VSS_TEXT_KEYS = ['q', 'hoatchat', 'sodk']

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
  { key: 'sodk', label: 'Số ĐK', width: 112, mono: true, nowrap: true },
  { key: 'ten', label: 'Tên thuốc', width: 160, truncateAt: 72 },
  { key: 'duongdung', label: 'Đường dùng', filter: 'select' },
  { key: 'dangbaoche', label: 'Dạng bào chế', filter: 'select', truncateAt: 48 },
  { key: 'hamluong', label: 'Hàm lượng', truncateAt: 64 },
  { key: 'donvitinh', label: 'ĐVT', width: 65, filter: 'select' },
  { key: 'soluong', label: 'Số lượng', align: 'right', mono: true, text: (r) => toNum(r.soluong), render: (v) => fmtNum(v) },
  { key: 'gia', label: 'Giá', align: 'right', mono: true, text: (r) => toNum(r.gia), render: (v) => fmtNum(v) },
  { key: 'thanhtien', label: 'Thành tiền', align: 'right', mono: true, text: (r) => toNum(r.thanhtien), render: (v) => fmtNum(v) },
  { key: 'nhomthau', label: 'Nhóm thầu', filter: 'select', align: 'center' },
  { key: 'nhasx', label: 'Nhà SX', width: 220, truncateAt: 72 },
  { key: 'nuocsx', label: 'Nước SX', filter: 'select' },
  { key: 'ma_tinh', label: 'Mã tỉnh', mono: true, filter: 'select' },
  { key: 'ten_tinh', label: 'Tỉnh / TP', width: 130, filter: 'select' },
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

function filterStatic(items, f) {
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
  return sortByDateDesc(out, ['congbo', 'tungay_hd', 'tungay', 'denngay_hd', 'created_date'])
}

function VssFieldGrid({ draft, setF, placeOpts, fieldSuggest, onCommit }) {
  return (
    <div
      className="filter-grid tight cols-4"
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || e.nativeEvent?.isComposing) return
        if (e.target?.tagName === 'BUTTON') return
        if (e.target?.closest?.('.multi-select')) return
        onCommit()
      }}
    >
      <SuggestField label="Hoạt chất" value={draft.hoatchat} onChange={(v) => setF('hoatchat', v)} onSearch={(v) => onCommit({ hoatchat: v })} suggest={fieldSuggest('hoatchat')} />
      <SuggestField label="Số ĐK" value={draft.sodk} onChange={(v) => setF('sodk', v)} onSearch={(v) => onCommit({ sodk: v })} suggest={fieldSuggest('sodk')} />
      <MultiSelectField
        label="Nhóm thầu"
        value={draft.nhomthau}
        onChange={(v) => setF('nhomthau', v)}
        options={['N1', 'N2', 'N3', 'N4', 'N5']}
      />
      <MultiSelectField label="Đường dùng" value={draft.duongdung} onChange={(v) => setF('duongdung', v)} suggest={fieldSuggest('duongdung')} placeholder="Chọn đường dùng…" />
      <MultiSelectField label="Tỉnh / TP" value={draft.ten_tinh} onChange={(v) => setF('ten_tinh', v)} options={placeOpts.ten_tinh} placeholder="Chọn tỉnh…" />
      <MultiSelectField
        label="Năm hiệu lực"
        value={draft.nam}
        onChange={(v) => setF('nam', v)}
        options={Array.from({ length: 4 }, (_, i) => String(new Date().getFullYear() - i))}
        placeholder="Chọn năm…"
      />
      <Field label="HĐ từ ngày"><input type="date" value={draft.tuNgay} onChange={(e) => setF('tuNgay', e.target.value)} /></Field>
      <Field label="HĐ đến ngày"><input type="date" value={draft.denNgay} onChange={(e) => setF('denNgay', e.target.value)} /></Field>
      <MultiSelectField label="Nước sản xuất" value={draft.nuocsx} onChange={(v) => setF('nuocsx', v)} suggest={fieldSuggest('nuocsx')} placeholder="Chọn nước…" />
      <MultiSelectField label="Loại thầu" value={draft.loai_thau} onChange={(v) => setF('loai_thau', v)} suggest={fieldSuggest('loai_thau')} placeholder="vd: thau_tinh…" />
      <MultiSelectField label="Mã tỉnh" value={draft.ma_tinh} onChange={(v) => setF('ma_tinh', v)} options={placeOpts.ma_tinh} placeholder="Chọn mã tỉnh…" />
    </div>
  )
}

export default function VssSection({ localMode, embedded = false, filtersInModal = false }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [columnFilters, setColumnFilters] = useState({})
  const [filtersRow, setFiltersRow] = useState(false)
  const [filterModalOpen, setFilterModalOpen] = useState(false)
  const [compactFilters, setCompactFilters] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 900px)').matches)
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT)
  const [page, setPage] = useState(0)
  const [data, setData] = useState({ total: null, hasMore: false, items: [] })
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportAllOpen, setExportAllOpen] = useState(false)
  const [exportPct, setExportPct] = useState(0)
  const [err, setErr] = useState('')
  const [infoNote, setInfoNote] = useState('')
  const [detail, setDetail] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [loadPct, setLoadPct] = useState(null)
  const [metricsTotal, setMetricsTotal] = useState(null)
  const [metricsSample, setMetricsSample] = useState(null)
  const [metricsCards, setMetricsCards] = useState(null)
  const [metricsProvinces, setMetricsProvinces] = useState(null)
  const [metricsLoading, setMetricsLoading] = useState(false)
  const [tableReady, setTableReady] = useState(false)
  const [metricActiveId, setMetricActiveId] = useState(null)
  const [metricQuick, setMetricQuick] = useState(null)
  const [cardKey, setCardKey] = useState('')
  const [cardStats, setCardStats] = useState(null)
  const [cardError, setCardError] = useState('')
  const modalFilters = filtersInModal || compactFilters
  const sim = useLoadProgress(loading, 'Đang lọc BHYT VSS', loadPct)
  const sel = useSelection()
  const reqSeq = useRef(0)
  const sawTableLoad = useRef(false)
  useEffect(() => () => { reqSeq.current += 1 }, [])
  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 900px)')
    if (!media) return undefined
    const apply = () => setCompactFilters(media.matches)
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [])
  const meta = useSectionMeta('vss', localMode, null, refreshKey)


  const cols = ALL_COLS

  const filtersRef = useRef(filters)
  const columnFiltersRef = useRef(columnFilters)
  const pageSizeRef = useRef(pageSize)
  const pageRef = useRef(0)
  const cursorsByPageRef = useRef(new Map([[0, null]]))
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
    const active = { ...mergedFilters(cf), ...(override || {}), loai: 'Tân dược' }
    setCardKey(JSON.stringify(active))
    if (skipShortTextSearch(active, VSS_TEXT_KEYS, { ...EMPTY_FILTERS, loai: 'Tân dược' })) {
      setInfoNote(SHORT_SEARCH_NOTE)
      setLoading(false)
      return
    }
    setLoading(true)
    setErr('')
    setInfoNote('')
    try {
      const useRemote = localMode || supabaseConfigured
      if (useRemote) {
        if (p === 0) cursorsByPageRef.current = new Map([[0, null]])
        const cursor = cursorsByPageRef.current.get(p)
        if (p > 0 && cursor === undefined) throw new Error('Trang này chưa được tải. Hãy bấm Trang sau để xem tiếp.')
        const searchFn = localMode
          ? (page, sz, nextCursor) => api.vssSearch({ filters: active, page, size: sz, cursor: nextCursor })
          : (page, sz, nextCursor) => cloudVssSearch({ filters: active, page, size: sz, cursor: nextCursor })
        const res = await searchFn(p, size, cursor)
        if (stale()) return
        pageRef.current = p
        cursorsByPageRef.current.set(p + 1, res.nextCursor || null)
        setData({ ...res, total: null })
        setPage(p)
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
  }, [localMode, mergedFilters, embedded])

  // Metrics: cloud aggregate after first table paint; local page-backfill
  useEffect(() => {
    if (embedded) return
    if (loading) sawTableLoad.current = true
    else if (sawTableLoad.current) setTableReady(true)
  }, [embedded, loading])

  useEffect(() => {
    search(0)
  }, [pageSize]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (embedded || !cardKey) return undefined
    let cancelled = false
    const filters = JSON.parse(cardKey)
    setCardError('')
    setCardStats(null)
    const load = localMode ? api.metricsMap : cloudMap
    load({
      source: 'vss',
      months: 12,
      dots: false,
      ingredients: false,
      filters,
    })
      .then((payload) => { if (!cancelled) setCardStats(payload?.summary && payload.summary.value != null ? payload.summary : null) })
      .catch((err) => { if (!cancelled) { setCardStats(null); setCardError(String(err?.message || err || 'Chưa tính được số liệu.')) } })
    return () => { cancelled = true }
  }, [localMode, embedded, cardKey])

  const draftRef = useRef(null)
  const applyDraft = useCallback((override) => {
    const next = draftRef.current?.commit(override) || { ...filtersRef.current, ...(override || {}) }
    filtersRef.current = { ...next, loai: 'Tân dược' }
    setFilters(filtersRef.current)
    search(0)
  }, [search])
  const clearDraft = useCallback(() => {
    draftRef.current?.reset(EMPTY_FILTERS)
    filtersRef.current = EMPTY_FILTERS
    setFilters(EMPTY_FILTERS)
    columnFiltersRef.current = {}
    setColumnFilters({})
    search(0, {}, EMPTY_FILTERS)
  }, [search])
  const setCF = (k, v) => {
    const next = { ...columnFiltersRef.current, [k]: v }
    columnFiltersRef.current = next
    setColumnFilters(next)
  }
  const searchColumn = useCallback((key, value) => {
    const next = { ...columnFiltersRef.current, [key]: value }
    columnFiltersRef.current = next
    setColumnFilters(next)
    search(0, next)
  }, [search])
  const runSearch = useCallback((override) => search(0, undefined, override || null), [search])
  const activeCF = Object.values(columnFilters).filter((v) => String(v ?? '').trim()).length

  const [placeOpts, setPlaceOpts] = useState({ ten_tinh: [], ma_tinh: [] })
  useEffect(() => {
    loadSuggestStatic()
      .then((doc) => setPlaceOpts({
        ten_tinh: doc?.vss?.ten_tinh || [],
        ma_tinh: doc?.vss?.ma_tinh || [],
      }))
      .catch(() => {})
  }, [])

  const fieldSuggest = useCallback((fieldKey) => async (q) => {
    const needle = String(q || '').trim()
    if (needle.length < 2) return []
    try {
      if (localMode) {
        const res = await api.suggest('vss', fieldKey, needle)
        return (res?.items || []).filter(Boolean).slice(0, 8)
      }
      if (!supabaseConfigured) return []
      return cloudSuggest('vss', fieldKey, needle)
    } catch { return [] }
  }, [localMode])

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
      : (p, size, cursor) => cloudVssSearch({ filters: mergedFilters(), page: p, size, cursor })
    if (!localMode && !supabaseConfigured) return []
    return fetchAllPages(searchFn, { onProgress: setExportPct })
  }, [localMode, mergedFilters, embedded])

  const runExport = async (selectedRows) => {
    setExportAllOpen(false)
    setErr('')
    setExporting(true)
    setExportPct(5)
    try {
      const n = await exportSelectionOrAll({
        columns: cols, selected: selectedRows, fetchAll, filename: 'VSS_BHYT_trung_thau', sheetName: 'VSS', columnFilters,
      })
      if (!n) setErr('Không có dòng nào để xuất.')
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setExporting(false)
    }
  }

  const doExport = () => {
    if (sel.size > 0) {
      runExport(sel.selected)
      return
    }
    setErr('')
    setExportAllOpen(true)
  }

  return (
    <div className={`section lookup-section${embedded ? ' embedded' : ''}`}>
      {!embedded && (
        <header className="section-head">
          <div>
            <span className="kicker">Bảo hiểm xã hội Việt Nam · Kết quả đấu thầu thuốc</span>
            <h1>Thuốc trúng thầu BHYT (VSS)</h1>
            <p>Danh mục kết quả lựa chọn nhà thầu thuốc BHYT (Tân dược) — lọc theo nhóm thầu, SĐK và thời hạn hợp đồng.</p>
          </div>
          <UpdatedNote updated={meta.updated} count={meta.count} />
        </header>
      )}

      <div className="panel">
        <div className="filters">
          <div className={embedded ? 'vss-board' : 'vss-workspace'}>
            <FilterDraft ref={draftRef} applied={filters}>
              {(draft, setF) => {
                const detailActive = ['duongdung', 'ma_tinh', 'ten_tinh', 'nuocsx', 'loai_thau', 'nhomthau', 'hoatchat', 'sodk', 'tuNgay', 'denNgay', 'nam']
                  .filter((k) => {
                    const v = draft[k]
                    if (Array.isArray(v)) return v.length > 0
                    return String(v ?? '').trim() !== ''
                  }).length
                return (
                  <>
                    <div className="filters-left compact-fields">
                      {!modalFilters && (
                        <VssFieldGrid draft={draft} setF={setF} placeOpts={placeOpts} fieldSuggest={fieldSuggest} onCommit={applyDraft} />
                      )}
                      <div className="filter-actions">
                        {modalFilters && (
                          <button
                            type="button"
                            className={`btn ghost${detailActive ? ' on' : ''}`}
                            onClick={() => setFilterModalOpen(true)}
                          >
                            {Icons.filter} Bộ lọc chi tiết
                            {detailActive > 0 && <span className="pill">{detailActive}</span>}
                          </button>
                        )}
                        <button type="button" className="btn" onClick={() => applyDraft()}>{Icons.search} Tìm kiếm</button>
                        <button type="button" className="btn secondary" onClick={clearDraft}>Xóa lọc</button>
                      </div>
                    </div>
                    <FilterModal
                      open={modalFilters && filterModalOpen}
                      onClose={() => setFilterModalOpen(false)}
                      onApply={() => applyDraft()}
                    >
                      <VssFieldGrid draft={draft} setF={setF} placeOpts={placeOpts} fieldSuggest={fieldSuggest} onCommit={applyDraft} />
                    </FilterModal>
                  </>
                )
              }}
            </FilterDraft>
            {!embedded && (
              <aside className="vss-side" aria-label="Chỉ số BHYT VSS">
                {cardError && !cardStats
                  ? <p className="info-note" role="status">{cardError}</p>
                  : (
                    <StatCards
                      stats={cardStats}
                      pending={!cardStats}
                      months={12}
                      showGroups={false}
                      hideHeader
                    />
                  )}
              </aside>
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
          onClearColumnFilters={() => { columnFiltersRef.current = {}; setColumnFilters({}); search(0, {}) }}
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
          onFilterEnter={searchColumn}
          onFilterSuggest={async (key, q) => fieldSuggest(key)(q)}
          onRowDoubleClick={setDetail}
          loading={loading}
          emptyText="Không có dữ liệu — import Excel hoặc crawl VSS trong mục Dữ liệu"
          emptyAction={(
            <button type="button" className="btn" onClick={() => runSearch()}>
              {Icons.refresh} Tìm kiếm lại
            </button>
          )}
          cardKeys={['hoatchat', 'sodk', 'ten', 'thanhtien', 'ten_tinh']}
          minWidth={embedded ? 720 : 1100}
        />
        <Pagination
          page={page}
          size={pageSizeNum}
          total={data.total}
          hasMore={data.hasMore}
          shown={rows.length}
          onPage={(p) => search(p)}
          pageSize={pageSize}
          onPageSize={(v) => { setPageSize(v); setPage(0) }}
          extra={sel.size > 0 && <span className="chip">{sel.size} dòng đã chọn</span>}
          cursorOnly
        />
      </div>

      <Modal
        open={exportAllOpen}
        onClose={() => setExportAllOpen(false)}
        title="Xuất Excel"
        width={460}
        footer={(
          <>
            <div className="spacer" />
            <button type="button" className="btn secondary" onClick={() => setExportAllOpen(false)}>Không</button>
            <button type="button" className="btn" onClick={() => runExport(new Map())}>Xuất toàn bộ</button>
          </>
        )}
      >
        <p style={{ margin: 0 }}>Bạn chưa chọn dòng nào. Bạn muốn xuất toàn bộ dữ liệu vừa tìm kiếm? File gồm sheet VSS và sheet Heatmap theo bộ lọc đang xem.</p>
      </Modal>

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
