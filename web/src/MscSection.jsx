import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, applyClientFilters, containsWords, fmtDate, fmtDateTime, SHORT_SEARCH_NOTE, skipShortTextSearch, sortByDateDesc } from './api'
import { cloudMatchReport, cloudMetricsSlice, cloudMscSearch, cloudSuggest, supabaseConfigured } from './supabaseCloud'
import { loadSuggestStatic } from './suggestClient'
import { FilterDraft } from './filterDraft'
import {
  DataTable, DetailModal, ErrorNote, Field, FilterModal, Icons, MultiSelectField, IngredientText, LoadingOverlay, Pagination,
  SuggestField, TableToolbar, UpdatedNote, applyColumnFilters, exportSelectionOrAll, fetchAllPages, resolvePageSize,
  serverFilters, useSectionMeta, useSelection, useLoadProgress, } from './components'
import { focusBaoAn, readCompare, requestCompare } from './compare'
import { MscPriceMetrics, MscTenderMetrics, applyMetricQuick, mscStatusDisplay } from './metrics'
import { exportMatchWorkbook } from './matchExport'
import { StatusBadge, resolveBidStatusFromRow } from './bidStatus'

const PAGE_SIZE_DEFAULT = 100
const MSC_TEXT_KEYS = ['q', 'name', 'ingredient', 'dosage_form', 'registration', 'manufacturer', 'tender_no', 'winner']
const money = (v) => (typeof v === 'number' ? v.toLocaleString('vi-VN') : v ?? '')

const PRICE_COLS = [
  { key: 'name', label: 'Tên thuốc', width: 160, truncateAt: 72 },
  { key: 'ingredient', label: 'Hoạt chất', width: 200, render: (v) => <IngredientText text={v} /> },
  { key: 'route', label: 'Đường dùng', width: 100, filter: 'select' },
  { key: 'dosage_form', label: 'Dạng bào chế', width: 130, filter: 'select', truncateAt: 48 },
  { key: 'strength', label: 'Hàm lượng', width: 130, truncateAt: 64 },
  { key: 'registration', label: 'SĐK', mono: true, nowrap: true },
  { key: 'unit_price', label: 'Đơn giá', nowrap: true, align: 'right', mono: true, text: (r) => money(r.unit_price) },
  { key: 'quantity', label: 'SL', nowrap: true, align: 'right', mono: true, text: (r) => money(r.quantity) },
  { key: 'unit', label: 'ĐVT', width: 65, filter: 'select' },
  { key: 'group_name', label: 'Nhóm', nowrap: true, filter: 'select', align: 'center' },
  { key: 'manufacturer', label: 'NSX', width: 170, truncateAt: 72 },
  { key: 'country', label: 'Nước', width: 90, filter: 'select' },
  { key: 'buyer', label: 'Bệnh viện / CĐT', width: 170, truncateAt: 72 },
  { key: 'province', label: 'Tỉnh', width: 130, filter: 'select' },
  { key: 'tender_no', label: 'TBMT', mono: true, nowrap: true },
  { key: 'published', label: 'Ngày KQLCNT', nowrap: true, text: (r) => fmtDate(r.published), render: (v) => fmtDate(v) },
]

function MatchDot({ level }) {
  if (level !== 'exact' && level !== 'near') return null
  const title = level === 'exact' ? 'Có đầu thuốc khớp!' : 'Có đầu thuốc gần khớp'
  return <span className={`match-dot ${level}`} title={title} aria-label={title}>!</span>
}

const TENDER_COLS = [
  { key: 'tender_no', label: 'Mã TBMT', mono: true, nowrap: true },
  { key: 'name', label: 'Tên gói', width: 260, truncateAt: 96, render: (v, r) => <span className="tender-name"><MatchDot level={r.baoan_match} />{v}</span> },
  { key: 'buyer', label: 'Chủ đầu tư', width: 200, truncateAt: 80 },
  { key: 'province', label: 'Tỉnh', filter: 'select' },
  { key: 'published', label: 'Ngày đăng', nowrap: true, text: (r) => fmtDateTime(r.published), render: (v) => fmtDateTime(v) },
  { key: 'close_date', label: 'Đóng thầu', nowrap: true, text: (r) => fmtDateTime(r.close_date), render: (v) => fmtDateTime(v) },
  { key: 'status_label', label: 'Trạng thái', filter: 'select', text: (r) => mscStatusDisplay(r), render: (_v, r) => <StatusBadge row={r} /> },
  { key: 'bid_price', label: 'Giá gói', align: 'right', mono: true, text: (r) => money(r.bid_price) },
  { key: 'bid_form', label: 'Hình thức', filter: 'select' },
]

