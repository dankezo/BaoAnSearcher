import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, applyClientFilters, containsWords, fmtDate, loadStaticGz, openDavLookup, sortByDateDesc, staticUpdated, DAV_LOOKUP } from './api'
import {
  ColumnPicker, CountSelect, DataTable, DetailModal, ErrorNote, FilterModal, HospitalGradeField,
  Icons, IngredientText, LoadingOverlay, Pagination, SearchSuggestBar, SuggestField, TableToolbar, UpdatedNote,
  ViewModeSelect, applyColumnFilters, exportSelectionOrAll, fetchAllPages, resolvePageSize, serverFilters,
  useSectionMeta, useSelection, useSimProgress, useTt20,
} from './components'
import { TagBadge, TagFilterDropdown, useTagFilterState } from './TagFilterDropdown'
import { enrichRowTag } from './tagConfig'
import { ingredientAllowedAtGrade } from './tt20'

const PAGE_SIZE_DEFAULT = 200

const ALL_COLS = [
  { key: 'tagId', label: 'Trạng thái', filter: 'select', nowrap: true, width: 52, align: 'center' },
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
  { key: 'ctySanXuat', label: 'Công ty sản xuất', width: 200 },
  { key: 'diaChiSanXuat', label: 'Địa chỉ SX' },
  { key: 'nuocSanXuat', label: 'Nước SX', filter: 'select' },
  { key: 'ctyDangKy', label: 'Công ty đăng ký', width: 180 },
  { key: 'nuocDangKy', label: 'Nước ĐK', filter: 'select' },
  { key: 'tieuChuan', label: 'Tiêu chuẩn' },
  { key: 'kyCapNam', label: 'Kỳ cấp (năm)', align: 'right', filter: 'select' },
]

const COMPACT = [
  'tagId', 'soDangKy', 'ngayCap', 'tenThuoc', 'hoatChat', 'hamLuong', 'dangBaoChe',
  'dongGoi', 'ngayHetHan', 'ctyDangKy', 'ctySanXuat', 'nuocSanXuat',
]

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
  hangBenhVien: '',
  tags: null,
}

function filterStatic(items, f, tt20Index) {
  let out = items.map(enrichRowTag)
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
  if (f.hangBenhVien) {
    out = out.filter((r) => ingredientAllowedAtGrade(tt20Index, r.hoatChat, f.hangBenhVien))
  }
  const tags = f.tags
  if (Array.isArray(tags)) {
    if (tags.length === 0) return []
    out = out.filter((r) => tags.includes(r.tagId))
  }
  return sortByDateDesc(out, ['ngayGiaHan', 'ngayCap', 'ngayHetHan'])
}

