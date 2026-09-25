import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, applyClientFilters, containsWords, fmtDate, fmtDateTime, sortByDateDesc } from './api'
import { cloudMeta, cloudMscSearch, supabaseConfigured } from './supabaseCloud'
import { useAuth } from './auth'
import {
  DataTable, DetailModal, ErrorNote, Field, FilterModal, Icons, MultiSelectField, IngredientText, LoadingOverlay, Pagination,
  SuggestField, TableToolbar, UpdatedNote, applyColumnFilters, exportSelectionOrAll, fetchAllPages, resolvePageSize,
  serverFilters, useSectionMeta, useSelection, useLoadProgress, } from './components'
import { loadUserJson, saveUserJson, userKeyPart } from './userPrefs'
import { MscPriceMetrics, MscTenderMetrics, applyMetricQuick } from './metrics'

const PAGE_SIZE_DEFAULT = 100
const METRICS_CAP = 2000
const money = (v) => (typeof v === 'number' ? v.toLocaleString('vi-VN') : v ?? '')

const PRICE_COLS = [
  { key: 'name', label: 'Tên thuốc', width: 160 },
  { key: 'ingredient', label: 'Hoạt chất', width: 200, render: (v) => <IngredientText text={v} /> },
  { key: 'strength', label: 'Hàm lượng', width: 130 },
  { key: 'registration', label: 'SĐK', mono: true, nowrap: true },
  { key: 'unit_price', label: 'Đơn giá', align: 'right', mono: true, text: (r) => money(r.unit_price) },
  { key: 'quantity', label: 'SL', align: 'right', mono: true, text: (r) => money(r.quantity) },
  { key: 'unit', label: 'ĐVT', filter: 'select' },
  { key: 'group_name', label: 'Nhóm', filter: 'select', align: 'center' },
  { key: 'manufacturer', label: 'NSX', width: 170 },
  { key: 'country', label: 'Nước', filter: 'select' },
  { key: 'buyer', label: 'Bệnh viện / CĐT', width: 170 },
  { key: 'province', label: 'Tỉnh', filter: 'select' },
  { key: 'tender_no', label: 'TBMT', mono: true, nowrap: true },
  { key: 'published', label: 'Ngày KQLCNT', nowrap: true, text: (r) => fmtDate(r.published), render: (v) => fmtDate(v) },
]

const TENDER_COLS = [
  { key: 'tender_no', label: 'Mã TBMT', mono: true, nowrap: true },
  { key: 'name', label: 'Tên gói', width: 260 },
  { key: 'buyer', label: 'Chủ đầu tư', width: 200 },
  { key: 'province', label: 'Tỉnh', filter: 'select' },
  { key: 'published', label: 'Ngày đăng', nowrap: true, text: (r) => fmtDateTime(r.published), render: (v) => fmtDateTime(v) },
  { key: 'close_date', label: 'Đóng thầu', nowrap: true, text: (r) => fmtDateTime(r.close_date), render: (v) => fmtDateTime(v) },
  { key: 'status_label', label: 'Trạng thái', filter: 'select', text: (r) => r.status_label || r.status_code || '', render: (v, r) => v || r.status_code || '' },
  { key: 'bid_price', label: 'Giá gói', align: 'right', mono: true, text: (r) => money(r.bid_price) },
  { key: 'bid_form', label: 'Hình thức', filter: 'select' },
]

