import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import { cloudDavSearch, cloudMscSearch, cloudVssSearch } from './supabaseCloud'
import { beIngredients, BE_SOURCE, BE_SCOPE, searchRows } from './regulatoryData'
import './regulatory.css'
import { LegalSearch, RegulatoryAdmin, MorningBrief } from './components/regulatory/RegulatoryViews'

const sections = [['news', 'Bảng tin pháp luật'], ['sources', 'Nguồn tin & quản trị'], ['documents', 'Văn bản pháp luật'], ['dm93', 'Danh mục 93'], ['be', 'Hoạt chất BE'], ['bhyt', 'Danh mục BHYT'], ['linked', 'Dữ liệu liên quan']]
const base = import.meta.env.BASE_URL || '/'

function LinkedResults({ query, localMode }) {
  const [source, setSource] = useState('dav')
  const [page, setPage] = useState(0)
  const [state, setState] = useState({ loading: false, items: [], total: null, error: '' })
  const [retry, setRetry] = useState(0)
  useEffect(() => { setPage(0) }, [query, source])
  useEffect(() => {
    let live = true
    if (query.trim().length < 2) { setState({ loading: false, items: [], total: null, error: '' }); return }
    setState({ loading: true, items: [], total: null, error: '' })
    const timer = setTimeout(async () => {
      try {
        const request = { filters: { q: query.trim() }, page, size: 25 }
        const fn = localMode ? { dav: api.davSearch, msc: api.mscSearch, vss: api.vssSearch } : { dav: cloudDavSearch, msc: cloudMscSearch, vss: cloudVssSearch }
        const result = await fn[source]({ ...request, kind: 'prices' })
        if (!Array.isArray(result?.items)) throw new Error('Nguồn dữ liệu trả về không hợp lệ.')
        if (live) setState({ loading: false, items: result.items, total: result.total ?? null, error: '' })
      } catch (error) { if (live) setState({ loading: false, items: [], total: null, error: error.message }) }
    }, 350)
    return () => { live = false; clearTimeout(timer) }
  }, [query, source, page, localMode, retry])
  return <section>
    <div className="rh-toolbar"><label>Nguồn dữ liệu <select value={source} onChange={e => setSource(e.target.value)}><option value="dav">Thuốc DAV</option><option value="msc">Giá trúng thầu MSC</option><option value="vss">BHYT VSS</option></select></label><a href={`#${source}`}>Mở miniapp đầy đủ ↗</a></div>
    <p className="rh-muted">Tra cứu toàn bộ nguồn đang kết nối, 25 kết quả mỗi trang. Kết quả tìm kiếm không chứng minh thuốc đã đạt BE hoặc đủ điều kiện dự thầu.</p>
    {query.trim().length < 2 ? <p className="rh-empty">Nhập ít nhất 2 ký tự để tra cứu dữ liệu liên quan.</p> : state.loading ? <p role="status">Đang tra cứu {source.toUpperCase()}…</p> : state.error ? <div role="alert" className="rh-notice">{state.error} <button onClick={() => setRetry(v => v + 1)}>Thử lại</button></div> : <>
      <p role="status">{state.total == null ? 'Chưa có tổng số' : `${state.total.toLocaleString('vi-VN')} kết quả`} · Trang {page + 1}</p>
      <div className="rh-scroll"><table><thead><tr><th>Thuốc / hoạt chất</th><th>Số đăng ký</th><th>Hàm lượng</th><th>Nhà sản xuất</th><th>Nhóm / giá</th></tr></thead><tbody>{state.items.map((r, i) => <tr key={i}><td><strong>{r.tenThuoc || r.name || r.ten || '—'}</strong><small>{r.hoatChat || r.ingredient || r.hoatchat}</small></td><td>{r.soDangKy || r.registration || r.sodk || '—'}</td><td>{r.hamLuong || r.strength || r.hamluong || '—'}</td><td>{r.ctySanXuat || r.manufacturer || r.nhasx || '—'}</td><td>{r.group_name || r.nhomthau || '—'} / {r.unit_price ?? r.gia ?? '—'}</td></tr>)}</tbody></table></div>
      {!state.items.length && <p className="rh-empty">Không tìm thấy kết quả trong nguồn này.</p>}
      <div className="rh-toolbar"><button disabled={page === 0} onClick={() => setPage(v => v - 1)}>← Trước</button><button disabled={state.total == null ? state.items.length < 25 : (page + 1) * 25 >= state.total} onClick={() => setPage(v => v + 1)}>Sau →</button></div>
    </>}
  </section>
}

