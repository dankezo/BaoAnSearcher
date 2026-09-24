import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, applyClientFilters, containsWords, fmtDate, fmtDateTime, loadStaticGz, staticUpdated } from './api'
import {
  ColumnPicker, DataTable, DetailModal, ErrorNote, Field, Icons, IngredientText, LoadingOverlay, Pagination,
  TableToolbar, UpdatedNote, ViewModeSelect, applyColumnFilters, exportSelectionOrAll, fetchAllPages,
  serverFilters, useSectionMeta, useSelection, useSimProgress,
} from './components'

const PAGE_SIZE = 50

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
  { key: 'loai', label: 'Loại', filter: 'select' },
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
  { key: 'ht_thau', label: 'Hình thức thầu' }, { key: 'created_date', label: 'Ngày tạo', text: (r) => fmtDateTime(r.created_date) },
]

const SERVER_MAP = {
  hoatchat: 'hoatchat', sodk: 'sodk', loai: 'loai', nhomthau: 'nhomthau', loai_thau: 'loai_thau',
  duongdung: 'duongdung', ma_tinh: 'ma_tinh', nuocsx: 'nuocsx',
}

const EMPTY_FILTERS = {
  q: '', loai_thau: '', loai: 'Tân dược', nhomthau: '', hoatchat: '', sodk: '',
  tuNgay: '', denNgay: '', nam: '', duongdung: '', ma_tinh: '', nuocsx: '',
}

function filterStatic(items, f) {
  let out = items
  if ((f.q || '').trim()) {
    out = out.filter((r) => containsWords(`${r.ten} ${r.hoatchat} ${r.sodk} ${r.nhasx} ${r.tennhathau} ${r.ten_cskcb} ${r.ten_tinh}`, f.q))
  }
  out = applyClientFilters(out, [
    { value: f.loai_thau, keys: ['loai_thau'] }, { value: f.loai, keys: ['loai'] }, { value: f.nhomthau, keys: ['nhomthau'] },
    { value: f.hoatchat, keys: ['hoatchat'] }, { value: f.sodk, keys: ['sodk'] }, { value: f.duongdung, keys: ['duongdung'] },
    { value: f.ma_tinh, keys: ['ma_tinh'] }, { value: f.nuocsx, keys: ['nuocsx'] },
  ])
  if (f.nam) out = out.filter((r) => String(r.congbo || r.tungay || r.tungay_hd || '').startsWith(String(f.nam)))
  if (f.tuNgay) out = out.filter((r) => String(r.tungay_hd || '') >= f.tuNgay)
  if (f.denNgay) out = out.filter((r) => String(r.denngay_hd || '') <= `${f.denNgay} 23:59:59`)
  return out
}