const PRICE_DETAIL = [
  { key: 'name', label: 'Tên thuốc' }, { key: 'ingredient', label: 'Hoạt chất' }, { key: 'strength', label: 'Hàm lượng' },
  { key: 'registration', label: 'Số đăng ký' }, { key: 'registration_keys', label: 'SĐK chuẩn hóa' },
  { key: 'unit_price', label: 'Đơn giá' }, { key: 'quantity', label: 'Số lượng' }, { key: 'unit', label: 'Đơn vị tính' },
  { key: 'group_name', label: 'Nhóm thuốc' }, { key: 'medicine_type', label: 'Loại thuốc' },
  { key: 'route', label: 'Đường dùng' }, { key: 'dosage_form', label: 'Dạng bào chế' }, { key: 'packaging', label: 'Quy cách đóng gói' },
  { key: 'manufacturer', label: 'Nhà sản xuất' }, { key: 'country', label: 'Nước sản xuất' },
  { key: 'winner', label: 'Nhà thầu trúng' }, { key: 'winner_code', label: 'Mã nhà thầu' },
  { key: 'buyer', label: 'Bệnh viện / Chủ đầu tư' }, { key: 'buyer_code', label: 'Mã CĐT' }, { key: 'province', label: 'Tỉnh / TP' },
  { key: 'tender_no', label: 'Mã TBMT' }, { key: 'published', label: 'Ngày KQLCNT', text: (r) => fmtDateTime(r.published) },
  { key: 'decision', label: 'Quyết định' }, { key: 'decision_date', label: 'Ngày quyết định', text: (r) => fmtDateTime(r.decision_date) },
  { key: 'source_label', label: 'Nguồn' }, { key: 'source_url', label: 'Trang nguồn' }, { key: 'import_note', label: 'Ghi chú import' },
  { key: 'source_id', label: 'ID nguồn' }, { key: 'collected_at', label: 'Thu thập lúc', text: (r) => fmtDateTime(r.collected_at) },
]

const TENDER_DETAIL = [
  { key: 'tender_no', label: 'Mã TBMT' }, { key: 'name', label: 'Tên gói thầu' }, { key: 'buyer', label: 'Chủ đầu tư' },
  { key: 'buyer_code', label: 'Mã CĐT' }, { key: 'province', label: 'Tỉnh / TP' },
  { key: 'published', label: 'Ngày đăng', text: (r) => fmtDateTime(r.published) },
  { key: 'close_date', label: 'Thời điểm đóng thầu', text: (r) => fmtDateTime(r.close_date) },
  { key: 'status_label', label: 'Trạng thái' }, { key: 'status_code', label: 'Mã trạng thái' }, { key: 'source_status', label: 'Trạng thái nguồn' },
  { key: 'bid_price', label: 'Giá gói thầu' }, { key: 'bid_form', label: 'Hình thức LCNT' }, { key: 'plan_no', label: 'Mã KHLCNT' },
  { key: 'version', label: 'Phiên bản' }, { key: 'medicine_evidence', label: 'Dấu hiệu thuốc' },
  { key: 'source_label', label: 'Nguồn' }, { key: 'source_url', label: 'Trang nguồn' }, { key: 'source_id', label: 'ID nguồn' },
  { key: 'collected_at', label: 'Thu thập lúc', text: (r) => fmtDateTime(r.collected_at) },
]

/** Column key → server filter key (server supports these directly). */
const SERVER_MAP = {
  name: 'name', ingredient: 'ingredient', registration: 'registration', manufacturer: 'manufacturer',
  province: 'province', tender_no: 'tender_no', buyer: 'buyer', winner: 'winner', group_name: 'group_name',
  medicine_type: 'medicine_type', country: 'country',
}

const EMPTY_FILTERS = {
  q: '', name: '', ingredient: '', registration: '', manufacturer: '',
  province: '', tender_no: '', buyer: '', winner: '', group_name: '', medicine_type: '',
}

function filterStatic(items, f) {
  let out = items
  if ((f.q || '').trim()) {
    out = out.filter((r) => containsWords(Object.values(r).filter((v) => typeof v === 'string').join(' '), f.q))
  }
  out = applyClientFilters(out, [
    { value: f.name, keys: ['name'] }, { value: f.ingredient, keys: ['ingredient'] },
    { value: f.registration, keys: ['registration', 'registration_keys'] }, { value: f.manufacturer, keys: ['manufacturer'] },
    { value: f.province, keys: ['province'] }, { value: f.tender_no, keys: ['tender_no'] }, { value: f.buyer, keys: ['buyer'] },
    { value: f.winner, keys: ['winner'] }, { value: f.group_name, keys: ['group_name'] }, { value: f.medicine_type, keys: ['medicine_type'] },
  ])
  return sortByDateDesc(out, ['published', 'close_date', '_collected_at', 'collected_at'])
}

