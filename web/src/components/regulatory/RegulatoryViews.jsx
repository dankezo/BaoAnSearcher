import { useEffect, useState } from 'react'
import ReadingText from './ReadingText'
import { regulatoryRequest } from '../../services/regulatoryService'
import { categories, statuses, isNew } from '../../../../lib/regulatory/domain.js'

const date = value => value ? new Date(value.length === 10 ? `${value}T00:00:00+07:00` : value).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : 'Chưa xác nhận'
const link = (url, label) => url && <a href={url} target="_blank" rel="noreferrer">{label} ↗</a>
export function editorialTitle(item) {
  if (/công bố Danh mục thuốc/.test(item.title) && /điểm c khoản 1 Điều 4/.test(item.title) && /40\/2025\/TT-BYT/.test(item.title)) return 'Danh mục thuốc đáp ứng điểm c khoản 1 Điều 4 TT 40/2025'
  const text=item.title.replace(/^Quyết định số\s+\S+\s+về việc\s+/i,'')
  const shortened=text.length>145?`${text.slice(0,142).replace(/\s+\S*$/,'')}…`:text
  return shortened.charAt(0).toUpperCase()+shortened.slice(1)
}
function useResource(params, refresh) {
  const [state, setState] = useState({ loading: true, items: [], total: 0 })
  const key = JSON.stringify(params)
  useEffect(() => {
    const controller = new AbortController()
    setState(s => ({ ...s, loading: true, error: '' }))
    const timer = setTimeout(() => regulatoryRequest(JSON.parse(key), undefined, controller.signal).then(data => {
      if (!controller.signal.aborted) setState({ ...data, loading: false })
    }).catch(e => { if (!controller.signal.aborted) setState({ loading: false, error: e.message, items: [], total: 0 }) }), 300)
    return () => { clearTimeout(timer); controller.abort() }
  }, [key, refresh])
  return state
}
function Provenance({ item }) {
  return <div className="rh-provenance"><span>{item.source_name || 'Hồ sơ văn bản'} · {link(item.source_url, 'Nguồn gốc')} {link(item.pdf_url, 'PDF')}</span><span>Đối chiếu: {date(item.reviewed_at)} · {link(item.review_source, 'Căn cứ đối chiếu')}</span>{item.fetched_at && <span>Lấy tin: {date(item.fetched_at)}</span>}</div>
}
function Editor({ entity, initial, onClose, onSaved }) {
  const [form, setForm] = useState(initial || (entity === 'source' ? { name: '', url: '', kind: 'html', enabled: true, interval_hours: 24, keywords: '' } : { title: '', category: 'Khác', legal_status: 'unknown' }))
  const [saving, setSaving] = useState(false), [error, setError] = useState('')
  const field = (key, label, type = 'text', required = false) => <label key={key}>{label}<input type={type} required={required} value={form[key] || ''} onChange={e => setForm(v => ({ ...v, [key]: e.target.value }))} /></label>
  const select = (key, label, options) => <label>{label}<select value={form[key]} onChange={e => setForm(v => ({ ...v, [key]: e.target.value }))}>{options.map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select></label>
  return <section className="rh-editor" aria-label="Biên tập dữ liệu"><h3>{initial ? 'Chỉnh sửa' : 'Thêm'} {entity === 'source' ? 'nguồn tin' : 'văn bản'}</h3><form onSubmit={async e => {
    e.preventDefault(); setSaving(true); setError('')
    try { await regulatoryRequest({}, { entity, data: form }); onSaved() } catch (e) { setError(e.message) } finally { setSaving(false) }
  }}><div className="rh-form-grid">{entity === 'source' ? <>
    {field('name', 'Tên nguồn', 'text', true)}{field('url', 'URL chuyên mục / RSS', 'url', true)}
    {select('kind', 'Định dạng', [['html', 'HTML'], ['rss', 'RSS']])}{field('interval_hours', 'Khoảng cách giữa hai lượt (6–168 giờ)', 'number')}{field('keywords', 'Từ khóa, phân cách bằng dấu phẩy')}
    <label><input type="checkbox" checked={!!form.enabled} onChange={e => setForm(v => ({ ...v, enabled: e.target.checked }))} /> Bật nguồn</label>
  </> : <>
    {field('title', 'Tên văn bản', 'text', true)}{field('code', 'Số hiệu')}{select('category', 'Chủ đề', categories.map(v => [v, v]))}{select('legal_status', 'Tình trạng hiệu lực', Object.entries(statuses))}
    {field('source_url', 'Link gốc', 'url', true)}{field('pdf_url', 'Link PDF', 'url')}
    {field('issued_at', 'Ngày ban hành', 'date')}{field('published_at', 'Ngày đăng tin', 'date')}{field('effective_at', 'Ngày bắt đầu hiệu lực', 'date')}{field('expires_at', 'Ngày hết hiệu lực', 'date')}{field('reviewed_at', 'Ngày đối chiếu', 'date')}{field('review_source', 'Link căn cứ xác minh', 'url')}
    <label>Tóm tắt<textarea value={form.summary || ''} onChange={e => setForm(v => ({ ...v, summary: e.target.value }))} /></label><label>Ghi chú đối chiếu<textarea value={form.review_note || ''} onChange={e => setForm(v => ({ ...v, review_note: e.target.value }))} /></label>
  </>}</div>{error && <p role="alert">{error}</p>}<div className="rh-toolbar"><button disabled={saving} type="submit">{saving ? 'Đang lưu…' : 'Lưu dữ liệu'}</button><button type="button" disabled={saving} onClick={onClose}>Đóng</button></div></form></section>
}
function Related({ id }) {
  const state = useResource({ related: id }, 0)
  return <div className="rh-related"><h4>Văn bản liên quan</h4>{state.loading ? <p role="status">Đang tải…</p> : state.error ? <p role="alert">{state.error}</p> : state.items.length ? state.items.map(d => <article key={d.id}><strong>{d.code} · {d.title}</strong><p>{d.reason}</p><span className="rh-badge">{statuses[d.legal_status]}</span><Provenance item={d} /></article>) : <p>Chưa có văn bản liên quan.</p>}</div>
}
export function LegalSearch({ query, news = false }) {
  const [category, setCategory] = useState(''), [status, setStatus] = useState(''), [unread, setUnread] = useState(false)
  const [page, setPage] = useState(0), [refresh, setRefresh] = useState(0), [selected, setSelected] = useState(null)
  const [editor, setEditor] = useState(null), [pending, setPending] = useState(null), [error, setError] = useState('')
  useEffect(() => { setPage(0); setSelected(null) }, [query, category, status, unread, news])
  const state = useResource({ view: news ? 'news' : 'documents', q: query, category, status, unread: unread ? '1' : '0', page }, refresh)
  return <section><h2>{news ? 'Bảng tin pháp luật' : 'Tra cứu pháp luật'}</h2><p className="rh-muted">{news ? 'Tin được lấy theo lịch từng nguồn. Nội dung tự động cần được đối chiếu trước khi áp dụng.' : 'Tìm theo số hiệu, từ khóa có hoặc không dấu. Gợi ý liên quan ghi rõ quan hệ với văn bản đang xem.'}</p>
    <div className="rh-toolbar"><label>Chủ đề <select value={category} onChange={e => setCategory(e.target.value)}><option value="">Tất cả</option>{categories.map(v => <option key={v}>{v}</option>)}</select></label>
    {!news && <label>Hiệu lực <select value={status} onChange={e => setStatus(e.target.value)}><option value="">Tất cả</option>{Object.entries(statuses).map(([v, label]) => <option value={v} key={v}>{label}</option>)}</select></label>}
    {news && <label><input type="checkbox" checked={unread} onChange={e => setUnread(e.target.checked)} /> Chưa đọc</label>}<button onClick={() => setRefresh(v => v + 1)}>Tải lại</button>{state.canEdit && <button onClick={() => setEditor({})}>+ Văn bản</button>}</div>
    {editor && <Editor key={editor.id || 'new'} entity="document" initial={editor.id ? editor : undefined} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setRefresh(v => v + 1) }} />}
    {error && <p role="alert">{error}</p>}{state.loading ? <p role="status">Đang tải dữ liệu…</p> : state.error ? <p role="alert" className="rh-notice">{state.error}</p> : <>
      <p role="status">{state.total} kết quả · Trang {page + 1}</p><div className="rh-feed">{state.items.map(d => <article className={`rh-news-card ${d.read_at ? 'is-read' : ''}`} key={d.id}>
        <div className="rh-toolbar"><span className="rh-code">{d.code || 'Chưa trích xuất số hiệu'}</span><span className="rh-badge">{d.category}</span>{isNew(d) && <span className="rh-badge checked">Mới</span>}</div>
        <h3>{d.title}</h3><p className="rh-summary">{d.summary || 'Chưa có tóm tắt; xem văn bản gốc.'}</p><div className="rh-dates"><span>Ban hành: {date(d.issued_at)}</span>{news && <span>Đăng tin: {date(d.published_at)}</span>}<span>Hiệu lực từ: {date(d.effective_at)}</span><span className="rh-badge">{statuses[d.legal_status] || statuses.unknown}</span></div>
        <Provenance item={d} /><div className="rh-toolbar"><button disabled={pending === d.id} onClick={async () => { setPending(d.id); setError(''); try { await regulatoryRequest({}, { action: 'read', id: d.id, read: !d.read_at }); setRefresh(v => v + 1) } catch (e) { setError(e.message) } finally { setPending(null) } }}>{d.read_at ? 'Đã đọc · Đánh dấu chưa đọc' : 'Đánh dấu đã đọc'}</button><button onClick={() => setSelected(selected === d.id ? null : d.id)} aria-expanded={selected === d.id}>Chi tiết & liên quan</button>{state.canEdit && <button onClick={() => setEditor(d)}>Sửa</button>}</div>
        {selected === d.id && <><ReadingText text={d.summary} /><ReadingText text={d.review_note || 'Chưa đối chiếu pháp lý.'} />{d.expires_at && <p>Hết hiệu lực từ: {date(d.expires_at)}</p>}<Related id={d.id} /></>}
      </article>)}</div>{!state.items.length && <p className="rh-empty">{news ? 'Chưa có tin phù hợp. Xem tình trạng thu thập tại Nguồn tin & quản trị.' : 'Không tìm thấy văn bản phù hợp. Thử rút gọn từ khóa.'}</p>}
      <div className="rh-toolbar"><button disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Trước</button><button disabled={(page + 1) * 20 >= state.total} onClick={() => setPage(p => p + 1)}>Sau →</button></div>
    </>}</section>
}
export function RegulatoryAdmin() {
  const [refresh, setRefresh] = useState(0), [editor, setEditor] = useState(null)
  const state = useResource({ view: 'sources' }, refresh)
  return <section><h2>Nguồn tin & quản trị</h2><p className="rh-muted">Lịch cloud buổi sáng 06:00–07:00, giờ Việt Nam. Bộ Y tế, Cục Quản lý Dược và Báo Chính phủ là nguồn chính thức; Thư viện Pháp luật là nguồn tham khảo. Lỗi nguồn được giữ minh bạch dưới đây.</p><div className="rh-toolbar"><button onClick={() => setRefresh(v => v + 1)}>Tải lại</button>{state.canEdit && <><button onClick={() => setEditor({ entity: 'source' })}>+ Nguồn tin</button><button onClick={() => setEditor({ entity: 'document' })}>+ Văn bản</button></>}</div>
    {editor && <Editor key={editor.initial?.id || editor.entity} {...editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setRefresh(v => v + 1) }} />}
    {state.loading ? <p role="status">Đang tải nguồn…</p> : state.error ? <p role="alert">{state.error}</p> : <><div className="rh-feed">{state.items.map(s => <article key={s.id} className="rh-news-card"><h3>{s.name}</h3><p>{s.official ? 'Nguồn chính thức' : 'Nguồn tham khảo'} · {s.enabled ? 'Đang bật' : 'Đang tắt'} · {s.interval_hours} giờ/lượt</p>{link(s.url, 'Mở nguồn')}<p>Thử cập nhật: {date(s.last_attempt)} · Thành công gần nhất: {date(s.last_success)}</p>{s.last_error && <p className="rh-notice">{s.last_error}</p>}{state.canEdit && <button onClick={() => setEditor({ entity: 'source', initial: s })}>Sửa nguồn</button>}</article>)}</div><h3>Lịch sử cập nhật</h3><div className="rh-scroll"><table><thead><tr><th>Nguồn</th><th>Thời điểm</th><th>Kết quả</th><th>Số bài xử lý</th><th>Chi tiết</th></tr></thead><tbody>{state.runs?.map(r => <tr key={r.id}><td>{r.source_id}</td><td>{new Date(r.started_at).toLocaleString('vi-VN')}</td><td>{{ ok: 'Thành công', partial: 'Một phần', error: 'Lỗi', running: 'Đang chạy' }[r.state]}</td><td>{r.item_count}</td><td>{r.message || '—'}</td></tr>)}</tbody></table></div>{!state.canEdit && <p className="rh-muted">Đăng nhập tài khoản quản trị để thêm hoặc sửa nguồn và văn bản.</p>}</>}
  </section>
}