export default function VssSection({ localMode }) {
  const [adv, setAdv] = useState(false)
  const [colPicker, setColPicker] = useState(false)
  const [viewMode, setViewMode] = useState('compact')
  const [visible, setVisible] = useState(DEFAULT)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [columnFilters, setColumnFilters] = useState({})
  const [filtersRow, setFiltersRow] = useState(true)
  const [page, setPage] = useState(0)
  const [data, setData] = useState({ total: 0, items: [] })
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportPct, setExportPct] = useState(0)
  const [err, setErr] = useState('')
  const [detail, setDetail] = useState(null)
  const [staticFallback, setStaticFallback] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const sim = useSimProgress(loading, 'Đang lọc BHYT VSS')
  const sel = useSelection()
  const reqSeq = useRef(0)
  const meta = useSectionMeta('vss', localMode, staticFallback, refreshKey)

  useEffect(() => {
    if (viewMode === 'compact') setVisible(DEFAULT)
    else if (viewMode === 'full') setVisible(ALL_COLS.map((c) => c.key))
  }, [viewMode])

  const cols = useMemo(() => ALL_COLS.filter((c) => visible.includes(c.key)), [visible])

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
        const res = await api.vssSearch({ filters: mergedFilters(cf), page: p, size: PAGE_SIZE })
        if (stale()) return
        setData(res)
        setPage(p)
        return
      }
      const dumped = await loadStaticGz('vss')
      if (stale()) return
      if (!dumped?.items) {
        setErr('Chưa có VSS export trên Pages.')
        setData({ total: 0, items: [] })
        return
      }
      setStaticFallback({ updated: staticUpdated(dumped, ['created_date', 'congbo']), count: dumped.total || dumped.items.length })
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
  }, [filters, localMode, mergedFilters])

  useEffect(() => { search(0) }, []) // initial load

  const setF = (k, v) => setFilters((f) => ({ ...f, [k]: v }))
  const setCF = (k, v) => setColumnFilters((f) => ({ ...f, [k]: v }))
  const onEnter = (e) => e.key === 'Enter' && search(0)
  const activeCF = Object.values(columnFilters).filter((v) => String(v ?? '').trim()).length
  const advActive = ['duongdung', 'ma_tinh', 'nuocsx'].filter((k) => filters[k]).length

  const rows = useMemo(() => applyColumnFilters(data.items, cols, columnFilters), [data.items, cols, columnFilters])
  const rowKey = useCallback((r, i) => `${r.sodk}|${r.ma}|${r.ma_tinh}|${r.quyetdinh}|${r.stt ?? `${page}-${i}`}`, [page])

  const fetchAll = useCallback(async () => {
    if (localMode) {
      return fetchAllPages((p, size) => api.vssSearch({ filters: mergedFilters(), page: p, size }), { onProgress: setExportPct })
    }
    const dumped = await loadStaticGz('vss')
    return filterStatic(dumped?.items || [], filters)
  }, [localMode, mergedFilters, filters])

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

  return (
    <div className="section">
      <header className="section-head">
        <div>
          <span className="kicker">Bảo hiểm xã hội Việt Nam · Kết quả đấu thầu thuốc</span>
          <h1>Thuốc trúng thầu BHYT (VSS)</h1>
          <p>Danh mục kết quả lựa chọn nhà thầu thuốc BHYT — lọc theo loại thầu, nhóm, SĐK và thời hạn hợp đồng.</p>
        </div>
        <UpdatedNote updated={meta.updated} count={meta.count} />
      </header>

      <div className="panel">
        <div className="filters">
          <div className="filter-grid">
            <Field label="Từ khóa"><input value={filters.q} onChange={(e) => setF('q', e.target.value)} onKeyDown={onEnter} placeholder="Tên · hoạt chất · SĐK · nhà thầu…" /></Field>
            <Field label="Loại thầu"><input value={filters.loai_thau} onChange={(e) => setF('loai_thau', e.target.value)} onKeyDown={onEnter} placeholder="vd: thau_tinh, thau_rieng_le" /></Field>
            <Field label="Loại">
              <select value={filters.loai} onChange={(e) => setF('loai', e.target.value)}>
                <option value="">Tất cả</option>
                <option value="Tân dược">Tân dược</option>
                <option value="Đông dược">Đông dược</option>
                <option value="Vị thuốc">Vị thuốc</option>
              </select>
            </Field>
            <Field label="Nhóm thầu"><input value={filters.nhomthau} onChange={(e) => setF('nhomthau', e.target.value)} onKeyDown={onEnter} placeholder="N1 … N5" /></Field>
            <Field label="Hoạt chất"><input value={filters.hoatchat} onChange={(e) => setF('hoatchat', e.target.value)} onKeyDown={onEnter} /></Field>
            <Field label="Số ĐK"><input value={filters.sodk} onChange={(e) => setF('sodk', e.target.value)} onKeyDown={onEnter} /></Field>
            <Field label="HĐ từ ngày"><input type="date" value={filters.tuNgay} onChange={(e) => setF('tuNgay', e.target.value)} /></Field>
            <Field label="HĐ đến ngày"><input type="date" value={filters.denNgay} onChange={(e) => setF('denNgay', e.target.value)} /></Field>
            <Field label="Năm"><input value={filters.nam} onChange={(e) => setF('nam', e.target.value)} onKeyDown={onEnter} placeholder="2024" inputMode="numeric" /></Field>
          </div>

          <div className="filter-sub">
            <button type="button" className={`btn ghost sm${adv ? ' on' : ''}`} onClick={() => setAdv((v) => !v)}>
              {adv ? 'Ẩn nâng cao' : 'Nâng cao'}
              {advActive > 0 && <span className="pill">{advActive}</span>}
            </button>
            {adv && (
              <div className="filter-grid">
                <Field label="Đường dùng"><input value={filters.duongdung} onChange={(e) => setF('duongdung', e.target.value)} onKeyDown={onEnter} /></Field>
                <Field label="Mã tỉnh"><input value={filters.ma_tinh} onChange={(e) => setF('ma_tinh', e.target.value)} onKeyDown={onEnter} /></Field>
                <Field label="Nước SX"><input value={filters.nuocsx} onChange={(e) => setF('nuocsx', e.target.value)} onKeyDown={onEnter} /></Field>
              </div>
            )}
          </div>

          <div className="filter-actions">
            <button type="button" className="btn" onClick={() => search(0)}>{Icons.search} Tìm kiếm</button>
            <button type="button" className="btn secondary" onClick={() => { setFilters(EMPTY_FILTERS); setColumnFilters({}) }}>Xóa lọc</button>
            <div className="spacer" />
            <span className="muted small">Enter trong ô lọc để tìm</span>
          </div>
        </div>

        <TableToolbar
          kicker="Bảng chính"
          title="Kết quả trúng thầu"
          selectedCount={sel.size}
          onClearSelection={sel.clear}
          onExport={doExport}
          exporting={exporting}
          filtersVisible={filtersRow}
          onToggleFilters={() => setFiltersRow((v) => !v)}
          activeColumnFilters={activeCF}
          onClearColumnFilters={() => { setColumnFilters({}); if (localMode) search(0, {}) }}
        >
          <ViewModeSelect value={viewMode} onChange={(v) => { setViewMode(v); if (v === 'custom') setColPicker(true) }} />
          {viewMode === 'custom' && (
            <button type="button" className="btn ghost sm" onClick={() => setColPicker((v) => !v)}>{Icons.columns} Cột</button>
          )}
        </TableToolbar>

        <ColumnPicker allColumns={ALL_COLS} visible={visible} onChange={setVisible} open={colPicker} onClose={() => setColPicker(false)} />
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
          emptyText="Không có dữ liệu — import Excel hoặc crawl VSS trong mục Quản trị"
          minWidth={1300}
        />
        <Pagination page={page} size={PAGE_SIZE} total={data.total || 0} shown={rows.length} onPage={(p) => search(p)}
          extra={sel.size > 0 && <span className="chip">{sel.size} dòng đã chọn</span>} />
      </div>

      <DetailModal
        row={detail}
        fields={[...ALL_COLS, ...EXTRA_DETAIL]}
        title={detail?.ten || detail?.hoatchat || 'Chi tiết'}
        subtitle={detail ? `BHYT VSS · SĐK ${detail.sodk || '—'} · ${detail.ten_tinh || ''}` : ''}
        onClose={() => setDetail(null)}
        renderValue={(f, row, val) => (f.key === 'hoatchat' ? <IngredientText text={row.hoatchat} /> : val)}
      />
      <LoadingOverlay show={loading} percent={sim.percent} message={sim.message} />
      <LoadingOverlay show={exporting} percent={exportPct} message="Đang gom dữ liệu để xuất Excel…" />
    </div>
  )
}
