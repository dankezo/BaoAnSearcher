import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { LoadingOverlay, Pagination, useSimProgress } from './components'

const PRICE_COLS = [
  { key: 'name', label: 'Tên thuốc' },
  { key: 'ingredient', label: 'Hoạt chất' },
  { key: 'strength', label: 'Hàm lượng' },
  { key: 'registration', label: 'SĐK' },
  { key: 'unit_price', label: 'Đơn giá' },
  { key: 'quantity', label: 'SL' },
  { key: 'unit', label: 'ĐVT' },
  { key: 'group_name', label: 'Nhóm' },
  { key: 'manufacturer', label: 'NSX' },
  { key: 'country', label: 'Nước' },
  { key: 'buyer', label: 'Bệnh viện' },
  { key: 'province', label: 'Tỉnh' },
  { key: 'tender_no', label: 'TBMT' },
  { key: 'published', label: 'Ngày KQLCNT' },
]

const TENDER_COLS = [
  { key: 'tender_no', label: 'Mã TBMT' },
  { key: 'name', label: 'Tên gói' },
  { key: 'buyer', label: 'Chủ đầu tư' },
  { key: 'province', label: 'Tỉnh' },
  { key: 'published', label: 'Ngày đăng' },
  { key: 'close_date', label: 'Đóng thầu' },
  { key: 'status_label', label: 'Trạng thái' },
  { key: 'bid_price', label: 'Giá gói' },
  { key: 'bid_form', label: 'Hình thức' },
]

export default function MscSection({ localMode }) {
  const [kind, setKind] = useState('prices')
  const [open, setOpen] = useState(false)
  const [filters, setFilters] = useState({
    q: '', name: '', ingredient: '', registration: '', manufacturer: '',
    province: '', tender_no: '', buyer: '', winner: '', group_name: '', medicine_type: '',
  })
  const [page, setPage] = useState(0)
  const [data, setData] = useState({ total: 0, items: [] })
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const sim = useSimProgress(loading, 'Đang lọc thầu MSC')

  const cols = kind === 'prices' ? PRICE_COLS : TENDER_COLS

  const search = useCallback(async (p = 0) => {
    setLoading(true)
    setErr('')
    try {
      if (localMode) {
        const res = await api.mscSearch({ kind, filters, page: p, size: 50 })
        setData(res)
        setPage(p)
        return
      }
      const { loadStaticGz } = await import('./api')
      const dumped = await loadStaticGz(kind === 'prices' ? 'msc_prices' : 'msc_tenders')
      if (!dumped?.items) {
        setErr('Chưa có MSC export trên Pages.')
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
  }, [kind, filters, localMode])

  useEffect(() => { search(0) }, [kind])

  const setF = (k, v) => setFilters((f) => ({ ...f, [k]: v }))

  return (
    <div>
      <section className="hero">
        <h1>Tra cứu thầu MSC</h1>
        <p>Đơn giá trúng thầu và gói thầu thuốc trên Mua sắm công — bộ lọc thu gọn để tập trung bảng chính.</p>
      </section>
      <div className="panel">
        <div className="panel-head">
          <h2>{kind === 'prices' ? 'Đơn giá thuốc' : 'Gói thầu'}</h2>
          <div className="btn-row">
            <button type="button" className={`btn ${kind === 'prices' ? '' : 'secondary'}`} onClick={() => setKind('prices')}>Đơn giá</button>
            <button type="button" className={`btn ${kind === 'tenders' ? '' : 'secondary'}`} onClick={() => setKind('tenders')}>Gói thầu</button>
          </div>
          <div className="spacer" />
          <button type="button" className="btn ghost" onClick={() => setOpen((v) => !v)}>{open ? 'Thu bộ lọc' : 'Mở bộ lọc'}</button>
          <button type="button" className="btn" onClick={() => search(0)}>Tìm</button>
        </div>
        <div className={`filters ${open ? '' : 'collapsed'}`}>
          <div className="filter-grid">
            <div className="field"><label>Từ khóa</label><input value={filters.q} onChange={(e) => setF('q', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search(0)} /></div>
            {kind === 'prices' ? (
              <>
                <div className="field"><label>Tên thuốc</label><input value={filters.name} onChange={(e) => setF('name', e.target.value)} /></div>
                <div className="field"><label>Hoạt chất</label><input value={filters.ingredient} onChange={(e) => setF('ingredient', e.target.value)} /></div>
                <div className="field"><label>SĐK</label><input value={filters.registration} onChange={(e) => setF('registration', e.target.value)} /></div>
                <div className="field"><label>NSX</label><input value={filters.manufacturer} onChange={(e) => setF('manufacturer', e.target.value)} /></div>
                <div className="field"><label>Nhóm</label><input value={filters.group_name} onChange={(e) => setF('group_name', e.target.value)} /></div>
                <div className="field"><label>Loại thuốc</label><input value={filters.medicine_type} onChange={(e) => setF('medicine_type', e.target.value)} /></div>
                <div className="field"><label>Nhà thầu</label><input value={filters.winner} onChange={(e) => setF('winner', e.target.value)} /></div>
              </>
            ) : (
              <div className="field"><label>Tên gói</label><input value={filters.name} onChange={(e) => setF('name', e.target.value)} /></div>
            )}
            <div className="field"><label>TBMT</label><input value={filters.tender_no} onChange={(e) => setF('tender_no', e.target.value)} /></div>
            <div className="field"><label>Tỉnh</label><input value={filters.province} onChange={(e) => setF('province', e.target.value)} /></div>
            <div className="field"><label>Bệnh viện / CĐT</label><input value={filters.buyer} onChange={(e) => setF('buyer', e.target.value)} /></div>
          </div>
        </div>
        {err && <div style={{ padding: 12, color: 'var(--danger)' }}>{err}</div>}
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>{cols.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {data.items.map((row, i) => (
                <tr key={row.source_id || i}>
                  {cols.map((c) => (
                    <td key={c.key}>
                      {typeof row[c.key] === 'number' ? row[c.key].toLocaleString('vi-VN') : (row[c.key] ?? row.status_code ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
              {!data.items.length && !loading && (
                <tr><td colSpan={cols.length} style={{ textAlign: 'center', padding: 28, color: 'var(--muted)' }}>Không có dữ liệu</td></tr>
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
