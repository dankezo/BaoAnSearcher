import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, openDavLookup } from './api'
import { ColumnPicker, CountSelect, LoadingOverlay, Pagination, useSimProgress } from './components'

const ALL_COLS = [
  { key: 'soDangKy', label: 'Số đăng ký' },
  { key: 'ngayCap', label: 'Ngày cấp' },
  { key: 'tenThuoc', label: 'Tên thuốc' },
  { key: 'hoatChat', label: 'Hoạt chất' },
  { key: 'hamLuong', label: 'Hàm lượng' },
  { key: 'dangBaoChe', label: 'Dạng bào chế' },
  { key: 'dongGoi', label: 'Quy cách đóng gói' },
  { key: 'hanDung', label: 'Hạn dùng' },
  { key: 'soQuyetDinh', label: 'Số quyết định' },
  { key: 'ngayHetHan', label: 'Ngày hết hạn' },
  { key: 'phanLoai', label: 'Phân loại' },
  { key: 'ctySanXuat', label: 'Công ty sản xuất' },
  { key: 'diaChiSanXuat', label: 'Địa chỉ SX' },
  { key: 'nuocSanXuat', label: 'Nước SX' },
  { key: 'ctyDangKy', label: 'Công ty đăng ký' },
  { key: 'diaChiDangKy', label: 'Địa chỉ ĐK' },
  { key: 'nuocDangKy', label: 'Nước ĐK' },
  { key: 'tieuChuan', label: 'Tiêu chuẩn' },
  { key: 'csDongGoi', label: 'CS đóng gói' },
  { key: 'csXuatXuong', label: 'CS xuất xưởng' },
  { key: 'kyCapNam', label: 'Kỳ cấp (năm)' },
]

const COMPACT = [
  'soDangKy', 'ngayCap', 'tenThuoc', 'hoatChat', 'hamLuong', 'dangBaoChe',
  'dongGoi', 'ngayHetHan', 'ctyDangKy', 'ctySanXuat', 'nuocSanXuat',
]

