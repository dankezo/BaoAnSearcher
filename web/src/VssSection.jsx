import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './api'
import { ColumnPicker, LoadingOverlay, Pagination, useSimProgress } from './components'

const ALL_COLS = [
  { key: 'hoatchat', label: 'Tên hoạt chất' },
  { key: 'sodk', label: 'Số ĐK' },
  { key: 'ten', label: 'Tên' },
  { key: 'duongdung', label: 'Đường dùng' },
  { key: 'hamluong', label: 'Hàm lượng' },
  { key: 'donvitinh', label: 'ĐVT' },
  { key: 'soluong', label: 'Số lượng' },
  { key: 'gia', label: 'Giá' },
  { key: 'thanhtien', label: 'Thành tiền' },
  { key: 'nhomthau', label: 'Nhóm thầu' },
  { key: 'nhasx', label: 'Nhà SX' },
  { key: 'nuocsx', label: 'Nước SX' },
  { key: 'ma_tinh', label: 'Mã tỉnh' },
  { key: 'ma_cskcb', label: 'Mã CSKCB' },
  { key: 'tungay_hd', label: 'Từ ngày HD' },
  { key: 'denngay_hd', label: 'Đến ngày HD' },
  { key: 'loai_thau', label: 'Loại thầu' },
  { key: 'loai', label: 'Loại' },
  { key: 'dangbaoche', label: 'Dạng bào chế' },
  { key: 'donggoi', label: 'Đóng gói' },
  { key: 'tennhathau', label: 'Nhà thầu' },
  { key: 'ten_tinh', label: 'Tỉnh' },
  { key: 'ten_cskcb', label: 'CSKCB' },
  { key: 'quyetdinh', label: 'Quyết định' },
  { key: 'goithau', label: 'Gói thầu' },
  { key: 'congbo', label: 'Công bố' },
]

const DEFAULT = [
  'hoatchat', 'sodk', 'ten', 'duongdung', 'hamluong', 'donvitinh',
  'soluong', 'gia', 'thanhtien', 'nhomthau', 'nhasx', 'nuocsx',
  'ma_tinh', 'ma_cskcb', 'tungay_hd', 'denngay_hd',
]

