import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, applyClientFilters, containsWords, fmtDate, loadStaticGz, openDavLookup, staticUpdated, DAV_LOOKUP } from './api'
import {
  ColumnPicker, CountSelect, DataTable, DetailModal, ErrorNote, Field, Icons, IngredientText, LoadingOverlay,
  Pagination, TableToolbar, UpdatedNote, ViewModeSelect, applyColumnFilters, exportSelectionOrAll,
  fetchAllPages, serverFilters, useSectionMeta, useSelection, useSimProgress,
} from './components'

const PAGE_SIZE = 50

const ALL_COLS = [
  { key: 'soDangKy', label: 'Số đăng ký', mono: true, nowrap: true },
  { key: 'ngayCap', label: 'Ngày cấp', text: (r) => fmtDate(r.ngayCap), nowrap: true },
  { key: 'tenThuoc', label: 'Tên thuốc', width: 180 },
  { key: 'hoatChat', label: 'Hoạt chất', width: 220 },
  { key: 'hamLuong', label: 'Hàm lượng', width: 120 },
  { key: 'dangBaoChe', label: 'Dạng bào chế' },
  { key: 'dongGoi', label: 'Quy cách đóng gói' },
  { key: 'hanDung', label: 'Hạn dùng', align: 'right' },
  { key: 'soQuyetDinh', label: 'Số quyết định', mono: true },
  { key: 'ngayHetHan', label: 'Ngày hết hạn', text: (r) => fmtDate(r.ngayHetHan), nowrap: true },
  { key: 'phanLoai', label: 'Phân loại', filter: 'select' },
  { key: 'ctySanXuat', label: 'Công ty sản xuất', width: 200 },
  { key: 'diaChiSanXuat', label: 'Địa chỉ SX' },
  { key: 'nuocSanXuat', label: 'Nước SX', filter: 'select' },
  { key: 'ctyDangKy', label: 'Công ty đăng ký', width: 180 },
  { key: 'diaChiDangKy', label: 'Địa chỉ ĐK' },
  { key: 'nuocDangKy', label: 'Nước ĐK', filter: 'select' },
  { key: 'tieuChuan', label: 'Tiêu chuẩn' },
  { key: 'csDongGoi', label: 'CS đóng gói' },
  { key: 'csXuatXuong', label: 'CS xuất xưởng' },
  { key: 'kyCapNam', label: 'Kỳ cấp (năm)', align: 'right', filter: 'select' },
]

const COMPACT = [
  'soDangKy', 'ngayCap', 'tenThuoc', 'hoatChat', 'hamLuong', 'dangBaoChe',
  'dongGoi', 'ngayHetHan', 'ctyDangKy', 'ctySanXuat', 'nuocSanXuat',
]

/** Column key → server filter key (pass-through when running against local API). */
const SERVER_MAP = {
  tenThuoc: 'tenThuoc', soDangKy: 'soDangKy', hoatChat: 'hoatChat', dangBaoChe: 'dangBaoChe',
  ctySanXuat: 'sanXuat', ctyDangKy: 'dangKy', nuocSanXuat: 'nuocSanXuat',
}

const EMPTY_FILTERS = {
  q: '', tenThuoc: '', soDangKy: '', hoatChat: '', dangBaoChe: '',
  sanXuat: '', dangKy: '', nuocSanXuat: '',
  ingredientCount: '', ingredientCountOther: '',
  dosageFormCount: '', dosageFormCountOther: '',
  strengthCount: '', strengthCountOther: '',
  conHieuLuc: false,
}

/** Static (GitHub Pages) fallback filtering — mirrors the server as far as the export allows. */
function filterStatic(items, f) {
  let out = items
  const q = (f.q || '').trim()
  if (q) out = out.filter((r) => containsWords(`${r.tenThuoc} ${r.soDangKy} ${r.hoatChat} ${r.hamLuong}`, q))
  out = applyClientFilters(out, [
    { value: f.tenThuoc, keys: ['tenThuoc'] },
    { value: f.soDangKy, keys: ['soDangKy', 'soDangKyCu'] },
    { value: f.hoatChat, keys: ['hoatChat'] },
    { value: f.dangBaoChe, keys: ['dangBaoChe'] },
    { value: f.sanXuat, keys: ['ctySanXuat'] },
    { value: f.dangKy, keys: ['ctyDangKy'] },
    { value: f.nuocSanXuat, keys: ['nuocSanXuat'] },
  ])
  const n = f.ingredientCount === 'other' ? Number(f.ingredientCountOther) : Number(f.ingredientCount)
  if (f.ingredientCount && Number.isFinite(n) && n > 0) out = out.filter((r) => r.ingredientCount === n)
  if (f.conHieuLuc) out = out.filter((r) => r.conHieuLuc)
  return out
}