export default function RegulatoryHub({ localMode }) {
  const [view, setView] = useState('news')
  const [query, setQuery] = useState('')
  const [catalogs, setCatalogs] = useState({})
  const [errors, setErrors] = useState({})
  const [retry, setRetry] = useState(0)
  const [copied, setCopied] = useState('')
  const timer = useRef(null)
  useEffect(() => {
    const abort = new AbortController()
    setErrors({})
    for (const [key, file] of [['dm93', 'dm93.json'], ['bhyt', 'tt20_bhyt.json']]) {
      fetch(`${base}data/${file}`, { signal: abort.signal }).then(r => { if (!r.ok) throw new Error(`Không tải được danh mục (${r.status}).`); return r.json() }).then(rows => {
        if (!Array.isArray(rows)) throw new Error('Danh mục không đúng định dạng.')
        setCatalogs(v => ({ ...v, [key]: rows }))
      }).catch(e => { if (e.name !== 'AbortError') setErrors(v => ({ ...v, [key]: e.message })) })
    }
    return () => abort.abort()
  }, [retry])
  useEffect(() => () => clearTimeout(timer.current), [])
  const rows = useMemo(() => searchRows(view === 'be' ? beIngredients : catalogs[view] || [], query), [view, query, catalogs])
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(new URL('#regulatory', window.location.href).href); setCopied('Đã sao chép link') }
    catch { setCopied('Hãy sao chép đường dẫn trên thanh địa chỉ.') }
    clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(''), 4000)
  }
  return <div className="regulatory-hub">
    <header className="rh-masthead"><div><span className="rh-eyebrow">BẢO AN • DÀNH CHO NGƯỜI LÀM THẦU</span><h1>Bản tin thầu thuốc</h1></div><div className="rh-masthead-date">{new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' })}<button className="rh-text-link" onClick={copyLink}>Chia sẻ đường dẫn ↗</button><small role="status">{copied}</small></div></header>
    <div className="rh-reader-tools"><nav aria-label="Điều hướng bản tin"><button className={view === 'news' || view === 'allnews' ? 'active' : ''} onClick={() => { setView('news'); setQuery('') }}>Bản tin cần đọc</button><button className={view !== 'news' && view !== 'allnews' ? 'active' : ''} onClick={() => setView('documents')}>Tra cứu</button></nav><div className="rh-search"><label className="rh-sr-only" htmlFor="regulatory-search">Tìm văn bản hoặc hoạt chất</label><div><input id="regulatory-search" value={query} onChange={e => { setQuery(e.target.value); if(view === 'news') setView('documents') }} placeholder="Tìm số hiệu, tên thuốc, BE, BHYT…" /><button onClick={() => setQuery('')} disabled={!query} aria-label="Xóa tìm kiếm">Xóa</button></div></div></div>
    <details className="rh-lookup-menu"><summary>Tra cứu nhanh: văn bản · BE · danh mục thuốc</summary><nav aria-label="Nhóm tra cứu pháp lý">{sections.filter(([id])=>!['news','sources'].includes(id)).map(([id,label])=><button key={id} className={view===id?'active':''} onClick={()=>setView(id)}>{label}</button>)}</nav><p>Danh mục 93 và BHYT là dữ liệu đang có; cần đối chiếu cập nhật trước khi áp dụng.</p></details>
    <div className="rh-workspace"><div className="rh-content">
        {view === 'news' ? <MorningBrief onSearch={value=>{setQuery(value);setView('documents')}} onSources={()=>setView('sources')} onAllNews={()=>{setQuery('');setView('allnews')}} /> : view === 'allnews' || view === 'documents'  ? <LegalSearch key={view} query={query} news={view === 'allnews'} /> : view === 'sources' ? <RegulatoryAdmin /> : view === 'linked' ? <LinkedResults query={query} localMode={localMode} /> : <>
          <h2>{sections.find(s => s[0] === view)?.[1]}</h2><p className="rh-muted">{view === 'be' ? BE_SCOPE : view === 'dm93' ? '93 dòng theo dữ liệu hiện có, căn cứ TT 03/2024. Đối chiếu đồng thời hoạt chất, hàm lượng và dạng bào chế; không chỉ tên hoạt chất.' : 'Tái sử dụng danh mục TT20 BHYT của ứng dụng. Các cột tuyến/hạng được giữ theo dữ liệu gốc; cần đối chiếu quy định cập nhật trước khi kết luận thanh toán.'}</p>
          {errors[view] ? <div role="alert">{errors[view]} <button onClick={() => setRetry(v => v + 1)}>Tải lại</button></div> : view !== 'be' && !catalogs[view] ? <p role="status">Đang tải danh mục…</p> : <><p role="status">{rows.length} dòng phù hợp · Bấm tên hoạt chất để tra cứu DAV / MSC / VSS</p><div className="rh-scroll"><table><thead><tr><th>STT</th><th>Hoạt chất</th><th>{view === 'bhyt' ? 'Đường dùng' : 'Hàm lượng / dạng bào chế'}</th><th>{view === 'bhyt' ? 'ĐB–I / II / III–IV / Trạm YT' : 'Căn cứ'}</th></tr></thead><tbody>{rows.map((r, i) => <tr key={`${r.stt}-${i}`}><td>{r.stt}</td><td><button className="rh-text-link" onClick={() => { setQuery(r.hoatChat); setView('linked') }}>{r.hoatChat} ↗</button>{r.aliases && <small>{r.aliases}</small>}</td><td>{view === 'bhyt' ? r.duongDung : [r.hamLuong, r.dangBaoChe].filter(Boolean).join(' · ')}</td><td>{view === 'be' ? <a href={`${BE_SOURCE}#page=20`} target="_blank" rel="noreferrer">TT 07/2022 · Phụ lục I</a> : view === 'dm93' ? 'TT 03/2024 · dữ liệu nội bộ' : <>{[r.hangDB_I, r.hangII, r.hangIII_IV, r.tramYT].map(v => v || '—').join(' / ')}{r.ghiChu && <small>{r.ghiChu}</small>}</>}</td></tr>)}</tbody></table></div>{!rows.length && <p className="rh-empty">Không tìm thấy trong danh mục này. Không thể suy ra thuốc được miễn BE hoặc ngoài phạm vi pháp luật.</p>}</>}
        </>}
      </div></div>
    <footer className="rh-site-footer"><span>Bảo An Pharma · Thông tin có nguồn, nhận định có giới hạn</span><button className="rh-text-link" onClick={()=>setView('sources')}>Nguồn tin & quản trị</button></footer>
  </div>
}