const PRICE_DETAIL = [
  { key: 'name', label: 'Tên thuốc' }, { key: 'ingredient', label: 'Hoạt chất' }, { key: 'strength', label: 'Hàm lượng' },
  { key: 'registration', label: 'Số đăng ký' },
  { key: 'unit_price', label: 'Đơn giá' }, { key: 'quantity', label: 'Số lượng' }, { key: 'unit', label: 'Đơn vị tính' },
  { key: 'group_name', label: 'Nhóm thuốc' }, { key: 'medicine_type', label: 'Loại thuốc' },
  { key: 'manufacturer', label: 'Nhà sản xuất' }, { key: 'country', label: 'Nước sản xuất' },
  { key: 'winner', label: 'Nhà thầu trúng' },
  { key: 'buyer', label: 'Bệnh viện / Chủ đầu tư' }, { key: 'province', label: 'Tỉnh / TP' },
  { key: 'tender_no', label: 'Mã TBMT' }, { key: 'published', label: 'Ngày KQLCNT', text: (r) => fmtDateTime(r.published) },
  { key: 'source_url', label: 'Trang nguồn' },
]

const TENDER_DETAIL = [
  { key: 'tender_no', label: 'Mã TBMT' }, { key: 'name', label: 'Tên gói thầu' }, { key: 'buyer', label: 'Chủ đầu tư' },
  { key: 'province', label: 'Tỉnh / TP' },
  { key: 'published', label: 'Ngày đăng', text: (r) => fmtDateTime(r.published) },
  { key: 'close_date', label: 'Thời điểm đóng thầu', text: (r) => fmtDateTime(r.close_date) },
  { key: 'status_label', label: 'Trạng thái' }, { key: 'status_code', label: 'Mã trạng thái' },
  { key: 'bid_price', label: 'Giá gói thầu' }, { key: 'bid_form', label: 'Hình thức LCNT' },
  { key: 'source_url', label: 'Trang nguồn' },
]

/** Column key → server filter key (server supports these directly). */
const SERVER_MAP = {
  name: 'name', ingredient: 'ingredient', dosage_form: 'dosage_form', registration: 'registration', manufacturer: 'manufacturer',
  province: 'province', tender_no: 'tender_no', buyer: 'buyer', winner: 'winner', group_name: 'group_name',
  medicine_type: 'medicine_type', country: 'country',
}

const EMPTY_FILTERS = {
  q: '', name: '', ingredient: '', dosage_form: '', registration: '', manufacturer: '',
  province: [], tender_no: '', buyer: [], winner: '', group_name: [], medicine_type: [], country: [], metricQuick: '', metricMonths: 12,
}

function hitRegs(row) {
  return [...new Set((row?.hits || []).map((hit) => hit.reg).filter(Boolean))]
}