export default function MscSection({ localMode, embedded = false, filtersInModal = false }) {
  const { user } = useAuth()
  const userId = userKeyPart(user)
  const [kind, setKind] = useState('prices')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [columnFilters, setColumnFilters] = useState({})
  const [filtersRow, setFiltersRow] = useState(false)
  const [filterModalOpen, setFilterModalOpen] = useState(false)
  const [prefsReady, setPrefsReady] = useState(false)
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT)
  const [page, setPage] = useState(0)
  const [data, setData] = useState({ total: 0, items: [] })
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportPct, setExportPct] = useState(0)
  const [err, setErr] = useState('')
  const [detail, setDetail] = useState(null)
  const [staticFallback, setStaticFallback] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [loadPct, setLoadPct] = useState(null)
  const [metricsSample, setMetricsSample] = useState([])
  const [metricActiveId, setMetricActiveId] = useState(null)
  const [metricQuick, setMetricQuick] = useState(null)
  const sim = useLoadProgress(loading, 'Đang lọc thầu MSC', loadPct)
  const sel = useSelection()
  const reqSeq = useRef(0)
  const meta = useSectionMeta('msc', localMode, staticFallback, refreshKey)

  useEffect(() => {
    const saved = loadUserJson(userId, 'msc', 'session', null)
    if (saved && typeof saved === 'object') {
      if (saved.kind === 'prices' || saved.kind === 'tenders') setKind(saved.kind)
      if (saved.filters) setFilters({ ...EMPTY_FILTERS, ...saved.filters })
      if (saved.columnFilters) setColumnFilters(saved.columnFilters)
    }
    setPrefsReady(true)
  }, [userId])

  useEffect(() => {
    if (!prefsReady) return
    saveUserJson(userId, 'msc', 'session', { kind, filters, columnFilters })
  }, [userId, prefsReady, kind, filters, columnFilters])

  useEffect(() => {
    if (localMode || !supabaseConfigured) return undefined
    let alive = true
    cloudMeta('msc').then((m) => {
      if (alive && m) setStaticFallback({ updated: m.updated, count: m.count })
    }).catch(() => {})
    return () => { alive = false }
  }, [localMode])

  const cols = kind === 'prices' ? PRICE_COLS : TENDER_COLS

  const filtersRef = useRef(filters)
  const columnFiltersRef = useRef(columnFilters)
  const pageSizeRef = useRef(pageSize)
  filtersRef.current = filters
  columnFiltersRef.current = columnFilters
  pageSizeRef.current = pageSize

  const mergedFilters = useCallback(
    (cf) => ({ ...filtersRef.current, ...serverFilters(cf ?? columnFiltersRef.current, SERVER_MAP) }),
    [],
  )

  const search = useCallback(async (p = 0, cf, override = null) => {
    const id = ++reqSeq.current
    const stale = () => id !== reqSeq.current
    const size = resolvePageSize(pageSizeRef.current)
    setLoading(true)
    setErr('')
    const active = { ...mergedFilters(cf), ...(override || {}) }
    try {
      if (localMode || supabaseConfigured) {
        const searchFn = localMode
          ? (page, sz) => api.mscSearch({ kind, filters: active, page, size: sz })
          : (page, sz) => cloudMscSearch({ kind, filters: active, page, size: sz })
        const res = await searchFn(p, size)
        if (stale()) return
        setData(res)
        setPage(p)
        fetchAllPages(searchFn, { size: 500, cap: METRICS_CAP }).then((all) => {
          if (!stale()) setMetricsSample(all)
        }).catch(() => { if (!stale()) setMetricsSample(res.items || []) })
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
  }, [kind, localMode, mergedFilters])

  useEffect(() => {
    if (!prefsReady) return
    sel.clear()
    setColumnFilters({})
    setMetricsSample([])
    setMetricActiveId(null)
    setMetricQuick(null)
    search(0, {})
  }, [prefsReady, kind, pageSize]) // eslint-disable-line react-hooks/exhaustive-deps

  const setF = (k, v) => setFilters((f) => ({ ...f, [k]: v }))
  const setCF = (k, v) => setColumnFilters((f) => ({ ...f, [k]: v }))
  const runSearch = useCallback((override) => search(0, undefined, override || null), [search])
  const onEnter = (e) => {
    if (e.key === 'Enter' && !e.nativeEvent?.isComposing) runSearch()
  }
  const activeCF = Object.values(columnFilters).filter((v) => String(v ?? '').trim()).length
  const detailActive = Object.entries(filters).filter(([k, v]) => k !== 'q' && String(v ?? '').trim()).length

  const fieldSuggest = useCallback((fieldKey) => async (q) => {
    const needle = String(q || '').trim()
    if (needle.length < 1) return []
    try {
      let items = []
      if (localMode || supabaseConfigured) {
        const res = localMode
          ? await api.mscSearch({ kind, filters: { ...mergedFilters(), [fieldKey]: needle, q: '' }, page: 0, size: 30 })
          : await cloudMscSearch({ kind, filters: { ...mergedFilters(), [fieldKey]: needle, q: '' }, page: 0, size: 30 })
        items = res?.items || []
      }
      const seen = new Set()
      const out = []
      for (const r of items) {
        const t = String(fieldKey === 'q' ? (r.name || r.ingredient || r.registration || '') : (r[fieldKey] || '')).trim()
        if (!t || seen.has(t)) continue
        seen.add(t)
        out.push(t)
        if (out.length >= 3) break
      }
      return out
    } catch { return [] }
  }, [localMode, kind, mergedFilters])

  const rows = useMemo(() => {
    let list = applyColumnFilters(data.items, cols, columnFilters)
    list = applyMetricQuick(list, metricQuick, kind === 'tenders' ? 'msc_tenders' : 'msc_prices')
    return list
  }, [data.items, cols, columnFilters, metricQuick, kind])
  const rowKey = useCallback((r, i) => String(r.source_id || r.tender_no || `${page}-${i}`), [page])
  const pageSizeNum = resolvePageSize(pageSize)
  const metricsItems = metricsSample.length ? metricsSample : (rows.length ? rows : data.items)

  const onMetricFilter = useCallback((patch, id) => {
    if (metricActiveId === id) {
      setMetricActiveId(null)
      setMetricQuick(null)
      return
    }
    setMetricActiveId(id)
    if (patch?._quick) {
      setMetricQuick(patch._quick)
      return
    }
    const { _quick, ...rest } = patch || {}
    if (!Object.keys(rest).length) return
    setFilters((f) => ({ ...f, ...rest }))
    setMetricQuick(null)
    search(0, undefined, rest)
  }, [metricActiveId, search])

  const fetchAll = useCallback(async () => {
    if (!localMode && !supabaseConfigured) return []
    const searchFn = localMode
      ? (p, size) => api.mscSearch({ kind, filters: mergedFilters(), page: p, size })
      : (p, size) => cloudMscSearch({ kind, filters: mergedFilters(), page: p, size })
    return fetchAllPages(searchFn, { onProgress: setExportPct })
  }, [localMode, kind, mergedFilters])

  const doExport = async () => {
    setExporting(true)
    setExportPct(5)
    try {
      const n = await exportSelectionOrAll({
        columns: cols, selected: sel.selected, fetchAll, columnFilters,
        filename: kind === 'prices' ? 'MSC_don_gia' : 'MSC_goi_thau', sheetName: kind === 'prices' ? 'Don gia' : 'Goi thau',
      })
      if (!n) setErr('Không có dòng nào để xuất.')
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setExporting(false)
    }
  }

  const secondaryGrid = (
    <div className={`filter-grid tight ${kind === 'prices' ? 'cols-5' : 'cols-4'}`}>
      {kind === 'prices' ? (
        <>
          <SuggestField label="Tên thuốc" value={filters.name} onChange={(v) => setF('name', v)} onSearch={(v) => runSearch({ name: v })} suggest={fieldSuggest('name')} />
          <SuggestField label="Hoạt chất" value={filters.ingredient} onChange={(v) => setF('ingredient', v)} onSearch={(v) => runSearch({ ingredient: v })} suggest={fieldSuggest('ingredient')} />
          <SuggestField label="SĐK" value={filters.registration} onChange={(v) => setF('registration', v)} onSearch={(v) => runSearch({ registration: v })} suggest={fieldSuggest('registration')} />
          <SuggestField label="Nhà sản xuất" value={filters.manufacturer} onChange={(v) => setF('manufacturer', v)} onSearch={(v) => runSearch({ manufacturer: v })} suggest={fieldSuggest('manufacturer')} />
          <MultiSelectField label="Nhóm" value={filters.group_name} onChange={(v) => setF('group_name', v)} options={['1', '2', '3', '4', '5']} />
          <MultiSelectField label="Loại thuốc" value={filters.medicine_type} onChange={(v) => setF('medicine_type', v)} suggest={fieldSuggest('medicine_type')} />
          <SuggestField label="Nhà thầu" value={filters.winner} onChange={(v) => setF('winner', v)} onSearch={(v) => runSearch({ winner: v })} suggest={fieldSuggest('winner')} />
        </>
      ) : (
        <SuggestField label="Tên gói" value={filters.name} onChange={(v) => setF('name', v)} onSearch={(v) => runSearch({ name: v })} suggest={fieldSuggest('name')} />
      )}
      <SuggestField label="TBMT" value={filters.tender_no} onChange={(v) => setF('tender_no', v)} onSearch={(v) => runSearch({ tender_no: v })} suggest={fieldSuggest('tender_no')} placeholder="IB…" />
      <MultiSelectField label="Tỉnh / TP" value={filters.province} onChange={(v) => setF('province', v)} suggest={fieldSuggest('province')} />
      <MultiSelectField label="Bệnh viện / CĐT" value={filters.buyer} onChange={(v) => setF('buyer', v)} suggest={fieldSuggest('buyer')} />
    </div>
  )

  return (
    <div className={`section${embedded ? ' embedded' : ''}`}>
      {!embedded && (
        <header className="section-head">
          <div>
            <span className="kicker">Hệ thống mạng đấu thầu quốc gia · muasamcong.mpi.gov.vn</span>
            <h1>Tra cứu thầu MSC</h1>
            <p>Đơn giá trúng thầu và gói thầu thuốc. Nhấp đôi một dòng để xem đầy đủ trường và mở trang nguồn.</p>
          </div>
          <UpdatedNote updated={meta.updated} count={meta.count} />
        </header>
      )}

      <div className="panel">
        <div className="filters">
          <div className={`filters-split${embedded ? ' no-stats' : ''}`}>
            <div className="filters-left">
              <div className="filter-top">
                <div className="segmented" role="tablist" aria-label="Loại dữ liệu">
                  <button type="button" role="tab" aria-selected={kind === 'prices'} className={kind === 'prices' ? 'on' : ''} onClick={() => setKind('prices')}>Đơn giá</button>
                  <button type="button" role="tab" aria-selected={kind === 'tenders'} className={kind === 'tenders' ? 'on' : ''} onClick={() => setKind('tenders')}>Gói thầu</button>
                </div>
              </div>
              <div className="filter-keyword">
                <SuggestField label="Từ khóa" value={filters.q} onChange={(v) => setF('q', v)} onSearch={(v) => runSearch({ q: v })} suggest={fieldSuggest('q')} placeholder="Tìm trong mọi trường" />
              </div>
              {!filtersInModal && secondaryGrid}
              <div className="filter-actions">
                {filtersInModal && (
                  <button type="button" className={`btn ghost${detailActive ? ' on' : ''}`} onClick={() => setFilterModalOpen(true)}>
                    {Icons.filter} Bộ lọc chi tiết
                    {detailActive > 0 && <span className="pill">{detailActive}</span>}
                  </button>
                )}
                <button type="button" className="btn" onClick={() => runSearch()}>{Icons.search} Tìm kiếm</button>
                <button type="button" className="btn secondary" onClick={() => { setFilters(EMPTY_FILTERS); setColumnFilters({}) }}>Xóa lọc</button>
              </div>
            </div>
            {!embedded && (kind === 'prices'
              ? <MscPriceMetrics items={metricsItems} total={data.total} activeId={metricActiveId} onFilter={onMetricFilter} />
              : <MscTenderMetrics items={metricsItems} total={data.total} activeId={metricActiveId} onFilter={onMetricFilter} />)}
          </div>
        </div>

        <TableToolbar
          kicker={kind === 'prices' ? 'Kết quả lựa chọn nhà thầu' : 'Thông báo mời thầu'}
          title={embedded ? (kind === 'prices' ? 'MSC · Đơn giá' : 'MSC · Gói thầu') : (kind === 'prices' ? 'Đơn giá thuốc trúng thầu' : 'Gói thầu thuốc')}
          selectedCount={sel.size}
          onClearSelection={sel.clear}
          onExport={doExport}
          exporting={exporting}
          filtersVisible={filtersRow}
          onToggleFilters={() => setFiltersRow((v) => !v)}
          activeColumnFilters={activeCF}
          onClearColumnFilters={() => { setColumnFilters({}); search(0, {}) }}
        >
          <button type="button" className="btn ghost sm" onClick={() => runSearch()}>{Icons.refresh} Quét lại</button>
        </TableToolbar>
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
          emptyText="Không có dữ liệu phù hợp"
          emptyAction={(
            <button type="button" className="btn" onClick={() => runSearch()}>
              {Icons.refresh} Tìm kiếm lại
            </button>
          )}
          cardKeys={kind === 'prices'
            ? ['name', 'registration', 'unit_price', 'province', 'winner']
            : ['name', 'tender_no', 'buyer', 'bid_price', 'close_date']}
          minWidth={embedded ? 720 : (kind === 'prices' ? 1400 : 1100)}
          trailing={{
            label: 'Nguồn',
            render: (row) => row.source_url ? (
              <a className="icon-btn accent" href={row.source_url} target="_blank" rel="noopener noreferrer" title="Mở trang nguồn">{Icons.external}</a>
            ) : null,
          }}
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

      <FilterModal open={filtersInModal && filterModalOpen} onClose={() => setFilterModalOpen(false)} onApply={() => runSearch()}>
        {secondaryGrid}
      </FilterModal>

      <DetailModal
        row={detail}
        fields={kind === 'prices' ? PRICE_DETAIL : TENDER_DETAIL}
        title={detail?.name || detail?.tender_no || 'Chi tiết'}
        subtitle={detail ? (kind === 'prices' ? `Đơn giá trúng thầu · TBMT ${detail.tender_no || '—'}` : `Gói thầu · ${detail.tender_no || ''}`) : ''}
        onClose={() => setDetail(null)}
        renderValue={(f, row, val) => {
          if (f.key === 'ingredient') return <IngredientText text={row.ingredient} />
          if (f.key === 'source_url' && row.source_url) return <a href={row.source_url} target="_blank" rel="noopener noreferrer" className="link-break">{row.source_url}</a>
          return val
        }}
      />
      <LoadingOverlay show={loading} percent={sim.percent} message={sim.message} etaSec={sim.etaSec} onCancel={() => { reqSeq.current += 1; setLoading(false) }} />
      <LoadingOverlay show={exporting} percent={exportPct} message="Đang gom dữ liệu để xuất Excel…" onCancel={() => setExporting(false)} />
    </div>
  )
}
