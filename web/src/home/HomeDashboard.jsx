import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { userKeyPart } from '../userPrefs'
import { StatusBadge } from '../bidStatus'
import { regulatoryRequest } from '../services/regulatoryService'
import { analyzeLegal, analyzeNews } from '../services/geminiService'
import { cloudMetricsSlice, cloudMscSearch } from '../supabaseCloud'
import { editorialTitle } from '../components/regulatory/RegulatoryViews'
import { LEGAL_CORE, LEGAL_FILTERS, LEGAL_STATUS, filterLegal } from './legalCatalog'
import { natureOf, sourceBadge, splitBrief } from './briefSplit'
import { countdownLabel, mergeTenders, moneyLabel, parseDateMs, radarView, techGroup } from './tenderRadar'
import { countTopic, defaultTopicName, topicSentence } from './watchTopics'
import Watchlist from './Watchlist'
import '../home.css'

function Sheet({ open, title, onClose, children, bottom = false, leftDesktop = false }) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined
    const onKey = (event) => { if (event.key === 'Escape') closeRef.current() }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [open])
  if (!open) return null
  return (
    <div className={`home-sheet-root${bottom ? ' home-sheet-bottom-root' : ''}${leftDesktop ? ' home-sheet-left-desktop' : ''}`} role="presentation" onClick={onClose}>
      <aside
        className={`home-sheet${bottom ? ' home-sheet-bottom' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="home-sheet-handle" aria-hidden="true" />
        <header className="home-sheet-bar">
          <h2>{title}</h2>
          <button type="button" className="home-icon-btn" onClick={onClose} aria-label="Đóng">×</button>
        </header>
        <div className="home-sheet-body">{children}</div>
      </aside>
    </div>
  )
}

function TenderRadar({ localMode, user, onOpenMsc }) {
  const [panel, setPanel] = useState(null)
  const [watchTopics, setWatchTopics] = useState([])
  const rememberTopics = useCallback((next) => setWatchTopics(next), [])
  const [state, setState] = useState({ loading: true, openItems: [], recentItems: [], error: '', capped: false, matchExact: null })
  const [picked, setPicked] = useState(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let live = true
    setState(s => ({ ...s, loading: true, error: '' }))
    const load = async () => {
      const searchOpen = () => (localMode
        ? api.mscSearch({ kind: 'tenders', filters: { metricQuick: 'open_all' }, page: 0, size: 80 })
        : cloudMscSearch({ kind: 'tenders', filters: { metricQuick: 'open_all', metricMonths: 12 }, page: 0, size: 80 }))
      const searchRecent = () => (localMode
        ? api.mscSearch({ kind: 'tenders', filters: {}, page: 0, size: 80 })
        : cloudMscSearch({ kind: 'tenders', filters: {}, page: 0, size: 80 }))
      const loadSlice = () => (localMode
        ? api.metricsSlice({ section: 'msc_tenders', months: 12, filters: {} })
        : cloudMetricsSlice({ section: 'msc_tenders', months: 12, filters: {} }))
      const slicePromise = loadSlice().catch(() => null)
      // Cloud search shares one abort key per kind, so these two must not run together.
      const openRes = await searchOpen()
      const recentRes = await searchRecent()
      const slice = await slicePromise
      const exactOnPage = (openRes.items || []).filter((row) => row?.baoan_match === 'exact').length
      return {
        openItems: openRes.items || [],
        recentItems: recentRes.items || [],
        capped: !!(openRes.hasMore || recentRes.hasMore),
        matchExact: Number.isFinite(Number(slice?.matchExact)) ? Number(slice.matchExact) : exactOnPage,
      }
    }
    load()
      .then(data => { if (live) setState({ loading: false, error: '', ...data }) })
      .catch(error => { if (live) setState({ loading: false, openItems: [], recentItems: [], error: error.message, capped: false, matchExact: null }) })
    return () => { live = false }
  }, [localMode, retry])

  const view = useMemo(
    () => radarView(state.openItems, state.recentItems, 'open'),
    [state.openItems, state.recentItems],
  )
  const sample = useMemo(
    () => mergeTenders(state.openItems, state.recentItems),
    [state.openItems, state.recentItems],
  )
  const togglePanel = (key) => setPanel(current => (current === key ? null : key))
  const matchCount = state.matchExact == null ? view.counts.match : state.matchExact
  const matchNote = state.loading ? '(… gói khớp)' : `(${matchCount.toLocaleString('vi-VN')} gói khớp)`
  const weekLine = state.loading
    ? '… mới tuần này / … sắp đóng'
    : `${view.counts.fresh.toLocaleString('vi-VN')} mới tuần này / ${view.counts.closing.toLocaleString('vi-VN')} sắp đóng`
  const panelLabel = panel === 'open' ? 'Đang mở' : panel === 'week' ? 'Mới tuần này và sắp đóng' : 'Mục theo dõi'

  return (
    <section className="home-block" aria-label="Nhịp thầu">
      <header className="home-block-head">
        <h2>Nhịp thầu</h2>
        <button type="button" className="home-text" onClick={onOpenMsc}>Mở Thầu MSC</button>
      </header>
      {state.error && <p className="home-alert" role="alert">{state.error} <button type="button" onClick={() => setRetry(n => n + 1)}>Thử lại</button></p>}
      <div className="home-radar-stack">
        <div className="home-radar-row">
          <article className={`home-radar-card${panel === 'open' ? ' on' : ''}`} aria-label="Đang mở">
            <button type="button" className="home-open-toggle" aria-expanded={panel === 'open'} onClick={() => togglePanel('open')}>
              <strong>{state.loading ? '…' : `${view.counts.open.toLocaleString('vi-VN')}${state.capped ? '+' : ''}`}</strong>
              <span>Đang mở <em className="home-match-note">{matchNote}</em></span>
              <span>Gói thầu đang mở</span>
            </button>
          </article>
          <article className={`home-radar-card${panel === 'week' ? ' on' : ''}`} aria-label="Mới tuần này và sắp đóng">
            <button type="button" className="home-open-toggle" aria-expanded={panel === 'week'} onClick={() => togglePanel('week')}>
              <strong className="home-week-line">{weekLine}</strong>
            </button>
          </article>
          <Watchlist
            key={userKeyPart(user)}
            user={user}
            rows={sample}
            capped={state.capped}
            expanded={panel === 'watch'}
            onToggle={() => togglePanel('watch')}
            onTopics={rememberTopics}
          />
        </div>
        <Sheet leftDesktop open={!!panel} title={panelLabel} onClose={() => setPanel(null)} bottom>
          <div className="home-radar-panel" aria-live="polite" aria-label={panelLabel}>
            {panel === 'open' && (
              <PackageList
                rows={view.list}
                loading={state.loading}
                emptyLabel="Không có gói đang mở trên trang đã tải."
                onPick={(row) => { setPanel(null); setPicked(row) }}
              />
            )}
            {panel === 'week' && (
              <>
                <section className="home-radar-group">
                  <h3>Mới tuần này</h3>
                  <PackageList
                    rows={view.fresh}
                    tone="fresh"
                    loading={state.loading}
                    emptyLabel={weekEmpty(view, 'fresh')}
                    onPick={(row) => { setPanel(null); setPicked(row) }}
                  />
                </section>
                <section className="home-radar-group">
                  <h3>Sắp đóng</h3>
                  <PackageList
                    rows={view.closing}
                    tone="closing"
                    loading={state.loading}
                    emptyLabel={weekEmpty(view, 'closing')}
                    onPick={(row) => { setPanel(null); setPicked(row) }}
                  />
                </section>
              </>
            )}
            {panel === 'watch' && (
              <WatchPackages topics={watchTopics} rows={sample} capped={state.capped} onPick={(row) => { setPanel(null); setPicked(row) }} />
            )}
          </div>
        </Sheet>
      </div>
      {localMode && !state.loading && matchCount === 0 && <p className="home-note">Chưa thấy gói khớp. Ở Dữ liệu, chạy «Quét hồ sơ gói đang mở» để đối chiếu danh mục Bảo An.</p>}
      <Sheet leftDesktop open={!!picked} title={picked?.tender_no || 'Chi tiết gói thầu'} onClose={() => setPicked(null)}>
        {picked && <TenderDetail row={picked} />}
      </Sheet>
    </section>
  )
}

function weekEmpty(view, kind) {
  if (!view.loaded) return 'Chưa có gói thầu trên trang đã tải.'
  if (kind === 'fresh') {
    return view.publishedKnown
      ? 'Không có gói đăng trong 7 ngày trên trang đã tải.'
      : 'Chưa có ngày đăng trên dữ liệu đã tải.'
  }
  return view.closeKnown
    ? 'Không có gói đang mở sắp đóng trong 7 ngày.'
    : 'Chưa có hạn đóng trên dữ liệu đã tải.'
}

function PackageList({ rows, tone = '', loading = false, emptyLabel, onPick, tagsFor }) {
  if (loading) return <p role="status">Đang lấy gói thầu…</p>
  if (!rows.length) return <p className="home-empty">{emptyLabel}</p>
  return rows.map(row => {
    const labels = typeof tagsFor === 'function' ? [...new Set(tagsFor(row).filter(Boolean))] : []
    return (
      <button
        type="button"
        className={`home-tender${tone ? ` ${tone}` : ''}${labels.length ? ' has-tag' : ''}`}
        key={row.tender_no || row.name}
        onClick={() => onPick(row)}
      >
        {!!labels.length && (
          <span className="home-topic-tags">
            {labels.map(label => <span key={label} className="home-topic-tag">{label}</span>)}
          </span>
        )}
        <TenderLines row={row} />
      </button>
    )
  })
}

function WatchPackages({ topics, rows, capped, onPick }) {
  if (!topics.length) return <p className="home-empty">Chưa có mục theo dõi.</p>
  const now = Date.now()
  const packed = topics.map((topic, index) => ({
    ...topic,
    name: String(topic.name || '').trim() || defaultTopicName(topic.criteria, index + 1),
    result: countTopic(topic.criteria, rows, now, { capped }),
  }))
  const namesFor = (row) => {
    const id = row?.tender_no || row?.name
    return packed
      .filter(topic => topic.result.kind === 'live' && topic.result.rows.some(item => (item.tender_no || item.name) === id))
      .map(topic => topic.name)
  }
  return packed.map(topic => {
    const title = topicSentence(topic.criteria)
    const listed = topic.result.kind === 'live' && topic.result.rows.length > 0
    return (
      <section key={topic.id} className="home-watch-group" aria-label={topic.name}>
        <div className="home-watch-group-bar">
          <h3>{title}</h3>
          {!listed && <span className="home-topic-tag">{topic.name}</span>}
        </div>
        {topic.result.kind === 'live' && topic.result.note && <p className="home-note">{topic.result.note}</p>}
        {topic.result.kind === 'live' && (
          <PackageList rows={topic.result.rows} tagsFor={namesFor} emptyLabel="Không có gói khớp trên trang đã tải." onPick={onPick} />
        )}
        {topic.result.kind !== 'live' && <p className="home-empty">{topic.result.note || 'Đã lưu tiêu chí.'}</p>}
      </section>
    )
  })
}

function TenderLines({ row }) {
  const flagged = row.baoan_match === 'exact' || row.baoan_match === 'near'
  const close = countdownLabel(parseDateMs(row.close_date))
  return (
    <>
      <div className="home-tender-line">
        <span className="home-code">{row.tender_no || 'Chưa có mã TBMT'}</span>
        <StatusBadge row={row} />
        <time>{close}</time>
      </div>
      <p>{row.buyer || 'Chưa rõ bên mời thầu'} · {row.province || 'Chưa rõ địa bàn'}</p>
      <p><strong>{row.name || 'Chưa có tên gói'}</strong> · {moneyLabel(row.bid_price)} · {techGroup(row)}</p>
      {flagged && <span className="home-match">Khớp SKU</span>}
    </>
  )
}

function TenderDetail({ row }) {
  const lines = Array.isArray(row.scope_lines) ? row.scope_lines : []
  const href = /^https:\/\/muasamcong\.mpi\.gov\.vn\//.test(row.source_url || '') ? row.source_url : ''
  return (
    <div className="home-detail">
      <TenderLines row={row} />
      <h3>Phần thầu trong hồ sơ</h3>
      {!lines.length && <p>Chưa có bảng phạm vi cung cấp. Quét hồ sơ gói đang mở ở Dữ liệu, hoặc mở E-HSMT gốc.</p>}
      {!!lines.length && (
        <div className="home-table-wrap">
          <table>
            <thead><tr><th>Hoạt chất</th><th>Hàm lượng / dạng</th><th>Nhóm</th><th>Giá kế hoạch</th><th>Khớp</th></tr></thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={`${line.code}-${index}`}>
                  <td>{line.name || '—'}</td>
                  <td>{[line.strength, line.form].filter(Boolean).join(' · ') || '—'}</td>
                  <td>{line.group || '—'}</td>
                  <td>{moneyLabel(line.price)}</td>
                  <td>{line.status === 'MATCH' || line.match === 'exact' ? 'Khớp hợp lệ' : line.status === 'POTENTIAL' || line.match === 'near' ? 'Cần rà soát' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="home-note">Giá vốn gia công không nằm trong hồ sơ MSC. Đối chiếu COGS tại Danh mục Bảo An trước khi chốt giá chào.</p>
      {href ? <a className="home-link" href={href} target="_blank" rel="noreferrer">Tải E-HSMT gốc</a> : <p>Chưa có link hồ sơ MSC cho gói này.</p>}
    </div>
  )
}

function NewsBlock({ onOpenAdmin }) {
  const [refresh, setRefresh] = useState(0)
  const [state, setState] = useState({ loading: true, items: [], sources: [], error: '' })
  const [openMore, setOpenMore] = useState(true)
  const [sheet, setSheet] = useState(null)
  const [ai, setAi] = useState({ loading: false, error: '', data: null })

  const aiSeq = useRef(0)
  useEffect(() => () => { aiSeq.current += 1 }, [])
  useEffect(() => {
    const controller = new AbortController()
    setState(s => ({ ...s, loading: true, error: '' }))
    regulatoryRequest({ view: 'brief' }, undefined, controller.signal)
      .then(data => { if (!controller.signal.aborted) setState({ loading: false, items: data.items || [], sources: data.sources || [], error: '' }) })
      .catch(error => { if (!controller.signal.aborted) setState({ loading: false, items: [], sources: [], error: error.message }) })
    return () => controller.abort()
  }, [refresh])

  const { critical, secondary } = useMemo(() => splitBrief(state.items), [state.items])
  const sourceErrors = state.sources.filter(source => source.enabled && source.last_error)
  const latestCheck = state.sources.map(source => Date.parse(source.last_success || '')).filter(Number.isFinite).sort((a,b) => b-a)[0]
  const sourceTime = value => new Date(value).toLocaleString('vi-VN',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit',year:'numeric'})

  const runAi = async (item, refresh = false) => {
    const seq = ++aiSeq.current
    setSheet({ kind: 'ai', item })
    setAi(previous => ({ loading: true, error: '', data: refresh ? previous.data : null }))
    try {
      const data = await analyzeNews({ id: item.id, refresh })
      if (seq === aiSeq.current) setAi({ loading: false, error: '', data })
    } catch (error) {
      if (seq === aiSeq.current) setAi(previous => ({ loading: false, error: error.message, data: previous.data }))
    }
  }

  return (
    <section className="home-block home-news" aria-label="Bảng tin tình báo">
      <header className="home-block-head">
        <h2>Bảng tin tình báo</h2>
        <button type="button" className="home-text" onClick={onOpenAdmin}>Crawl tin</button>
      </header>
      <p className="home-note">Dược · đấu thầu · chính sách · BHYT{latestCheck ? ` · Kiểm tra nguồn: ${sourceTime(latestCheck)}` : ''}</p>
      {sourceErrors.length > 0 && <details className="home-source-status"><summary>{sourceErrors.length} nguồn chưa cập nhật được · xem trạng thái</summary>{sourceErrors.map(source => <p key={source.id}><b>{source.name}</b>: {source.last_error}{source.last_success ? ` · Lần thành công: ${sourceTime(source.last_success)}` : ''}</p>)}</details>}
      {state.loading && <p role="status">Đang mở bản tin…</p>}
      {state.error && <p className="home-alert" role="alert">{state.error} <button type="button" onClick={() => setRefresh(n => n + 1)}>Thử lại</button></p>}
      {!state.loading && !state.error && !critical.length && <p className="home-empty">Chưa có tin cấp 1 trong 90 ngày. Xem tin phụ hoặc cào lại ở Dữ liệu.</p>}
      <div className="home-critical">
        {critical.map(item => {
          const nature = natureOf(item)
          return (
            <article key={item.id} className={`home-critical-card ${nature === 'RISK_TRAP' ? 'risk' : 'chance'}`}>
              <div className="home-tender-line">
                <span className="home-badge">{sourceBadge(item)}</span>
                <span>{nature === 'RISK_TRAP' ? 'Cảnh báo' : nature === 'OPPORTUNITY' ? 'Cơ hội thầu' : 'Theo dõi'}</span>
              </div>
              <h3>{editorialTitle(item)}</h3>
              {!!item.catalog_touch?.exact?.length && (
                <p className="home-match">Khớp danh mục: {item.catalog_touch.exact.map(row => row.brand || row.reg).filter(Boolean).slice(0, 3).join(', ')}</p>
              )}
              <div className="home-insight">
                <p><strong>Tác động thầu.</strong> {item.insight?.impact}</p>
                <p><strong>Lệnh điều hành.</strong> {item.insight?.action}</p>
              </div>
              <p className="home-note">{item.insight?.method === 'ai' ? 'AI gợi ý · cần đối chiếu văn bản gốc' : 'Sàng lọc theo quy tắc · bấm tia sáng để hỏi Gemini'}</p>
              <div className="home-actions">
                <button type="button" onClick={() => setSheet({ kind: 'doc', item })}>Xem văn bản & căn cứ</button>
                <button type="button" className="home-spark" aria-label="Phân tích Gemini" onClick={() => runAi(item)}>✦</button>
              </div>
            </article>
          )
        })}
      </div>
      {!!secondary.length && (
        <div className="home-more">
          <button type="button" aria-expanded={openMore} onClick={() => setOpenMore(v => !v)}>
            {openMore ? 'Thu gọn' : `Xem thêm ${secondary.length} tin thị trường khác`}
            <span aria-hidden="true">{openMore ? '⌃' : '⌄'}</span>
          </button>
          {openMore && (
            <div className="home-accordion">
              {secondary.map(item => (
                <div key={item.id} className="home-acc-row">
                  <span className="home-badge">{sourceBadge(item)}</span>
                  <button type="button" className="home-acc-title" onClick={() => setSheet({ kind: 'doc', item })}>{editorialTitle(item)}</button>
                  <button type="button" className="home-spark" aria-label={`Phân tích Gemini: ${editorialTitle(item)}`} onClick={() => runAi(item)}>✦</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <button type="button" className="home-text" onClick={() => document.getElementById('home-legal')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Kho tin & tra cứu luật</button>
      <Sheet
        open={!!sheet}
        title={sheet?.kind === 'ai' ? 'Phân tích Gemini' : 'Văn bản & căn cứ'}
        onClose={() => { aiSeq.current += 1; setSheet(null) }}
      >
        {sheet?.kind === 'doc' && <DocBody item={sheet.item} />}
        {sheet?.kind === 'ai' && <AiBody item={sheet.item} ai={ai} onRefresh={() => runAi(sheet.item, true)} />}
      </Sheet>
    </section>
  )
}

function DocBody({ item }) {
  return (
    <div className="home-detail">
      <p className="home-badge">{sourceBadge(item)}</p>
      <h3>{item.title}</h3>
      <p>{item.summary || 'Chưa có tóm tắt. Đọc bài gốc.'}</p>
      {item.insight?.evidence_quote && <blockquote>{item.insight.evidence_quote}</blockquote>}
      <p>{item.insight?.reason}</p>
      {item.source_url && <a className="home-link" href={item.source_url} target="_blank" rel="noreferrer">Mở bài gốc</a>}
    </div>
  )
}

function AiBody({ item, ai, onRefresh }) {
  if (ai.loading && !ai.data) return <p role="status">AI đang đọc bài gốc và đối chiếu nguồn ngoài…</p>
  if (ai.error && !ai.data) return <div className="home-alert" role="alert">{ai.error}<button onClick={onRefresh}>Thử lại</button></div>
  if (!ai.data) return null
  const data = ai.data
  return (
    <div className="home-detail">
      {ai.error && <p className="home-alert" role="alert">{ai.error} · Đang giữ bản phân tích thành công trước.</p>}
      <p className="home-note">{data.model ? `${data.model} · ` : ''}{data.analyzed_at ? `Phân tích ngày ${new Date(data.analyzed_at).toLocaleString('vi-VN')}` : ''}{data.cached ? ' · Đã lưu' : ''}</p>
      {data.verification_limit && <p className="home-note">{data.verification_limit}</p>}
      <button type="button" className="home-text" onClick={onRefresh} disabled={ai.loading}>{ai.loading ? 'Đang đối chiếu lại…' : 'Phân tích cập nhật'}</button>
      <p className="home-note">Gợi ý cho lãnh đạo · {item.code || sourceBadge(item)} · cần đối chiếu bản gốc</p>
      <h3>{data.headline_vietnamese}</h3>
      <p>{data.executive_summary}</p>
      <div className={`home-callout ${data.tender_impact.nature === 'RISK_TRAP' ? 'risk' : 'chance'}`}>
        <strong>{data.tender_impact.group_affected} · {data.priority}</strong>
        <p>{data.tender_impact.detail}</p>
      </div>
      <div className="home-callout action"><strong>Lệnh điều hành</strong><p>{data.action_order}</p></div>
      {Object.entries({ evidence: 'Sự kiện và căn cứ', catalog_impact: 'Tác động đến Bảo An', opportunities: 'Cơ hội', risks: 'Rủi ro', priority_actions: 'Việc cần làm', verification: 'Cần xác minh' }).map(([key, title]) => data[key]?.length ? <section key={key}><strong>{title}</strong><ul>{data[key].map((entry, index) => <li key={index}>{entry.detail}{entry.source_urls?.map(url => <a key={url} href={url} target="_blank" rel="noreferrer"> [Nguồn]</a>)}</li>)}</ul></section> : null)}
      {data.sources?.length > 0 && <section><strong>Nguồn đối chiếu</strong><ol>{data.sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title || source.url}</a></li>)}</ol></section>}

    </div>
  )
}

function LegalBlock() {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [sheet, setSheet] = useState(null)
  const [ai, setAi] = useState({ loading: false, error: '', data: null })
  const rows = useMemo(() => filterLegal(LEGAL_CORE, { query, status }), [query, status])

  const run = async (doc) => {
    setSheet(doc)
    setAi({ loading: true, error: '', data: null })
    try {
      const data = await analyzeLegal({
        doc_number: doc.number,
        title: doc.title,
        excerpt: doc.excerpt,
        status: doc.status,
      })
      setAi({ loading: false, error: '', data })
    } catch (error) {
      setAi({ loading: false, error: error.message, data: null })
    }
  }

  return (
    <section id="home-legal" className="home-block" aria-label="Tra cứu luật">
      <header className="home-block-head">
        <h2>Tra cứu luật</h2>
      </header>
      <label className="home-search">
        <span className="home-sr">Tìm số hiệu hoặc từ khóa</span>
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="40/2025, BHYT, EU-GMP…" />
      </label>
      <div className="home-chips" role="tablist">
        {LEGAL_FILTERS.map(([id, label]) => (
          <button key={id} type="button" className={status === id ? 'on' : ''} aria-pressed={status === id} onClick={() => setStatus(id)}>{label}</button>
        ))}
      </div>
      <div className="home-scroll home-legal-scroll">
        {rows.map(doc => (
          <article key={doc.id} className="home-legal-card">
            <div className="home-tender-line">
              <span className="home-code">{doc.number}</span>
              <span className={`home-badge status-${doc.status}`}>{LEGAL_STATUS[doc.status]}</span>
            </div>
            <h3>{doc.title}</h3>
            <p>{doc.excerpt}</p>
            {doc.issued && <time>Ban hành {new Date(`${doc.issued}T00:00:00+07:00`).toLocaleDateString('vi-VN')}</time>}
            <button type="button" onClick={() => run(doc)}>Phân tích tác động</button>
          </article>
        ))}
        {!rows.length && <p className="home-empty">Không có văn bản khớp. Thử số hiệu không dấu, ví dụ 40/2025.</p>}
      </div>
      <Sheet open={!!sheet} title={sheet?.number || 'Phân tích pháp chế'} onClose={() => setSheet(null)}>
        {ai.loading && <p role="status">Gemini đang đọc văn bản…</p>}
        {ai.error && <p className="home-alert" role="alert">{ai.error}</p>}
        {ai.data && <LegalAi data={ai.data} />}
      </Sheet>
    </section>
  )
}

function LegalAi({ data }) {
  const matrix = data.impact_matrix
  const risk = /rui ro|cam |khong duoc|xuat toan|het hieu luc|bay/
  const tone = (text) => (risk.test(text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')) ? 'risk' : 'chance')
  return (
    <div className="home-detail">
      <p>{data.doc_summary}</p>
      <p className="home-note">{data.transition_warning}</p>
      <div className={`home-callout ${tone(matrix.group_2_import)}`}><strong>Nhóm 2 · nhập khẩu / CMO</strong><p>{matrix.group_2_import}</p></div>
      <div className={`home-callout ${tone(matrix.group_4_domestic)}`}><strong>Nhóm 4 · gia công nội</strong><p>{matrix.group_4_domestic}</p></div>
      <div className={`home-callout ${tone(matrix.bhyt_reimbursement)}`}><strong>Thanh toán BHYT</strong><p>{matrix.bhyt_reimbursement}</p></div>
      <div className="home-callout action">
        <strong>Chỉ đạo hành động</strong>
        <ul>{data.executive_recommendations.map(item => <li key={item}>{item}</li>)}</ul>
      </div>
    </div>
  )
}

export default function HomeDashboard({ localMode, user, onOpenMsc, onOpenAdmin }) {
  return (
    <div className="home-dash">
      <header className="home-hero">
        <div>
          <span className="home-kicker">Bảo An Pharma</span>
          <h1>Bàn điều hành thầu</h1>
        </div>
        <p>Một hàng ba thẻ tóm tắt. Bấm một thẻ để mở danh sách và thao tác ngay trong cửa sổ trượt lên.</p>
      </header>
      <TenderRadar localMode={localMode} user={user} onOpenMsc={onOpenMsc} />
      <div className="home-lower">
        <NewsBlock onOpenAdmin={onOpenAdmin} />
        <LegalBlock />
      </div>
    </div>
  )
}