export function MorningBrief({ onSearch, onSources, onAllNews }) {
  const [refresh,setRefresh] = useState(0)
  const state = useResource({view:'brief'},refresh)
  if(state.loading) return <p role="status" className="rh-empty">Đang mở bản tin…</p>
  if(state.error) return <div role="alert" className="rh-notice">{state.error} <button onClick={()=>setRefresh(v=>v+1)}>Thử lại</button></div>
  const items=state.items||[], sources=(state.sources||[]).filter(s=>s.enabled)
  const leadCount=Math.min(3,items.filter(d=>d.insight.priority>=65).length)
  const healthy=sources.filter(s=>s.last_success && !s.last_error && Date.now()-Date.parse(s.last_success)<36*3600000)
  const newest=healthy.map(s=>s.last_success).sort().at(-1)
  return <section className="rh-edition">
    <div className="rh-edition-meta"><span>{newest ? `Cập nhật ${new Date(newest).toLocaleString('vi-VN',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit',timeZone:'Asia/Ho_Chi_Minh'})}` : 'Chưa có lượt lấy tin gần đây'}</span><button className="rh-text-link" onClick={onSources}>{healthy.length}/{sources.length} nguồn {healthy.length<sources.length?'· xem lỗi':''}</button></div>
    <div className="rh-edition-heading"><div className="rh-eyebrow">ĐỌC TRƯỚC KHI VÀO VIỆC</div><h2>Điểm tin cần chú ý</h2><p>Tin trong 30 ngày, ưu tiên theo ảnh hưởng đến đấu thầu.</p></div>
    {items.length > 0 && leadCount === 0 && <p>Chưa ghi nhận tin cần ưu tiên trong dữ liệu đã lấy. Các cập nhật theo dõi nằm bên dưới.</p>}
    {!items.length ? <div className="rh-empty">Chưa có tin trong 30 ngày gần đây. <button onClick={onAllNews}>Xem kho tin</button></div> : <div className={`rh-editorial-grid ${leadCount===1?'single-story':''}`}>{items.slice(0,leadCount).map((d,index)=><article key={d.id} className={`rh-story ${index===0?'rh-story-lead':''}`}>
      <div className="rh-story-kicker"><span>{d.insight.priority>=85?'CẦN ĐỌC':d.insight.priority>=65?'NÊN THEO DÕI':'THAM KHẢO'}</span><span>{d.category} · {date(d.issued_at||d.published_at)}</span></div>
      <h3>{editorialTitle(d)}</h3><p className="rh-story-reason">{d.insight.reason}</p>
      <div className="rh-impact"><strong>Ảnh hưởng đến thầu</strong><p>{d.insight.impact}</p><strong>Việc cần kiểm tra</strong><p>{d.insight.action}</p></div>
      <div className="rh-story-meta">{d.insight.method==='ai'?'AI gợi ý · cần chuyên viên đối chiếu':'Sàng lọc theo quy tắc · chưa dùng diễn giải AI'}</div>
      <details><summary>Căn cứ & văn bản</summary><h4>{d.title}</h4>{d.insight.evidence_quote && <blockquote><ReadingText text={d.insight.evidence_quote} /></blockquote>}<ReadingText text={d.summary} /><p>Hiệu lực: {statuses[d.legal_status]}</p><Provenance item={d} /><button onClick={()=>onSearch(d.code||d.title)}>Tra cứu & liên quan</button></details>
      <div className="rh-story-source">{link(d.source_url,`${d.source_name||'Nguồn gốc'} · ${d.code||'Xem bài'}`)}</div>
    </article>)}</div>}
    {items.length>leadCount && <section className="rh-news-desk"><h3>Cập nhật khác</h3>{items.slice(leadCount).map(d=><details key={d.id} className="rh-news-row"><summary><span>{d.category}</span><strong>{d.title}</strong><time>{date(d.issued_at||d.published_at)}</time></summary><p>{d.insight.reason}</p><p><strong>Ảnh hưởng:</strong> {d.insight.impact}</p><p><strong>Kiểm tra:</strong> {d.insight.action}</p><small>{d.insight.method==='ai'?'AI gợi ý, chưa duyệt':'Sàng lọc theo quy tắc'}</small><Provenance item={d}/></details>)}</section>}
    <div className="rh-edition-footer"><button onClick={onAllNews}>Tất cả tin & đánh dấu đã đọc →</button><button onClick={()=>onSearch('')}>Tra cứu văn bản →</button></div>
    <p className="rh-footnote">Mức ưu tiên là gợi ý đọc, chưa đối chiếu danh mục sản phẩm của doanh nghiệp. Chỉ kết luận ảnh hưởng sau khi so khớp thuốc, phụ lục và phạm vi áp dụng.</p>
  </section>
}
