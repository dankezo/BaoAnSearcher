import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, applyClientFilters, containsWords, fmtDate, fmtDateTime, loadStaticGz, staticUpdated } from './api'
import {
  DataTable, DetailModal, ErrorNote, Field, FilterModal, Icons, IngredientText, LoadingOverlay, Pagination, TableToolbar,
  UpdatedNote, applyColumnFilters, exportSelectionOrAll, fetchAllPages, serverFilters, useSectionMeta,
  useSelection, useSimProgress,
} from './components'

const PAGE_SIZE = 50
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
  return applyClientFilters(out, [
    { value: f.name, keys: ['name'] }, { value: f.ingredient, keys: ['ingredient'] },
    { value: f.registration, keys: ['registration', 'registration_keys'] }, { value: f.manufacturer, keys: ['manufacturer'] },
    { value: f.province, keys: ['province'] }, { value: f.tender_no, keys: ['tender_no'] }, { value: f.buyer, keys: ['buyer'] },
    { value: f.winner, keys: ['winner'] }, { value: f.group_name, keys: ['group_name'] }, { value: f.medicine_type, keys: ['medicine_type'] },
  ])
}

export default function MscSection({ localMode, embedded = false, filtersInModal = false }) {
  const [kind, setKind] = useState('prices')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [columnFilters, setColumnFilters] = useState({})
  const [filtersRow, setFiltersRow] = useState(true)
  const [filterModalOpen, setFilterModalOpen] = useState(false)
  const [page, setPage] = useState(0)
  const [data, setData] = useState({ total: 0, items: [] })
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportPct, setExportPct] = useState(0)
  const [err, setErr] = useState('')
  const [detail, setDetail] = useState(null)
  const [staticFallback, setStaticFallback] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const sim = useSimProgress(loading, 'Đang lọc thầu MSC')
  const sel = useSelection()
  const reqSeq = useRef(0)
  const meta = useSectionMeta('msc', localMode, staticFallback, refreshKey)

  const cols = kind === 'prices' ? PRICE_COLS : TENDER_COLS
  const staticName = kind === 'prices' ? 'msc_prices' : 'msc_tenders'

  const mergedFilters = useCallback(
    (cf = columnFilters) => ({ ...filters, ...serverFilters(cf, SERVER_MAP) }),
    [filters, columnFilters],
  )

  const search = useCallback(async (p = 0, cf) => {
    const id = ++reqSeq.current
    const stale = () => id !== reqSeq.current
    setLoading(true)
    setErr('')
    try {
      if (localMode) {
        const res = await api.mscSearch({ kind, filters: mergedFilters(cf), page: p, size: PAGE_SIZE })
        if (stale()) return
        setData(res)
        setPage(p)
        return
      }
      const dumped = await loadStaticGz(staticName)
      if (stale()) return
      if (!dumped?.items) {
        setErr('Chưa có MSC export trên Pages.')
        setData({ total: 0, items: [] })
        return
      }
      setStaticFallback({ updated: staticUpdated(dumped), count: dumped.total || dumped.items.length })
      const items = filterStatic(dumped.items, filters)
      setData({ total: items.length, items: items.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE) })
      setPage(p)
    } catch (e) {
      if (!stale()) setErr(String(e.message || e))
    } finally {
      if (!stale()) {
        setLoading(false)
        setRefreshKey((k) => k + 1)
      }
    }
  }, [kind, filters, localMode, mergedFilters, staticName])

  useEffect(() => {
    sel.clear()
    setColumnFilters({})
    search(0, {})
  }, [kind]) // eslint-disable-line react-hooks/exhaustive-deps

  const setF = (k, v) => setFilters((f) => ({ ...f, [k]: v }))
  const setCF = (k, v) => setColumnFilters((f) => ({ ...f, [k]: v }))
  const onEnter = (e) => e.key === 'Enter' && search(0)
  const activeCF = Object.values(columnFilters).filter((v) => String(v ?? '').trim()).length
  const detailActive = Object.entries(filters).filter(([k, v]) => k !== 'q' && String(v ?? '').trim()).length

  const rows = useMemo(() => applyColumnFilters(data.items, cols, columnFilters), [data.items, cols, columnFilters])
  const rowKey = useCallback((r, i) => (r.source_id ? `${kind}:${r.source_id}` : `${kind}:${r.tender_no}|${page}|${i}`), [kind, page])

  const fetchAll = useCallback(async () => {
    if (localMode) {
      return fetchAllPages((p, size) => api.mscSearch({ kind, filters: mergedFilters(), page: p, size }), { onProgress: setExportPct })
    }
    const dumped = await loadStaticGz(staticName)
    return filterStatic(dumped?.items || [], filters)
  }, [localMode, kind, mergedFilters, staticName, filters])

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
    <div className="filter-grid">
      {kind === 'prices' ? (
        <>
          <Field label="Tên thuốc"><input value={filters.name} onChange={(e) => setF('name', e.target.value)} onKeyDown={onEnter} /></Field>
          <Field label="Hoạt chất"><input value={filters.ingredient} onChange={(e) => setF('ingredient', e.target.value)} onKeyDown={onEnter} /></Field>
          <Field label="SĐK"><input value={filters.registration} onChange={(e) => setF('registration', e.target.value)} onKeyDown={onEnter} /></Field>
          <Field label="Nhà sản xuất"><input value={filters.manufacturer} onChange={(e) => setF('manufacturer', e.target.value)} onKeyDown={onEnter} /></Field>
          <Field label="Nhóm"><input value={filters.group_name} onChange={(e) => setF('group_name', e.target.value)} onKeyDown={onEnter} placeholder="1 … 5" /></Field>
          <Field label="Loại thuốc"><input value={filters.medicine_type} onChange={(e) => setF('medicine_type', e.target.value)} onKeyDown={onEnter} /></Field>
          <Field label="Nhà thầu"><input value={filters.winner} onChange={(e) => setF('winner', e.target.value)} onKeyDown={onEnter} /></Field>
        </>
      ) : (
        <Field label="Tên gói"><input value={filters.name} onChange={(e) => setF('name', e.target.value)} onKeyDown={onEnter} /></Field>
      )}
      <Field label="TBMT"><input value={filters.tender_no} onChange={(e) => setF('tender_no', e.target.value)} onKeyDown={onEnter} placeholder="IB…" /></Field>
      <Field label="Tỉnh / TP"><input value={filters.province} onChange={(e) => setF('province', e.target.value)} onKeyDown={onEnter} /></Field>
      <Field label="Bệnh viện / CĐT"><input value={filters.buyer} onChange={(e) => setF('buyer', e.target.value)} onKeyDown={onEnter} /></Field>
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
          <div className="filter-top">
            <div className="segmented" role="tablist" aria-label="Loại dữ liệu">
              <button type="button" role="tab" aria-selected={kind === 'prices'} className={kind === 'prices' ? 'on' : ''} onClick={() => setKind('prices')}>Đơn giá</button>
              <button type="button" role="tab" aria-selected={kind === 'tenders'} className={kind === 'tenders' ? 'on' : ''} onClick={() => setKind('tenders')}>Gói thầu</button>
            </div>
          </div>
          <div className="filter-grid">
            <Field label="Từ khóa"><input value={filters.q} onChange={(e) => setF('q', e.target.value)} onKeyDown={onEnter} placeholder="Tìm trong mọi trường" /></Field>
          </div>
          {!filtersInModal && secondaryGrid}
          <div className="filter-actions">
            {filtersInModal && (
              <button type="button" className={`btn ghost${detailActive ? ' on' : ''}`} onClick={() => setFilterModalOpen(true)}>
                {Icons.filter} Bộ lọc chi tiết
                {detailActive > 0 && <span className="pill">{detailActive}</span>}
              </button>
            )}
            <button type="button" className="btn" onClick={() => search(0)}>{Icons.search} Tìm kiếm</button>
            <button type="button" className="btn secondary" onClick={() => { setFilters(EMPTY_FILTERS); setColumnFilters({}) }}>Xóa lọc</button>
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
          onClearColumnFilters={() => { setColumnFilters({}); if (localMode) search(0, {}) }}
        />
        <ErrorNote>{err}</ErrorNote>

        <DataTable
          columns={cols}
          rows={rows}
          rowKey={rowKey}
          startIndex={page * PAGE_SIZE}
          selected={sel.selected}
          onToggleRow={sel.toggle}
          onToggleAll={sel.setMany}
          columnFilters={columnFilters}
          onColumnFilter={setCF}
          filtersVisible={filtersRow}
          onFilterEnter={() => localMode && search(0)}
          onRowDoubleClick={setDetail}
          loading={loading}
          minWidth={embedded ? 720 : (kind === 'prices' ? 1400 : 1100)}
          trailing={{
            label: 'Nguồn',
            render: (row) => row.source_url ? (
              <a className="icon-btn accent" href={row.source_url} target="_blank" rel="noopener noreferrer" title="Mở trang nguồn">{Icons.external}</a>
            ) : null,
          }}
        />
        <Pagination page={page} size={PAGE_SIZE} total={data.total || 0} shown={rows.length} onPage={(p) => search(p)}
          extra={sel.size > 0 && <span className="chip">{sel.size} dòng đã chọn</span>} />
      </div>

      <FilterModal open={filtersInModal && filterModalOpen} onClose={() => setFilterModalOpen(false)} onApply={() => search(0)}>
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
      <LoadingOverlay show={loading} percent={sim.percent} message={sim.message} />
      <LoadingOverlay show={exporting} percent={exportPct} message="Đang gom dữ liệu để xuất Excel…" />
    </div>
  )
}