function ScopeCatalog({ lines, tenderNo, embedded = false }) {
  const [tip, setTip] = useState(null)
  const [ask, setAsk] = useState(null)
  const [copied, setCopied] = useState('')
  const [matchedOnly, setMatchedOnly] = useState(false)
  if (!Array.isArray(lines)) {
    return <p className="muted small scope-empty">Chưa có danh mục thuốc của gói này trong hồ sơ đã tải. Quét lại tại Quản trị → Hồ sơ gói đang mở.</p>
  }
  if (!lines.length) return <p className="muted small scope-empty">Hồ sơ đã tải nhưng không có dòng thuốc.</p>
  const exact = lines.filter((row) => row.match === 'exact').length
  const near = lines.filter((row) => row.match === 'near').length
  const visible = matchedOnly
    ? [...lines.filter((row) => row.match === 'exact'), ...lines.filter((row) => row.match === 'near')]
    : lines
  const regs = hitRegs(ask)
  const copyRegs = async () => {
    const text = regs.join('\n')
    if (!text) { setCopied('Dòng này chưa có số đăng ký Bảo An.'); return }
    try {
      await navigator.clipboard.writeText(text)
      setCopied(regs.length > 1 ? `Đã copy ${regs.length} SĐK.` : `Đã copy SĐK ${text}.`)
    } catch {
      setCopied(text)
    }
  }
  return (
    <section className="scope-catalog">
      <div className="scope-catalog-head">
        <h4>Danh mục thuốc mời thầu</h4>
        <label className="scope-match-only">
          <input type="checkbox" checked={matchedOnly} onChange={(event) => setMatchedOnly(event.target.checked)} />
          Chỉ hiện danh mục khớp
        </label>
        <span className="muted small">{(matchedOnly ? visible.length : lines.length).toLocaleString('vi-VN')} dòng{exact ? ` · ${exact} khớp` : ''}{near ? ` · ${near} gần khớp` : ''}</span>
      </div>
      <div className="scope-legend"><i className="exact" />Khớp Bảo An<i className="near" />Gần khớp</div>
      {ask && (
        <div className="scope-ask" role="dialog" aria-label="Đối chiếu hoạt chất">
          <p>Đối chiếu <strong>{ask.name || 'hoạt chất này'}</strong> với danh mục Bảo An?</p>
          {!!regs.length && <p className="muted small">SĐK: {regs.join(', ')}</p>}
          <div className="scope-ask-actions">
            <button type="button" className="btn sm" onClick={() => requestCompare({ query: ask.name || '', regs, tenderNo })}>Mở đa khung</button>
            <button type="button" className="btn secondary sm" onClick={copyRegs}>Chỉ copy SĐK</button>
            <button type="button" className="btn ghost sm" onClick={() => { setAsk(null); setCopied('') }}>Đóng</button>
          </div>
          {copied && <p className="muted small">{copied}</p>}
        </div>
      )}
      <div className="scope-table-wrap">
        <table className="scope-table">
          <thead>
            <tr>
              <th>Mã</th><th>Hoạt chất</th><th>Hàm lượng</th><th>Dạng bào chế</th><th>Nhóm thuốc</th><th>Đường dùng</th>
              <th className="num">SL</th><th>ĐVT</th><th className="num">Đơn giá</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row, index) => {
              const matched = row.match === 'exact' || row.match === 'near'
              return (
                <tr
                  key={`${row.code || 'lot'}-${index}`}
                  className={row.match ? `is-${row.match}` : ''}
                  onClick={() => { if (matched) focusBaoAn({ regs: hitRegs(row) }) }}
                  onMouseEnter={(e) => {
                    if (!row.hits?.length) { setTip(null); return }
                    const box = e.currentTarget.getBoundingClientRect()
                    const below = box.bottom + 8
                    const above = below + 200 > window.innerHeight
                    setTip({
                      row,
                      above,
                      top: above ? box.top - 8 : below,
                      left: Math.min(Math.max(12, box.left), window.innerWidth - 392),
                    })
                  }}
                  onMouseLeave={() => setTip(null)}
                >
                  <td className="mono">{row.code || '—'}</td>
                  <td>
                    {matched ? (
                      <button
                        type="button"
                        className="scope-inn-link"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (embedded) {
                            setAsk(null)
                            focusBaoAn({ regs: hitRegs(row) })
                            return
                          }
                          setCopied('')
                          setAsk(row)
                        }}
                      >
                        {row.name || '—'}
                      </button>
                    ) : (row.name || '—')}
                  </td>
                  <td>{row.strength || '—'}</td>
                  <td>{row.form || '—'}</td>
                  <td>{row.group || '—'}</td>
                  <td>{row.route || '—'}</td>
                  <td className="num">{money(row.qty) || '—'}</td>
                  <td>{row.unit || '—'}</td>
                  <td className="num">{money(row.price) || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {matchedOnly && !visible.length && <p className="muted small scope-empty">Gói này không có dòng khớp hoặc gần khớp Bảo An.</p>}
      </div>
      {tip && createPortal(
        <div className={`scope-tip${tip.above ? ' above' : ''}`} style={{ top: tip.top, left: tip.left }}>
          <div className="scope-tip-kicker">{tip.row.match === 'exact' ? 'Khớp thuốc Bảo An' : 'Gần khớp thuốc Bảo An'}</div>
          {tip.row.hits.map((hit) => (
            <div key={`${hit.reg}-${hit.brand}`} className="scope-tip-hit">
              <strong>{hit.brand || hit.inn || 'Thuốc Bảo An'}</strong>
              {hit.brand && hit.inn ? <div>{hit.inn}</div> : null}
              <div className="muted">{[hit.strength, hit.form, hit.reg ? `SĐK ${hit.reg}` : ''].filter(Boolean).join(' · ')}</div>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </section>
  )
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

function MscFieldGrid({ draft, setF, kind, provinceOpts, fieldSuggest, onCommit }) {
  const searchField = (key) => (v) => onCommit({ [key]: v }, { metrics: false })
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
      {kind === 'prices' ? (
        <>
          <SuggestField label="Tên thuốc" value={draft.name} onChange={(v) => setF('name', v)} onSearch={searchField('name')} suggest={fieldSuggest('name')} />
          <SuggestField label="Hoạt chất" value={draft.ingredient} onChange={(v) => setF('ingredient', v)} onSearch={searchField('ingredient')} suggest={fieldSuggest('ingredient')} />
          <SuggestField label="SĐK" value={draft.registration} onChange={(v) => setF('registration', v)} onSearch={searchField('registration')} suggest={fieldSuggest('registration')} />
          <SuggestField label="Nhà sản xuất" value={draft.manufacturer} onChange={(v) => setF('manufacturer', v)} onSearch={searchField('manufacturer')} suggest={fieldSuggest('manufacturer')} />
          <MultiSelectField label="Nhóm" value={draft.group_name} onChange={(v) => setF('group_name', v)} options={['1', '2', '3', '4', '5']} />
          <MultiSelectField label="Loại thuốc" value={draft.medicine_type} onChange={(v) => setF('medicine_type', v)} suggest={fieldSuggest('medicine_type')} />
          <MultiSelectField label="Nước sản xuất" value={draft.country} onChange={(v) => setF('country', v)} suggest={fieldSuggest('country')} />
          <SuggestField label="Nhà thầu" value={draft.winner} onChange={(v) => setF('winner', v)} onSearch={searchField('winner')} suggest={fieldSuggest('winner')} />
        </>
      ) : (
        <>
          <SuggestField label="Tên gói" value={draft.name} onChange={(v) => setF('name', v)} onSearch={searchField('name')} suggest={fieldSuggest('name')} />
          <SuggestField label="Hoạt chất" value={draft.ingredient} onChange={(v) => setF('ingredient', v)} onSearch={searchField('ingredient')} suggest={fieldSuggest('ingredient')} />
          <SuggestField label="Dạng bào chế" value={draft.dosage_form} onChange={(v) => setF('dosage_form', v)} onSearch={searchField('dosage_form')} suggest={fieldSuggest('dosage_form')} />
        </>
      )}
      <SuggestField label="TBMT" value={draft.tender_no} onChange={(v) => setF('tender_no', v)} onSearch={searchField('tender_no')} suggest={fieldSuggest('tender_no')} placeholder="IB…" />
      <MultiSelectField label="Tỉnh / TP" value={draft.province} onChange={(v) => setF('province', v)} options={provinceOpts} />
      <MultiSelectField label="Bệnh viện / CĐT" value={draft.buyer} onChange={(v) => setF('buyer', v)} suggest={fieldSuggest('buyer')} />
    </div>
  )
}

export default function MscSection({ localMode, embedded = false, filtersInModal = false, selectedKind }) {
  const [kind, setKind] = useState(selectedKind || 'tenders')
  useEffect(() => { if (selectedKind) setKind(selectedKind) }, [selectedKind])
  useEffect(() => {
    loadSuggestStatic()
      .then((doc) => setProvinceOpts(doc?.msc?.province || []))
      .catch(() => {})
  }, [])
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
  const [exportPct, setExportPct] = useState(0)
  const [err, setErr] = useState('')
  const [detail, setDetail] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [loadPct, setLoadPct] = useState(null)
  const [metricsSample, setMetricsSample] = useState(null)
  const [metricsCards, setMetricsCards] = useState(null)
  const [metricsTotal, setMetricsTotal] = useState(null)
  const [metricsProvincesYoy, setMetricsProvincesYoy] = useState(null)
  const [metricsLoading, setMetricsLoading] = useState(false)
  const [provinceOpts, setProvinceOpts] = useState([])
  const [metricSlice, setMetricSlice] = useState(null)
  const [tableReady, setTableReady] = useState(false)
  const [metricActiveId, setMetricActiveId] = useState(null)
  const [metricQuick, setMetricQuick] = useState(null)
  const modalFilters = filtersInModal || compactFilters

  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 900px)')
    if (!media) return undefined
    const apply = () => setCompactFilters(media.matches)
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [])
  const sim = useLoadProgress(loading, 'Đang lọc thầu MSC', loadPct)
  const sel = useSelection()
  const reqSeq = useRef(0)
  const metricSeq = useRef(0)
  const metricKeyRef = useRef('')
  const sawTableLoad = useRef(false)
  const appliedCompare = useRef(0)
  useEffect(() => () => { reqSeq.current += 1 }, [])
  const meta = useSectionMeta('msc', localMode, null, refreshKey)


  const cols = kind === 'prices' ? PRICE_COLS : TENDER_COLS

  const filtersRef = useRef(filters)
  const columnFiltersRef = useRef(columnFilters)
  const pageSizeRef = useRef(pageSize)
  const pageRef = useRef(0)
  // Cursor for every already visited page. This supports Previous without an
  // OFFSET scan and prevents accidental jumps to page 11,000.
  const cursorsByPageRef = useRef(new Map([[0, null]]))
  filtersRef.current = filters
  columnFiltersRef.current = columnFilters
  pageSizeRef.current = pageSize

  const mergedFilters = useCallback(
    (cf) => ({ ...filtersRef.current, ...serverFilters(cf ?? columnFiltersRef.current, SERVER_MAP) }),
    [],
  )

  const loadMetrics = useCallback((active, activeKind) => {
    if (embedded) return
    if (!localMode && !supabaseConfigured) return
    const body = {
      section: activeKind === 'tenders' ? 'msc_tenders' : 'msc_prices',
      filters: { ...active, metricMonths: 12 },
      months: 12,
    }
    const key = JSON.stringify(body)
    if (metricKeyRef.current === key) return
    metricKeyRef.current = key
    const id = ++metricSeq.current
    setMetricsLoading(true)
    const load = localMode ? api.metricsSlice(body) : cloudMetricsSlice(body)
    load
      .then((payload) => { if (id === metricSeq.current) setMetricSlice(payload || null) })
      .catch(() => {
        if (id !== metricSeq.current) return
        metricKeyRef.current = ''
        setMetricSlice(null)
      })
      .finally(() => { if (id === metricSeq.current) setMetricsLoading(false) })
  }, [localMode, embedded])

  const search = useCallback(async (p = 0, cf, override = null, options = null) => {
    const id = ++reqSeq.current
    const stale = () => id !== reqSeq.current
    const size = resolvePageSize(pageSizeRef.current)
    const activeKind = override?.kind === 'prices' || override?.kind === 'tenders' ? override.kind : kind
    const filterOverride = { ...(override || {}) }
    delete filterOverride.kind
    const active = { ...mergedFilters(cf), ...filterOverride }
    if (activeKind === 'prices') { delete active.dosage_form; delete active.metricQuick }
    if (skipShortTextSearch(active, MSC_TEXT_KEYS, EMPTY_FILTERS)) {
      setErr(SHORT_SEARCH_NOTE)
      setLoading(false)
      return
    }
    if (p === 0) cursorsByPageRef.current = new Map([[0, null]])
    setLoading(true)
    setErr('')
    try {
      if (localMode || supabaseConfigured) {
        const cursor = localMode ? null : cursorsByPageRef.current.get(p)
        if (!localMode && p > 0 && cursor === undefined) {
          throw new Error('Trang này chưa có cursor. Hãy dùng nút Trang sau để xem tiếp.')
        }
        const searchFn = localMode
          ? (page, sz) => api.mscSearch({ kind: activeKind, filters: active, page, size: sz })
          : (page, sz, nextCursor) => cloudMscSearch({ kind: activeKind, filters: active, page, size: sz, cursor: nextCursor })
        const res = await searchFn(p, size, cursor)
        if (stale()) return null
        pageRef.current = p
        if (!localMode) cursorsByPageRef.current.set(p + 1, res.nextCursor || null)
        setData({ ...res, total: null })
        setPage(p)
        // The table is visible before aggregates are requested. Metric work is
        // deliberately a separate TiFlash request and cannot delay this list.
        if (options?.metrics !== false) setTimeout(() => { if (!stale()) loadMetrics(active, activeKind) }, 0)
        return res
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
  }, [kind, localMode, mergedFilters, embedded, loadMetrics])

  // Metrics: cloud aggregate API after first table paint; local keeps page-backfill
  useEffect(() => {
    if (embedded) return
    if (loading) sawTableLoad.current = true
    else if (sawTableLoad.current) setTableReady(true)
  }, [embedded, loading])

  useEffect(() => {
    setMetricSlice(null)
    setTableReady(false)
    sawTableLoad.current = false
    setMetricsCards(null)
    setMetricsProvincesYoy(null)
    setMetricsSample(null)
  }, [kind])

  const searchedKind = useRef(null)
  useEffect(() => {
    const kindChanged = searchedKind.current !== kind
    searchedKind.current = kind
    sel.clear()
    setColumnFilters({})
    if (kindChanged) {
      setMetricActiveId(null)
      setMetricQuick(null)
      setFilters((f) => ({ ...f, metricQuick: '' }))
    }
    search(0, {}, kindChanged ? { metricQuick: '' } : {})
  }, [kind, pageSize]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!embedded) return undefined
    const apply = (detail) => {
      if (!detail?.tenderNo) return
      const stamp = detail.at || 0
      if (!stamp || stamp === appliedCompare.current || Date.now() - stamp > 60000) return
      appliedCompare.current = stamp
      setKind('tenders')
      const patch = { tender_no: detail.tenderNo, ingredient: '', q: '', metricQuick: '' }
      setFilters((f) => ({ ...f, ...patch }))
      search(0, {}, { ...patch, kind: 'tenders' }).then((res) => {
        const row = (res?.items || []).find((item) => item.tender_no === detail.tenderNo)
        if (row) setDetail(row)
      })
    }
    const onCompare = (event) => apply(event.detail)
    window.addEventListener('baoan-compare', onCompare)
    apply(readCompare())
    return () => window.removeEventListener('baoan-compare', onCompare)
  }, [embedded, search])

  const draftRef = useRef(null)
  const applyDraft = useCallback((override, options) => {
    const next = draftRef.current?.commit(override) || { ...filtersRef.current, ...(override || {}) }
    filtersRef.current = next
    setFilters(next)
    search(0, undefined, null, options)
  }, [search])
  const clearDraft = useCallback(() => {
    draftRef.current?.reset(EMPTY_FILTERS)
    filtersRef.current = EMPTY_FILTERS
    setFilters(EMPTY_FILTERS)
    setColumnFilters({})
    setMetricActiveId(null)
    setMetricQuick(null)
    search(0, {}, EMPTY_FILTERS)
  }, [search])
  const setCF = (k, v) => setColumnFilters((f) => ({ ...f, [k]: v }))
  const runSearch = useCallback((override, options) => search(0, undefined, override || null, options), [search])
  const activeCF = Object.values(columnFilters).filter((v) => String(v ?? '').trim()).length
  const exportMatchReport = useCallback(async (level) => {
    const names = { exact: 'Khop_thuoc', near: 'Gan_khop_thuoc', all: 'Khop_va_gan_khop' }
    const body = { level, filters: { ...mergedFilters(), metricMonths: 12 } }
    const payload = localMode ? await api.mscMatchReport(body) : await cloudMatchReport(body)
    const rows = payload?.rows || []
    if (!rows.length) return 0
    exportMatchWorkbook(rows, names[level] || 'Khop_thuoc', { split: level === 'all' })
    return rows.length
  }, [mergedFilters, localMode])

  const fieldSuggest = useCallback((fieldKey) => async (q) => {
    const needle = String(q || '').trim()
    if (needle.length < 2) return []
    try {
      if (!localMode && supabaseConfigured) {
        const section = kind === 'tenders' ? 'msc_tenders' : 'msc_prices'
        return cloudSuggest(section, fieldKey, needle)
      }
      const filters = { ...mergedFilters(), [fieldKey]: needle, q: '' }
      const res = await api.mscSearch({ kind, filters, page: 0, size: 40 })
      const seen = new Set()
      const out = []
      for (const r of res?.items || []) {
        const t = String(fieldKey === 'q' ? (r.name || r.ingredient || r.registration || '') : (r[fieldKey] || '')).trim()
        if (!t || seen.has(t)) continue
        seen.add(t)
        out.push(t)
        if (out.length >= 8) break
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
  const metricsItems = metricsSample ?? data.items

  const onMetricFilter = useCallback((patch, id) => {
    if (String(id || '').startsWith('prov:')) {
      const name = String(id).slice(5)
      const clear = metricActiveId === id
      setMetricActiveId(clear ? null : id)
      setFilters((f) => ({ ...f, province: clear ? [] : [name] }))
      search(0, undefined, { province: clear ? [] : [name] }, { metrics: false })
      return
    }
    if (patch?._quick) {
      const quick = metricActiveId === id ? '' : patch._quick
      setMetricActiveId(quick ? id : null)
      setMetricQuick(quick || null)
      setFilters((f) => ({ ...f, metricQuick: quick, metricMonths: 12 }))
      search(0, undefined, { metricQuick: quick, metricMonths: 12 })
      return
    }
    const { _quick, ...rest } = patch || {}
    if (!Object.keys(rest).length) return
    setFilters((f) => ({ ...f, ...rest }))
    setMetricQuick(null)
    search(0, undefined, rest)
  }, [metricActiveId, search, localMode])

  const fetchAll = useCallback(async () => {
    if (!localMode && !supabaseConfigured) return []
    const searchFn = localMode
      ? (p, size) => api.mscSearch({ kind, filters: mergedFilters(), page: p, size })
      : (p, size, cursor) => cloudMscSearch({ kind, filters: mergedFilters(), page: p, size, cursor })
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

  return (
    <div className={`section${embedded ? ' embedded' : ''}`}>
      {!embedded && (
        <header className="section-head">
          <div>
            <span className="kicker">Hệ thống mạng đấu thầu quốc gia · muasamcong.mpi.gov.vn</span>
            <h1>{kind === 'tenders' ? 'Gói thầu thuốc' : 'Đơn giá thuốc trúng thầu'}</h1>
            <p>Đơn giá trúng thầu và gói thầu thuốc. Nhấp đôi một dòng để xem đầy đủ trường và mở trang nguồn.</p>
          </div>
          <UpdatedNote
            updated={meta.updated}
            count={data.total > 0 ? data.total : meta.count}
            source={data.total > 0 ? 'kết quả đang tra cứu' : undefined}
          />
        </header>
      )}

      <div className="panel">
        {embedded && <label className="msc-embedded-kind">Thầu MSC
          <select aria-label="Loại dữ liệu MSC" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="tenders">Gói thầu</option><option value="prices">Đơn giá</option>
          </select>
        </label>}
        <div className={`msc-workspace${embedded ? ' is-embedded' : ''}${kind === 'prices' ? ' is-prices' : ''}`}>
        <div className="filters">
          <div className="filters-left">
            <FilterDraft ref={draftRef} applied={filters}>
              {(draft, setF) => {
                const detailActive = Object.entries(draft).filter(([k, v]) => {
                  if (k === 'q' || k === 'metricMonths' || k === 'metricQuick') return false
                  return Array.isArray(v) ? v.length > 0 : String(v ?? '').trim() !== ''
                }).length
                return (
                  <>
                    {!modalFilters && (
                      <MscFieldGrid draft={draft} setF={setF} kind={kind} provinceOpts={provinceOpts} fieldSuggest={fieldSuggest} onCommit={applyDraft} />
                    )}
                    {kind === 'tenders' && <p className="muted small">Hoạt chất và dạng bào chế được tìm trong danh mục hồ sơ đã tải. Cập nhật tại Quản trị → Hồ sơ gói đang mở.</p>}
                    {draft.metricQuick && kind === 'tenders' && (
                      <button className="btn ghost sm" type="button" onClick={() => { setMetricActiveId(null); setMetricQuick(null); applyDraft({ metricQuick: '' }) }}>Bỏ lọc chỉ số ×</button>
                    )}
                    <div className="filter-actions">
                      {modalFilters && (
                        <button type="button" className={`btn ghost${detailActive ? ' on' : ''}`} onClick={() => setFilterModalOpen(true)}>
                          {Icons.filter} Bộ lọc chi tiết
                          {detailActive > 0 && <span className="pill">{detailActive}</span>}
                        </button>
                      )}
                      <button type="button" className="btn" onClick={() => applyDraft()}>{Icons.search} Tìm kiếm</button>
                      <button type="button" className="btn secondary" onClick={clearDraft}>Xóa lọc</button>
                    </div>
                    <FilterModal open={modalFilters && filterModalOpen} onClose={() => setFilterModalOpen(false)} onApply={() => applyDraft()}>
                      <MscFieldGrid draft={draft} setF={setF} kind={kind} provinceOpts={provinceOpts} fieldSuggest={fieldSuggest} onCommit={applyDraft} />
                    </FilterModal>
                  </>
                )
              }}
            </FilterDraft>
          </div>
        </div>
        {!embedded && (
          <div className="msc-metrics-stage">
            {kind === 'prices'
              ? <MscPriceMetrics items={metricsItems} cards={metricsCards} provincesYoy={metricsProvincesYoy} total={metricsTotal ?? metricsSample?.length ?? data.total ?? 0} activeId={metricActiveId} onFilter={onMetricFilter} loading={metricsLoading} slice={metricSlice || {}} />
              : <MscTenderMetrics items={metricsItems} cards={metricsCards} total={metricsTotal ?? metricsSample?.length ?? data.total ?? 0} activeId={metricActiveId} onFilter={onMetricFilter} loading={metricsLoading} slice={metricSlice || {}} onExportMatch={exportMatchReport} />}
          </div>
        )}

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
          rowClassName={kind === 'tenders' ? ((r) => resolveBidStatusFromRow(r).rowClass || '') : undefined}
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
          total={data.total}
          hasMore={data.hasMore}
          cursorOnly
          shown={rows.length}
          onPage={(p) => search(p)}
          pageSize={pageSize}
          onPageSize={(v) => { setPageSize(v); setPage(0) }}
          extra={sel.size > 0 && <span className="chip">{sel.size} dòng đã chọn</span>}
        />
      </div>

      <DetailModal
        row={detail}
        fields={kind === 'prices' ? PRICE_DETAIL : TENDER_DETAIL}
        title={detail?.name || detail?.tender_no || 'Chi tiết'}
        subtitle={detail ? (kind === 'prices' ? `Đơn giá trúng thầu · TBMT ${detail.tender_no || '—'}` : `Gói thầu · ${detail.tender_no || ''}`) : ''}
        onClose={() => setDetail(null)}
        width={kind === 'tenders' ? 1120 : undefined}
        contain={embedded && kind === 'tenders'}
        extra={kind === 'tenders' && detail ? <ScopeCatalog lines={detail.scope_lines} tenderNo={detail.tender_no} embedded={embedded} /> : null}
        renderValue={(f, row, val) => {
          if (f.key === 'ingredient') return <IngredientText text={row.ingredient} />
          if (f.key === 'status_label' || f.key === 'status_code') return <StatusBadge row={row} />
          if (f.key === 'source_url' && row.source_url) return <a href={row.source_url} target="_blank" rel="noopener noreferrer">Mở trang nguồn</a>
          return val
        }}
      />
      <LoadingOverlay show={loading} percent={sim.percent} message={sim.message} etaSec={sim.etaSec} onCancel={() => { reqSeq.current += 1; setLoading(false) }} />
      <LoadingOverlay show={exporting} percent={exportPct} message="Đang gom dữ liệu để xuất Excel…" onCancel={() => setExporting(false)} />
    </div>
  )
}