export default function DavSection({ localMode, embedded = false, filtersInModal = false }) {
  const { index: tt20Index } = useTt20()
  const [colPicker, setColPicker] = useState(false)
  const [viewMode, setViewMode] = useState('compact')
  const [visible, setVisible] = useState(COMPACT)
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
  const [detail, setDetail] = useState(null)
  const [staticFallback, setStaticFallback] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [suggests, setSuggests] = useState([])
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const sim = useSimProgress(loading, 'Đang lọc thuốc DAV')
  const sel = useSelection()
  const reqSeq = useRef(0)
  const suggestSeq = useRef(0)
  const suggestTimer = useRef(null)
  const meta = useSectionMeta('dav', localMode, staticFallback, refreshKey)
  const { selectedTags, setSelectedTags, configs, refreshConfigs } = useTagFilterState()
  const filtersRef = useRef(filters)
  const columnFiltersRef = useRef(columnFilters)
  const selectedTagsRef = useRef(selectedTags)
  const pageSizeRef = useRef(pageSize)
  filtersRef.current = filters
  columnFiltersRef.current = columnFilters
  selectedTagsRef.current = selectedTags
  pageSizeRef.current = pageSize

  useEffect(() => {
    if (viewMode === 'compact') setVisible(COMPACT)
    else if (viewMode === 'full') setVisible(ALL_COLS.map((c) => c.key))
  }, [viewMode])

  const cols = useMemo(() => ALL_COLS.filter((c) => visible.includes(c.key)).map((c) => {
    if (c.key === 'tagId') {
      return {
        ...c,
        text: (r) => configs.find((t) => t.id === r.tagId)?.label || r.tagId || '',
        render: (v, row) => <TagBadge tagId={row.tagId} configs={configs} />,
      }
    }
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
  }), [visible, configs])

  const mergedFilters = useCallback(
    (cf) => ({
      ...filtersRef.current,
      ...serverFilters(cf ?? columnFiltersRef.current, SERVER_MAP),
      tags: selectedTagsRef.current,
    }),
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
      if (localMode) {
        const needGrade = !!active.hangBenhVien
        const res = await api.davSearch({
          filters: active,
          page: needGrade ? 0 : p,
          size: needGrade ? Math.max(size, 400) : size,
        })
        if (stale()) return
        let items = (res.items || []).map(enrichRowTag)
        if (active.hangBenhVien) {
          items = items.filter((r) => ingredientAllowedAtGrade(tt20Index, r.hoatChat, active.hangBenhVien))
          items = sortByDateDesc(items, ['ngayGiaHan', 'ngayCap', 'ngayHetHan'])
          setData({
            total: items.length,
            items: items.slice(p * size, p * size + size),
            page: p,
            size,
          })
        } else {
          setData({ ...res, items })
        }
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
      const items = filterStatic(dumped.items, active, tt20Index)
      setData({ total: items.length, items: items.slice(p * size, p * size + size), page: p, size })
      setPage(p)
    } catch (e) {
      if (!stale()) setErr(String(e.message || e))
    } finally {
      if (!stale()) {
        setLoading(false)
        setRefreshKey((k) => k + 1)
      }
    }
  }, [localMode, mergedFilters, tt20Index])

  useEffect(() => { search(0) }, [selectedTags, filters.hangBenhVien, pageSize]) // eslint-disable-line react-hooks/exhaustive-deps

  const toSuggest = useCallback((items) => (
    (items || []).slice(0, 4).map((r, i) => ({
      id: r.id ?? `${r.soDangKy}-${i}`,
      title: r.tenThuoc || r.soDangKy || '—',
      subtitle: [r.soDangKy, r.hoatChat].filter(Boolean).join(' · '),
      meta: r.hamLuong || '',
      row: r,
    }))
  ), [])

  useEffect(() => {
    const q = (filters.q || '').trim()
    clearTimeout(suggestTimer.current)
    if (q.length < 2) {
      setSuggests([])
      setSuggesting(false)
      return
    }
    suggestTimer.current = setTimeout(async () => {
      const id = ++suggestSeq.current
      setSuggesting(true)
      try {
        let items = []
        if (localMode) {
          const res = await api.davSearch({
            filters: { ...mergedFilters(), q, tenThuoc: '', soDangKy: '', hoatChat: '' },
            page: 0,
            size: 4,
          })
          items = res?.items || []
        } else {
          const dumped = await loadStaticGz('dav')
          items = filterStatic(dumped?.items || [], { ...filters, q, tags: selectedTags }, tt20Index).slice(0, 4)
        }
        if (id === suggestSeq.current) setSuggests(toSuggest(items))
      } catch {
        if (id === suggestSeq.current) setSuggests([])
      } finally {
        if (id === suggestSeq.current) setSuggesting(false)
      }
    }, 260)
    return () => clearTimeout(suggestTimer.current)
  }, [filters.q, filters, localMode, mergedFilters, selectedTags, toSuggest, tt20Index])

  const setF = (key, val) => setFilters((f) => ({ ...f, [key]: val }))
  const setCF = (key, val) => setColumnFilters((f) => ({ ...f, [key]: val }))
  const activeCF = Object.values(columnFilters).filter((v) => String(v ?? '').trim()).length
  const advancedActive = [
    filters.tenThuoc, filters.soDangKy, filters.hoatChat, filters.dangBaoChe,
    filters.sanXuat, filters.dangKy, filters.nuocSanXuat,
    filters.ingredientCount, filters.dosageFormCount, filters.strengthCount,
    filters.hangBenhVien,
  ].filter((v) => String(v ?? '').trim()).length

  const fieldSuggest = useCallback((fieldKey) => async (q) => {
    const needle = String(q || '').trim()
    if (needle.length < 1) return []
    try {
      let items = []
      if (localMode) {
        const res = await api.davSearch({
          filters: { ...mergedFilters(), [fieldKey]: needle, q: '' },
          page: 0,
          size: 30,
        })
        items = res?.items || []
      } else {
        const dumped = await loadStaticGz('dav')
        items = filterStatic(
          dumped?.items || [],
          { ...mergedFilters(), [fieldKey]: needle, q: '' },
          tt20Index,
        ).slice(0, 40)
      }
      const seen = new Set()
      const out = []
      const rowKeyOf = {
        tenThuoc: 'tenThuoc', soDangKy: 'soDangKy', hoatChat: 'hoatChat', dangBaoChe: 'dangBaoChe',
        sanXuat: 'ctySanXuat', dangKy: 'ctyDangKy', nuocSanXuat: 'nuocSanXuat',
      }[fieldKey] || fieldKey
      for (const r of items) {
        const t = String(r[rowKeyOf] || '').trim()
        if (!t || seen.has(t)) continue
        seen.add(t)
        out.push(t)
        if (out.length >= 3) break
      }
      return out
    } catch {
      return []
    }
  }, [localMode, mergedFilters, tt20Index])

  const runSearch = useCallback((override) => {
    setSuggestOpen(false)
    search(0, undefined, override || null)
  }, [search])

  const rows = useMemo(() => applyColumnFilters(data.items, cols, columnFilters), [data.items, cols, columnFilters])
  const rowKey = useCallback((r, i) => (r.id != null ? `id:${r.id}` : `${r.soDangKy}|${page}|${i}`), [page])
  const pageSizeNum = resolvePageSize(pageSize)

  const fetchAll = useCallback(async () => {
    if (localMode) {
      const all = await fetchAllPages((p, size) => api.davSearch({ filters: mergedFilters(), page: p, size }), { onProgress: setExportPct })
      if (filters.hangBenhVien) {
        return all.filter((r) => ingredientAllowedAtGrade(tt20Index, r.hoatChat, filters.hangBenhVien))
      }
      return all
    }
    const dumped = await loadStaticGz('dav')
    return filterStatic(dumped?.items || [], { ...filters, tags: selectedTags }, tt20Index)
  }, [localMode, mergedFilters, filters, selectedTags, tt20Index])

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

  const detailFields = (
    <div className="filter-grid">
      <SuggestField label="Tên thuốc" value={filters.tenThuoc} onChange={(v) => setF('tenThuoc', v)} onSearch={(v) => runSearch({ tenThuoc: v })} suggest={fieldSuggest('tenThuoc')} />
      <SuggestField label="Số ĐK" value={filters.soDangKy} onChange={(v) => setF('soDangKy', v)} onSearch={(v) => runSearch({ soDangKy: v })} suggest={fieldSuggest('soDangKy')} />
      <SuggestField label="Hoạt chất" value={filters.hoatChat} onChange={(v) => setF('hoatChat', v)} onSearch={(v) => runSearch({ hoatChat: v })} suggest={fieldSuggest('hoatChat')} />
      <SuggestField label="Dạng bào chế" value={filters.dangBaoChe} onChange={(v) => setF('dangBaoChe', v)} onSearch={(v) => runSearch({ dangBaoChe: v })} suggest={fieldSuggest('dangBaoChe')} />
      <SuggestField label="Công ty SX" value={filters.sanXuat} onChange={(v) => setF('sanXuat', v)} onSearch={(v) => runSearch({ sanXuat: v })} suggest={fieldSuggest('sanXuat')} />
      <SuggestField label="Công ty ĐK" value={filters.dangKy} onChange={(v) => setF('dangKy', v)} onSearch={(v) => runSearch({ dangKy: v })} suggest={fieldSuggest('dangKy')} />
      <SuggestField label="Nước SX" value={filters.nuocSanXuat} onChange={(v) => setF('nuocSanXuat', v)} onSearch={(v) => runSearch({ nuocSanXuat: v })} suggest={fieldSuggest('nuocSanXuat')} />
      <HospitalGradeField value={filters.hangBenhVien} onChange={(v) => setF('hangBenhVien', v)} />
      <CountSelect label="Số hoạt chất" value={filters.ingredientCount} otherValue={filters.ingredientCountOther}
        options={[1, 2, 3, 4, 5]} onChange={(v) => setF('ingredientCount', v)} onOther={(v) => setF('ingredientCountOther', v)} />
      <CountSelect label="Số dạng bào chế (nhóm HC)" value={filters.dosageFormCount} otherValue={filters.dosageFormCountOther}
        options={[1, 2, 3, 4, 5, 6, 7]} onChange={(v) => setF('dosageFormCount', v)} onOther={(v) => setF('dosageFormCountOther', v)} />
      <CountSelect label="Mức hàm lượng (nhóm HC)" value={filters.strengthCount} otherValue={filters.strengthCountOther}
        options={[1, 3, 4, 5]} onChange={(v) => setF('strengthCount', v)} onOther={(v) => setF('strengthCountOther', v)} />
    </div>
  )

  return (
    <div className={`section${embedded ? ' embedded' : ''}`}>
      {!embedded && (
        <header className="section-head">
          <div>
            <span className="kicker">Cục Quản lý Dược · dichvucong.dav.gov.vn</span>
            <h1>Tra cứu thuốc DAV</h1>
            <p>Danh mục số đăng ký — tag trạng thái SĐK, khớp danh mục 93 / TT20, nhấp kính lúp để copy tên thuốc và mở trang công bố.</p>
          </div>
          <UpdatedNote updated={meta.updated} count={meta.count} />
        </header>
      )}

      <div className="panel">
        <div className="filters">
          <SearchSuggestBar
            value={filters.q}
            onChange={(v) => setF('q', v)}
            onSubmit={() => runSearch()}
            suggestions={suggests}
            open={suggestOpen}
            onOpenChange={setSuggestOpen}
            loading={loading || suggesting}
            onPick={(s) => {
              const row = s.row
              const q = row?.tenThuoc || s.title || filters.q
              setFilters((f) => ({ ...f, q }))
              setSuggestOpen(false)
              if (row) setDetail(row)
              runSearch({ q })
            }}
          />
          <div className="filter-actions filter-actions-center">
            <TagFilterDropdown
              selectedTags={selectedTags}
              onChange={(ids) => { setSelectedTags(ids); refreshConfigs() }}
              configs={configs}
            />
            {filtersInModal ? (
              <button
                type="button"
                className={`btn ghost${advancedActive ? ' on' : ''}`}
                onClick={() => setFilterModalOpen(true)}
              >
                {Icons.filter} Bộ lọc chi tiết
                {advancedActive > 0 && <span className="pill">{advancedActive}</span>}
              </button>
            ) : null}
            <button type="button" className="btn" onClick={() => runSearch()}>{Icons.search} Tìm kiếm</button>
            <button type="button" className="btn secondary" onClick={() => {
              setFilters(EMPTY_FILTERS)
              setColumnFilters({})
              setSuggests([])
            }}
            >
              Xóa lọc
            </button>
            {localMode && !embedded && (
              <button type="button" className="btn ghost" onClick={() => api.davValidity().then(() => runSearch()).catch((e) => setErr(e.message))}>
                Rebuild tập hiệu lực
              </button>
            )}
          </div>
          {!filtersInModal && detailFields}
          {selectedTags.length === 0 && (
            <div className="tag-empty-hint">Vui lòng chọn ít nhất một phân loại tag để hiển thị kết quả.</div>
          )}
        </div>

        <TableToolbar
          kicker="Bảng chính"
          title={embedded ? 'DAV' : 'Danh mục số đăng ký'}
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
          onFilterSuggest={async (key, q) => {
            const mapKey = SERVER_MAP[key] || key
            return fieldSuggest(mapKey)(q)
          }}
          onRowDoubleClick={setDetail}
          loading={loading}
          emptyText="Không có dữ liệu phù hợp"
          minWidth={embedded ? 720 : 1100}
          trailing={{
            label: 'Tra cứu',
            render: (row) => (
              <button type="button" className="icon-btn accent" title="Copy tên thuốc & mở DAV" onClick={() => openDavLookup(row.tenThuoc)}>
                {Icons.search}
              </button>
            ),
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

      <FilterModal
        open={filtersInModal && filterModalOpen}
        onClose={() => setFilterModalOpen(false)}
        onApply={() => runSearch()}
      >
        {detailFields}
      </FilterModal>

      <DetailModal
        row={detail}
        fields={[...ALL_COLS, { key: 'soDangKyCu', label: 'Số ĐK cũ' }, { key: 'ngayGiaHan', label: 'Ngày gia hạn', text: (r) => fmtDate(r.ngayGiaHan) }, { key: 'dotCap', label: 'Đợt cấp' }, { key: 'diaChiDangKy', label: 'Địa chỉ ĐK' }, { key: 'phanLoai', label: 'Phân loại' }, { key: 'conHieuLuc', label: 'Còn hiệu lực' }, { key: 'dm93', label: 'Khớp DM93' }, { key: 'hasGiaHanPending', label: 'Đang nộp gia hạn' }, { key: 'ingredientCount', label: 'Số hoạt chất' }, { key: 'ghiChu', label: 'Ghi chú' }]}
        title={detail?.tenThuoc || 'Chi tiết thuốc'}
        subtitle={detail ? `SĐK ${detail.soDangKy}` : ''}
        sourceUrl={DAV_LOOKUP}
        onClose={() => setDetail(null)}
        renderValue={(f, row, val) => {
          if (f.key === 'hoatChat') return <IngredientText text={row.hoatChat} />
          if (f.key === 'tagId') return <TagBadge tagId={row.tagId} configs={configs} detailed />
          if (f.key === 'hasGiaHanPending') return row.hasGiaHanPending ? 'Có' : 'Không'
          return val
        }}
      />
      <LoadingOverlay show={loading} percent={sim.percent} message={sim.message} />
      <LoadingOverlay show={exporting} percent={exportPct} message="Đang gom dữ liệu để xuất Excel…" />
    </div>
  )
}