export default function DavSection({ localMode }) {
  const [colPicker, setColPicker] = useState(false)
  const [viewMode, setViewMode] = useState('compact')
  const [visible, setVisible] = useState(COMPACT)
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
  const sim = useSimProgress(loading, 'Đang lọc thuốc DAV')
  const sel = useSelection()
  const reqSeq = useRef(0)
  const meta = useSectionMeta('dav', localMode, staticFallback, refreshKey)

  useEffect(() => {
    if (viewMode === 'compact') setVisible(COMPACT)
    else if (viewMode === 'full') setVisible(ALL_COLS.map((c) => c.key))
  }, [viewMode])

  const cols = useMemo(() => ALL_COLS.filter((c) => visible.includes(c.key)).map((c) => {
    if (c.key === 'soDangKy') {
      return { ...c, render: (v) => <a className="sdk" href={DAV_LOOKUP} target="_blank" rel="noreferrer">{v}</a> }
    }
    if (c.key === 'hoatChat') return { ...c, render: (v) => <IngredientText text={v} /> }
    if (c.key === 'ngayCap') return { ...c, render: (v) => fmtDate(v) }
    if (c.key === 'ngayHetHan') {
      return {
        ...c,
        render: (v, row) => (
          <span className="cell-badge">
            {fmtDate(v)}
            {row.conHieuLuc ? <span className="badge ok">Hiệu lực</span> : <span className="badge off">Hết / không đủ</span>}
          </span>
        ),
      }
    }
    return c
  }), [visible])

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
        const res = await api.davSearch({ filters: mergedFilters(cf), page: p, size: PAGE_SIZE })
        if (stale()) return
        setData(res)
        setPage(p)
        return
      }
      const dumped = await loadStaticGz('dav')
      if (stale()) return
      if (!dumped?.items) {
        setErr('Chưa có data export. Chạy local rồi python scripts/export_for_pages.py')
        setData({ total: 0, items: [] })
        return
      }
      setStaticFallback({ updated: staticUpdated(dumped, ['ngayCap']), count: dumped.total || dumped.items.length })
      const items = filterStatic(dumped.items, filters)
      setData({ total: items.length, items: items.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE), page: p, size: PAGE_SIZE })
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

  const setF = (key, val) => setFilters((f) => ({ ...f, [key]: val }))
  const setCF = (key, val) => setColumnFilters((f) => ({ ...f, [key]: val }))
  const activeCF = Object.values(columnFilters).filter((v) => String(v ?? '').trim()).length

  const rows = useMemo(() => applyColumnFilters(data.items, cols, columnFilters), [data.items, cols, columnFilters])
  const rowKey = useCallback((r, i) => (r.id != null ? `id:${r.id}` : `${r.soDangKy}|${page}|${i}`), [page])

  const fetchAll = useCallback(async () => {
    if (localMode) {
      return fetchAllPages((p, size) => api.davSearch({ filters: mergedFilters(), page: p, size }), { onProgress: setExportPct })
    }
    const dumped = await loadStaticGz('dav')
    return filterStatic(dumped?.items || [], filters)
  }, [localMode, mergedFilters, filters])

  const doExport = async () => {
    setExporting(true)
    setExportPct(5)
    try {
      const n = await exportSelectionOrAll({
        columns: cols, selected: sel.selected, fetchAll, filename: 'DAV_thuoc', sheetName: 'DAV', columnFilters,
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
          <span className="kicker">Cục Quản lý Dược · dichvucong.dav.gov.vn</span>
          <h1>Tra cứu thuốc DAV</h1>
          <p>Danh mục số đăng ký — lọc còn hiệu lực theo tiêu chí kinh doanh, khớp danh mục 93, nhấp kính lúp để copy tên thuốc và mở trang công bố.</p>
        </div>
        <UpdatedNote updated={meta.updated} count={meta.count} />
      </header>

      <div className="panel">
        <div className="filters">
          <div className="filter-grid">
            <Field label="Từ khóa" hint="tên · SĐK · hoạt chất · hàm lượng">
              <input value={filters.q} onChange={(e) => setF('q', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search(0)} placeholder="Nhập nhiều từ, cách nhau bằng dấu cách" />
            </Field>
            <Field label="Tên thuốc"><input value={filters.tenThuoc} onChange={(e) => setF('tenThuoc', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search(0)} /></Field>
            <Field label="Số ĐK"><input value={filters.soDangKy} onChange={(e) => setF('soDangKy', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search(0)} /></Field>
            <Field label="Hoạt chất"><input value={filters.hoatChat} onChange={(e) => setF('hoatChat', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search(0)} /></Field>
            <Field label="Dạng bào chế"><input value={filters.dangBaoChe} onChange={(e) => setF('dangBaoChe', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search(0)} /></Field>
            <Field label="Công ty SX"><input value={filters.sanXuat} onChange={(e) => setF('sanXuat', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search(0)} /></Field>
            <Field label="Công ty ĐK"><input value={filters.dangKy} onChange={(e) => setF('dangKy', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search(0)} /></Field>
            <Field label="Nước SX"><input value={filters.nuocSanXuat} onChange={(e) => setF('nuocSanXuat', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search(0)} /></Field>
            <CountSelect label="Số hoạt chất" value={filters.ingredientCount} otherValue={filters.ingredientCountOther}
              options={[1, 2, 3, 4, 5]} onChange={(v) => setF('ingredientCount', v)} onOther={(v) => setF('ingredientCountOther', v)} />
            <CountSelect label="Số dạng bào chế (nhóm HC)" value={filters.dosageFormCount} otherValue={filters.dosageFormCountOther}
              options={[1, 2, 3, 4, 5, 6, 7]} onChange={(v) => setF('dosageFormCount', v)} onOther={(v) => setF('dosageFormCountOther', v)} />
            <CountSelect label="Mức hàm lượng (nhóm HC)" value={filters.strengthCount} otherValue={filters.strengthCountOther}
              options={[1, 3, 4, 5]} onChange={(v) => setF('strengthCount', v)} onOther={(v) => setF('strengthCountOther', v)} />
            <Field label="Còn hiệu lực (tiêu chí KD)">
              <select value={filters.conHieuLuc ? '1' : '0'} onChange={(e) => setF('conHieuLuc', e.target.value === '1')}>
                <option value="0">Tắt</option>
                <option value="1">Bật — kỳ cấp ≥ 3 năm, loại DM93…</option>
              </select>
            </Field>
          </div>
          <div className="filter-actions">
            <button type="button" className="btn" onClick={() => search(0)}>{Icons.search} Tìm kiếm</button>
            <button type="button" className="btn secondary" onClick={() => { setFilters(EMPTY_FILTERS); setColumnFilters({}) }}>Xóa lọc</button>
            {localMode && (
              <button type="button" className="btn ghost" onClick={() => api.davValidity().then(() => search(0)).catch((e) => setErr(e.message))}>
                Rebuild tập hiệu lực
              </button>
            )}
            {!localMode && <span className="muted small">Chế độ tĩnh: lọc nhóm hoạt chất (dạng bào chế / hàm lượng) chỉ khả dụng khi chạy local.</span>}
            <div className="spacer" />
            <span className="muted small">Enter trong ô lọc để tìm</span>
          </div>
        </div>

        <TableToolbar
          kicker="Bảng chính"
          title="Danh mục số đăng ký"
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
          emptyText="Không có dữ liệu phù hợp"
          minWidth={1100}
          trailing={{
            label: 'Tra cứu',
            render: (row) => (
              <button type="button" className="icon-btn accent" title="Copy tên thuốc & mở DAV" onClick={() => openDavLookup(row.tenThuoc)}>
                {Icons.search}
              </button>
            ),
          }}
        />
        <Pagination page={page} size={PAGE_SIZE} total={data.total || 0} shown={rows.length} onPage={(p) => search(p)}
          extra={sel.size > 0 && <span className="chip">{sel.size} dòng đã chọn</span>} />
      </div>

      <DetailModal
        row={detail}
        fields={[...ALL_COLS, { key: 'soDangKyCu', label: 'Số ĐK cũ' }, { key: 'ngayGiaHan', label: 'Ngày gia hạn', text: (r) => fmtDate(r.ngayGiaHan) }, { key: 'dotCap', label: 'Đợt cấp' }, { key: 'conHieuLuc', label: 'Còn hiệu lực' }, { key: 'ingredientCount', label: 'Số hoạt chất' }, { key: 'ghiChu', label: 'Ghi chú' }]}
        title={detail?.tenThuoc || 'Chi tiết thuốc'}
        subtitle={detail ? `SĐK ${detail.soDangKy}` : ''}
        sourceUrl={DAV_LOOKUP}
        onClose={() => setDetail(null)}
        renderValue={(f, row, val) => (f.key === 'hoatChat' ? <IngredientText text={row.hoatChat} /> : val)}
      />
      <LoadingOverlay show={loading} percent={sim.percent} message={sim.message} />
      <LoadingOverlay show={exporting} percent={exportPct} message="Đang gom dữ liệu để xuất Excel…" />
    </div>
  )
}