function fmtDate(v) {
  if (!v) return ''
  const s = String(v)
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[3]}/${m[2]}/${m[1]}`
  return s
}

export default function DavSection({ localMode }) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [colPicker, setColPicker] = useState(false)
  const [viewMode, setViewMode] = useState('compact')
  const [visible, setVisible] = useState(COMPACT)
  const [filters, setFilters] = useState({
    q: '', tenThuoc: '', soDangKy: '', hoatChat: '', dangBaoChe: '',
    sanXuat: '', dangKy: '', nuocSanXuat: '',
    ingredientCount: '', ingredientCountOther: '',
    dosageFormCount: '', dosageFormCountOther: '',
    strengthCount: '', strengthCountOther: '',
    conHieuLuc: false,
  })
  const [page, setPage] = useState(0)
  const [data, setData] = useState({ total: 0, items: [] })
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const sim = useSimProgress(loading, 'Đang lọc thuốc DAV')

  useEffect(() => {
    if (viewMode === 'compact') setVisible(COMPACT)
    else if (viewMode === 'full') setVisible(ALL_COLS.map((c) => c.key))
  }, [viewMode])

  const cols = useMemo(
    () => ALL_COLS.filter((c) => visible.includes(c.key)),
    [visible],
  )

  const search = useCallback(async (p = 0) => {
    setLoading(true)
    setErr('')
    try {
      if (localMode) {
        const res = await api.davSearch({ filters, page: p, size: 50 })
        setData(res)
        setPage(p)
        return
      }
      // Pages fallback
      const { loadStaticGz } = await import('./api')
      const dumped = await loadStaticGz('dav')
      if (!dumped?.items) {
        setErr('Chưa có data export. Chạy local rồi python scripts/export_for_pages.py')
        setData({ total: 0, items: [] })
        return
      }
      const q = (filters.q || '').toLowerCase()
      let items = dumped.items
      if (q) {
        const words = q.split(/\s+/).filter(Boolean)
        items = items.filter((r) => {
          const blob = `${r.tenThuoc} ${r.soDangKy} ${r.hoatChat} ${r.hamLuong}`.toLowerCase()
          return words.every((w) => blob.includes(w))
        })
      }
      if (filters.conHieuLuc) items = items.filter((r) => r.conHieuLuc)
      const total = items.length
      setData({ total, items: items.slice(p * 50, p * 50 + 50), page: p, size: 50 })
      setPage(p)
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setLoading(false)
    }
  }, [filters, localMode])

  useEffect(() => { search(0) }, []) // initial

  const setF = (key, val) => setFilters((f) => ({ ...f, [key]: val }))

  return (
    <div>
      <section className="hero">
        <h1>Tra cứu thuốc DAV</h1>
        <p>
          Danh mục số đăng ký từ Cục Quản lý Dược — lọc còn hiệu lực, khớp danh mục 93,
          và mở nhanh trang công bố kèm copy tên thuốc.
        </p>
      </section>

      <div className="panel">
        <div className="panel-head">
          <h2>Bảng chính</h2>
          <div className="spacer" />
          <button type="button" className="btn ghost" onClick={() => setFiltersOpen((v) => !v)}>
            {filtersOpen ? 'Thu gọn bộ lọc' : 'Mở bộ lọc'}
          </button>
          <select
            value={viewMode}
            onChange={(e) => {
              const v = e.target.value
              setViewMode(v)
              if (v === 'custom') setColPicker(true)
            }}
            style={{ borderRadius: 10, border: '1px solid var(--line)', padding: '6px 10px', background: '#fff' }}
          >
            <option value="compact">Rút gọn (mặc định)</option>
            <option value="full">Hiện hết trường</option>
            <option value="custom">Tùy chọn cột…</option>
          </select>
          <button type="button" className="btn" onClick={() => search(0)}>Tìm kiếm</button>
        </div>

        <div className={`filters ${filtersOpen ? '' : 'collapsed'}`}>
          <div className="filter-grid">
            <div className="field"><label>Từ khóa</label><input value={filters.q} onChange={(e) => setF('q', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search(0)} /></div>
            <div className="field"><label>Tên thuốc</label><input value={filters.tenThuoc} onChange={(e) => setF('tenThuoc', e.target.value)} /></div>
            <div className="field"><label>Số ĐK</label><input value={filters.soDangKy} onChange={(e) => setF('soDangKy', e.target.value)} /></div>
            <div className="field"><label>Hoạt chất</label><input value={filters.hoatChat} onChange={(e) => setF('hoatChat', e.target.value)} /></div>
            <div className="field"><label>Dạng bào chế</label><input value={filters.dangBaoChe} onChange={(e) => setF('dangBaoChe', e.target.value)} /></div>
            <div className="field"><label>Công ty SX</label><input value={filters.sanXuat} onChange={(e) => setF('sanXuat', e.target.value)} /></div>
            <div className="field"><label>Công ty ĐK</label><input value={filters.dangKy} onChange={(e) => setF('dangKy', e.target.value)} /></div>
            <div className="field"><label>Nước SX</label><input value={filters.nuocSanXuat} onChange={(e) => setF('nuocSanXuat', e.target.value)} /></div>
            <CountSelect label="Số hoạt chất" value={filters.ingredientCount} otherValue={filters.ingredientCountOther}
              options={[1, 2, 3, 4, 5]} onChange={(v) => setF('ingredientCount', v)} onOther={(v) => setF('ingredientCountOther', v)} />
            <CountSelect label="Số dạng bào chế (nhóm HC)" value={filters.dosageFormCount} otherValue={filters.dosageFormCountOther}
              options={[1, 2, 3, 4, 5, 6, 7]} onChange={(v) => setF('dosageFormCount', v)} onOther={(v) => setF('dosageFormCountOther', v)} />
            <CountSelect label="Mức hàm lượng (nhóm HC)" value={filters.strengthCount} otherValue={filters.strengthCountOther}
              options={[1, 3, 4, 5]} onChange={(v) => setF('strengthCount', v)} onOther={(v) => setF('strengthCountOther', v)} />
            <div className="field">
              <label>Còn hiệu lực (tiêu chí KD)</label>
              <select value={filters.conHieuLuc ? '1' : '0'} onChange={(e) => setF('conHieuLuc', e.target.value === '1')}>
                <option value="0">Tắt</option>
                <option value="1">Bật — kỳ cấp ≥ 3 năm, loại DM93…</option>
              </select>
            </div>
          </div>
          <div className="btn-row">
            <button type="button" className="btn" onClick={() => search(0)}>Áp dụng</button>
            <button type="button" className="btn secondary" onClick={() => {
              setFilters({
                q: '', tenThuoc: '', soDangKy: '', hoatChat: '', dangBaoChe: '',
                sanXuat: '', dangKy: '', nuocSanXuat: '',
                ingredientCount: '', ingredientCountOther: '',
                dosageFormCount: '', dosageFormCountOther: '',
                strengthCount: '', strengthCountOther: '',
                conHieuLuc: false,
              })
            }}>Xóa lọc</button>
            {localMode && (
              <button type="button" className="btn ghost" onClick={() => api.davValidity().catch((e) => alert(e.message))}>
                Rebuild tập hiệu lực
              </button>
            )}
          </div>
        </div>

        <ColumnPicker allColumns={ALL_COLS} visible={visible} onChange={setVisible} open={colPicker} onClose={() => setColPicker(false)} />

        {err && <div style={{ padding: '10px 16px', color: 'var(--danger)' }}>{err}</div>}

        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>STT</th>
                {cols.map((c) => <th key={c.key}>{c.label}</th>)}
                <th>Tra cứu</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row, i) => (
                <tr key={row.id || i}>
                  <td>{page * 50 + i + 1}</td>
                  {cols.map((c) => {
                    let val = row[c.key]
                    if (c.key === 'ngayCap' || c.key === 'ngayHetHan' || c.key === 'ngayGiaHan') val = fmtDate(val)
                    if (c.key === 'soDangKy') {
                      return <td key={c.key}><a className="sdk" href={`https://dichvucong.dav.gov.vn/congbothuoc/index`} target="_blank" rel="noreferrer">{val}</a></td>
                    }
                    if (c.key === 'ngayHetHan') {
                      return (
                        <td key={c.key}>
                          {fmtDate(row.ngayHetHan)}{' '}
                          {row.conHieuLuc
                            ? <span className="badge">Hiệu lực</span>
                            : <span className="badge off">Hết / không đủ</span>}
                        </td>
                      )
                    }
                    return <td key={c.key}>{val ?? ''}</td>
                  })}
                  <td>
                    <button
                      type="button"
                      className="lookup-btn"
                      title="Copy tên thuốc & mở DAV"
                      onClick={() => openDavLookup(row.tenThuoc)}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
              {!data.items.length && !loading && (
                <tr><td colSpan={cols.length + 2} style={{ textAlign: 'center', padding: 28, color: 'var(--muted)' }}>Không có dữ liệu</td></tr>
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