export default function VssSection({ localMode }) {
  const [open, setOpen] = useState(false)
  const [adv, setAdv] = useState(false)
  const [colPicker, setColPicker] = useState(false)
  const [viewMode, setViewMode] = useState('compact')
  const [visible, setVisible] = useState(DEFAULT)
  const [filters, setFilters] = useState({
    q: '', loai_thau: '', loai: 'Tân dược', nhomthau: '', hoatchat: '', sodk: '',
    tuNgay: '', denNgay: '', nam: '', duongdung: '', ma_tinh: '', nuocsx: '',
  })
  const [page, setPage] = useState(0)
  const [data, setData] = useState({ total: 0, items: [] })
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const sim = useSimProgress(loading, 'Đang lọc BHYT VSS')

  useEffect(() => {
    if (viewMode === 'compact') setVisible(DEFAULT)
    else if (viewMode === 'full') setVisible(ALL_COLS.map((c) => c.key))
  }, [viewMode])

  const cols = useMemo(() => ALL_COLS.filter((c) => visible.includes(c.key)), [visible])

  const search = useCallback(async (p = 0) => {
    setLoading(true)
    setErr('')
    try {
      if (localMode) {
        const res = await api.vssSearch({ filters, page: p, size: 50 })
        setData(res)
        setPage(p)
        return
      }
      const { loadStaticGz } = await import('./api')
      const dumped = await loadStaticGz('vss')
      if (!dumped?.items) {
        setErr('Chưa có VSS export trên Pages.')
        setData({ total: 0, items: [] })
        return
      }
      setData({ total: dumped.total || dumped.items.length, items: dumped.items.slice(p * 50, p * 50 + 50) })
      setPage(p)
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setLoading(false)
    }
  }, [filters, localMode])

  useEffect(() => { search(0) }, [])

  const setF = (k, v) => setFilters((f) => ({ ...f, [k]: v }))

  return (
    <div>
      <section className="hero">
        <h1>Thuốc trúng thầu BHYT (VSS)</h1>
        <p>Danh mục kết quả đấu thầu thuốc BHYT — lọc theo loại thầu, nhóm, SĐK và thời hạn hợp đồng.</p>
      </section>
      <div className="panel">
        <div className="panel-head">
          <h2>Bảng chính</h2>
          <div className="spacer" />
          <button type="button" className="btn ghost" onClick={() => setOpen((v) => !v)}>{open ? 'Thu bộ lọc' : 'Mở bộ lọc'}</button>
          <select
            value={viewMode}
            onChange={(e) => {
              setViewMode(e.target.value)
              if (e.target.value === 'custom') setColPicker(true)
            }}
            style={{ borderRadius: 10, border: '1px solid var(--line)', padding: '6px 10px', background: '#fff' }}
          >
            <option value="compact">Rút gọn</option>
            <option value="full">Hiện hết</option>
            <option value="custom">Chọn cột…</option>
          </select>
          <button type="button" className="btn" onClick={() => search(0)}>Tìm</button>
        </div>
        <div className={`filters ${open ? '' : 'collapsed'}`}>
          <div className="filter-grid">
            <div className="field"><label>Từ khóa</label><input value={filters.q} onChange={(e) => setF('q', e.target.value)} /></div>
            <div className="field"><label>Loại thầu</label><input value={filters.loai_thau} onChange={(e) => setF('loai_thau', e.target.value)} placeholder="vd: thau_rieng_le" /></div>
            <div className="field">
              <label>Loại</label>
              <select value={filters.loai} onChange={(e) => setF('loai', e.target.value)}>
                <option value="">Tất cả</option>
                <option value="Tân dược">Tân dược</option>
                <option value="Đông dược">Đông dược</option>
                <option value="Vị thuốc">Vị thuốc</option>
              </select>
            </div>
            <div className="field"><label>Nhóm thầu</label><input value={filters.nhomthau} onChange={(e) => setF('nhomthau', e.target.value)} placeholder="N1…" /></div>
            <div className="field"><label>Hoạt chất</label><input value={filters.hoatchat} onChange={(e) => setF('hoatchat', e.target.value)} /></div>
            <div className="field"><label>Số ĐK</label><input value={filters.sodk} onChange={(e) => setF('sodk', e.target.value)} /></div>
            <div className="field"><label>Từ ngày</label><input type="date" value={filters.tuNgay} onChange={(e) => setF('tuNgay', e.target.value)} /></div>
            <div className="field"><label>Đến ngày</label><input type="date" value={filters.denNgay} onChange={(e) => setF('denNgay', e.target.value)} /></div>
            <div className="field"><label>Năm</label><input value={filters.nam} onChange={(e) => setF('nam', e.target.value)} placeholder="2024" /></div>
          </div>
          <button type="button" className="btn ghost" onClick={() => setAdv((v) => !v)}>{adv ? 'Ẩn nâng cao' : 'Nâng cao'}</button>
          {adv && (
            <div className="filter-grid">
              <div className="field"><label>Đường dùng</label><input value={filters.duongdung} onChange={(e) => setF('duongdung', e.target.value)} /></div>
              <div className="field"><label>Mã tỉnh</label><input value={filters.ma_tinh} onChange={(e) => setF('ma_tinh', e.target.value)} /></div>
              <div className="field"><label>Nước SX</label><input value={filters.nuocsx} onChange={(e) => setF('nuocsx', e.target.value)} /></div>
            </div>
          )}
        </div>
        <ColumnPicker allColumns={ALL_COLS} visible={visible} onChange={setVisible} open={colPicker} onClose={() => setColPicker(false)} />
        {err && <div style={{ padding: 12, color: 'var(--danger)' }}>{err}</div>}
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>STT</th>
                {cols.map((c) => <th key={c.key}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.items.map((row, i) => (
                <tr key={i}>
                  <td>{row.stt || page * 50 + i + 1}</td>
                  {cols.map((c) => <td key={c.key}>{row[c.key] ?? ''}</td>)}
                </tr>
              ))}
              {!data.items.length && !loading && (
                <tr><td colSpan={cols.length + 1} style={{ textAlign: 'center', padding: 28, color: 'var(--muted)' }}>Không có dữ liệu — import Excel hoặc crawl VSS</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} size={50} total={data.total || 0} onPage={(p) => search(p)} />
      </div>
      <LoadingOverlay show={loading} percent={sim.percent} message={sim.message} />
    </div>
  )
}
