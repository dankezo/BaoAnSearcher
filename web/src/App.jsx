import { lazy, Suspense, useEffect, useState } from 'react'
import { api } from './api'
import { useAuth } from './auth'
import { PaneOverlayContext } from './components'
import { supabaseConfigured } from './supabaseCloud'

const DavSection = lazy(() => import('./DavSection'))
const MscSection = lazy(() => import('./MscSection'))
const YcbgSection = lazy(() => import('./YcbgSection'))
const VssSection = lazy(() => import('./VssSection'))
const AdminSection = lazy(() => import('./AdminSection'))
const HomeDashboard = lazy(() => import('./home/HomeDashboard'))
const PortfolioCockpit = lazy(() => import('./PortfolioCockpit'))
const BaoAnCatalog = lazy(() => import('./BaoAnCatalog'))
const MapSection = lazy(() => import('./MapSection'))
const AnalyticsApp = lazy(() => import('./analytics/AnalyticsApp'))
const TenderMarketReport = lazy(() => import('./TenderMarketReport'))

function PaneFallback() {
  return <p className="info-note" role="status">Đang mở mục…</p>
}

const TABS = [
  { id: 'tender-report', label: 'Thống kê thầu BHYT' },
  { id: 'msc-report', label: 'Thống kê thầu MSC' },
  { id: 'analytics-overview', label: 'Phân tích tổng hợp' },

  { id: 'home', label: 'Bảng tin', sub: 'Nhịp thầu · bảng tin' },
  { id: 'dav', label: 'Thuốc DAV', sub: 'Số đăng ký' },
  { id: 'msc', label: 'Thầu MSC', sub: 'Đơn giá · gói thầu' },
  { id: 'vss', label: 'BHYT VSS', sub: 'Trúng thầu' },
  { id: 'map', label: 'Bản đồ', sub: 'Nhiệt tỉnh · chủ đầu tư' },
  { id: 'portfolio', label: 'Quản lý danh mục', sub: 'Portfolio Cockpit' },
  { id: 'admin', label: 'Dữ liệu', sub: 'Crawl · tài khoản' },
]

const SPLIT_APPS = [
  { id: 'analytics-overview', label: 'Phân tích tổng hợp', desc: 'MSC · VSS · DAV' },

  { id: 'baoan', label: 'Danh mục Bảo An', desc: 'Tên thuốc · hoạt chất · SĐK' },
  { id: 'dav', label: 'Thuốc DAV', desc: 'Số đăng ký · tag SĐK' },
  { id: 'msc', label: 'Thầu MSC', desc: 'Đơn giá · gói thầu quốc gia' },
  { id: 'vss', label: 'BHYT VSS', desc: 'Kết quả trúng thầu Tân dược' },
  { id: 'map', label: 'Bản đồ', desc: 'Nhiệt tỉnh · chủ đầu tư' },
  { id: 'portfolio', label: 'Portfolio Cockpit', desc: 'Cockpit danh mục Bảo An' },
]

function SectionById({ id, localMode, embedded, filtersInModal, onOpenDeep }) {
  let section = null
  if (id === 'dav') section = <DavSection localMode={localMode} embedded={embedded} filtersInModal={filtersInModal} />
  else if (id === 'analytics-overview' || id === 'analytics-deep') section = <AnalyticsApp localMode={localMode} deep={true} onOpenDeep={onOpenDeep} />
  else if (id === 'msc') section = <MscSection localMode={localMode} embedded={embedded} filtersInModal={filtersInModal} />
  else if (id === 'vss') section = <VssSection localMode={localMode} embedded={embedded} filtersInModal={filtersInModal} />
  else if (id === 'map') section = <MapSection localMode={localMode} />
  else if (id === 'portfolio') section = <PortfolioCockpit localMode={localMode} />
  else if (id === 'baoan') section = <BaoAnCatalog localMode={localMode} />
  if (!section) return null
  return <Suspense fallback={<PaneFallback />}>{section}</Suspense>
}

function SplitPane({ side, appId, onSelect, onClear, localMode }) {
  const [overlayHost, setOverlayHost] = useState(null)
  const [picking, setPicking] = useState(!appId)
  const label = SPLIT_APPS.find((a) => a.id === appId)?.label || 'Chọn ứng dụng'

  useEffect(() => {
    if (!appId) setPicking(true)
  }, [appId])

  return (
    <div ref={setOverlayHost} className={`split-pane${picking || !appId ? ' empty' : ''}`}>
      <PaneOverlayContext.Provider value={overlayHost}>
      <div className="split-pane-bar">
        <span className="split-pane-side">{side === 'left' ? 'Trái' : 'Phải'}</span>
        <strong className="split-pane-title">{appId ? label : 'Chưa chọn'}</strong>
        <div className="spacer" />
        {appId && (
          <button type="button" className="btn ghost sm" onClick={() => setPicking(true)}>Đổi app</button>
        )}
        {appId && (
          <button type="button" className="btn ghost sm" onClick={() => { onClear(); setPicking(true) }}>Gỡ</button>
        )}
      </div>

      {appId && !picking && (
        <div className="split-pane-body">
          <SectionById key={appId} id={appId} localMode={localMode} embedded filtersInModal onOpenDeep={()=>onSelect('analytics-overview')} />
        </div>
      )}

      {(picking || !appId) && (
        <div className="split-picker">
          <div className="split-picker-card">
            <div className="split-picker-kicker">Chọn ứng dụng cho khung {side === 'left' ? 'trái' : 'phải'}</div>
            <div className="split-picker-grid">
              {SPLIT_APPS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`split-picker-item${appId === a.id ? ' on' : ''}`}
                  onClick={() => { onSelect(a.id); setPicking(false) }}
                >
                  <span className="split-picker-label">{a.label}</span>
                  <span className="split-picker-desc">{a.desc}</span>
                </button>
              ))}
            </div>
            {appId && (
              <button type="button" className="btn secondary sm" onClick={() => setPicking(false)}>Hủy</button>
            )}
          </div>
        </div>
      )}
      </PaneOverlayContext.Provider>
    </div>
  )
}

export default function App() {
  const { user, signOut } = useAuth()
  const [tab, setTab] = useState(() => {
    const h = window.location.hash.replace('#', '')
    if (h === 'multi') return 'multi'
    return TABS.some((t) => t.id === h) ? h : 'home'
  })
  const [mscKind, setMscKind] = useState('tenders')
  const [visitedMsc,setVisitedMsc] = useState({})
  useEffect(()=>{if(tab==='msc')setVisitedMsc(previous=>previous[mscKind]?previous:{...previous,[mscKind]:true})},[tab,mscKind])
  const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
  const [localMode, setLocalMode] = useState(localHost)
  const [checked, setChecked] = useState(false)
  const [leftApp, setLeftApp] = useState('dav')
  const [rightApp, setRightApp] = useState('vss')
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 640px)').matches)
  const [visited, setVisited] = useState(() => {
    const h = window.location.hash.replace('#', '')
    const id = TABS.some((t) => t.id === h) ? h : 'home'
    return { [id]: true }
  })

  const multi = tab === 'multi' && !phone

  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 640px)')
    if (!media) return undefined
    const apply = () => setPhone(media.matches)
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [])

  useEffect(() => {
    if (phone && tab === 'multi') setTab('msc')
  }, [phone, tab])

  useEffect(() => {
    if (tab && tab !== 'multi') {
      setVisited((v) => (v[tab] ? v : { ...v, [tab]: true }))
    }
  }, [tab])

  useEffect(() => {
    const onCompare = () => {
      setLeftApp('baoan')
      setRightApp('msc')
      setMscKind('tenders')
      setTab(phone ? 'msc' : 'multi')
    }
    window.addEventListener('baoan-compare', onCompare)
    return () => window.removeEventListener('baoan-compare', onCompare)
  }, [phone])

  useEffect(() => {
    const onOpenDataset = (event) => {
      const code = String(event.detail || '').toUpperCase()
      if (code === 'DAV') setTab('dav')
      else if (code === 'VSS') setTab('vss')
      else if (code === 'MSC_PRICE') { setMscKind('prices'); setTab('msc') }
      else if (code === 'MSC_YCBG') { setMscKind('ycbg'); setTab('msc') }
      else if (code === 'MSC_BID') { setMscKind('tenders'); setTab('msc') }
    }
    window.addEventListener('baoan-open-dataset', onOpenDataset)
    return () => window.removeEventListener('baoan-open-dataset', onOpenDataset)
  }, [])

  useEffect(()=>{
    const open=()=>setTab('analytics-overview')
    const data=()=>setTab('admin')
    window.addEventListener('baoan-analytics-open',open)
    window.addEventListener('baoan-open-data',data)
    return()=>{window.removeEventListener('baoan-analytics-open',open);window.removeEventListener('baoan-open-data',data)}
  },[])

  useEffect(() => {
    api.health()
      .then((h) => setLocalMode(localHost || !!h?.ok))
      .catch(() => setLocalMode(localHost))
      .finally(() => setChecked(true))
  }, [])

  useEffect(() => {
    const want = `#${tab}`
    if (window.location.hash !== want) window.history.replaceState(null, '', want)
  }, [tab])

  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash.replace('#', '')
      if (h === 'regulatory') {
        setTab('home')
        if (window.location.hash !== '#home') window.history.replaceState(null, '', '#home')
        return
      }
      if (h === 'multi') setTab(phone ? 'msc' : 'multi')
      else if (TABS.some((t) => t.id === h)) setTab(h)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [phone])

  const onSignOut = async () => {
    await signOut()
    const base = import.meta.env.BASE_URL || '/'
    const login = `${base.endsWith('/') ? base : `${base}/`}login`
    window.history.replaceState(null, '', login)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  return (
    <div className={`app-shell${multi ? ' multi' : ''}`}>
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">B</span>
            <span className="brand-text">BaoAn <span>Searcher</span></span>
          </div>
          <nav className="nav" aria-label="Chuyên mục">
            <button type="button" className={tab === 'home' ? 'active' : ''} aria-current={tab === 'home' ? 'page' : undefined} onClick={() => setTab('home')}>Bảng tin</button>
            <details className={`msc-nav-menu${['dav', 'msc', 'vss'].includes(tab) ? ' active' : ''}`} onBlur={(e) => { if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) e.currentTarget.open = false }} onKeyDown={(e) => { if (e.key === 'Escape') { e.currentTarget.open = false; e.currentTarget.querySelector('summary').focus() } }}>
              <summary>Tra cứu <span aria-hidden="true">⌄</span></summary>
              <div className="msc-nav-options">
                {[['dav', 'Thuốc DAV'], ['prices', 'MSC - Đơn giá'], ['tenders', 'MSC - Gói thầu'], ['ycbg', 'MSC - YCBG'], ['vss', 'BHYT VSS']].map(([value, label]) => <button type="button" key={value} aria-pressed={value === 'prices' || value === 'tenders' || value === 'ycbg' ? tab === 'msc' && mscKind === value : tab === value} onClick={(e) => { if (value === 'prices' || value === 'tenders' || value === 'ycbg') { setMscKind(value); setTab('msc') } else setTab(value); e.currentTarget.closest('details').open = false }}>{label}</button>)}
              </div>
            </details>
            <details className={`msc-nav-menu${tab === 'map' || tab === 'tender-report' || tab === 'msc-report' || tab.startsWith('analytics-') || multi ? ' active' : ''}`} onBlur={(e) => { if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) e.currentTarget.open = false }} onKeyDown={(e) => { if (e.key === 'Escape') { e.currentTarget.open = false; e.currentTarget.querySelector('summary').focus() } }}>
              <summary>Nâng cao <span aria-hidden="true">⌄</span></summary>
              <div className="msc-nav-options">
                <button type="button" aria-pressed={tab === 'tender-report'} onClick={(e)=>{setTab('tender-report');e.currentTarget.closest('details').open=false}}>Thống kê thầu BHYT</button>
                <button type="button" aria-pressed={tab === 'msc-report'} onClick={(e)=>{setTab('msc-report');e.currentTarget.closest('details').open=false}}>Thống kê thầu MSC</button>
                {[['analytics-overview', 'Phân tích tổng hợp']].map(([id,label]) => <button key={id} type="button" aria-pressed={tab === id} onClick={(e)=>{setTab(id);e.currentTarget.closest('details').open=false}}>{label}</button>)}
                <button type="button" aria-pressed={tab === 'map'} onClick={(e) => { setTab('map'); e.currentTarget.closest('details').open = false }}>Bản đồ</button>
                {!phone && <button type="button" aria-pressed={multi} onClick={(e) => { setTab('multi'); e.currentTarget.closest('details').open = false }}>Đa khung</button>}
              </div>
            </details>
            {TABS.filter((t) => ['portfolio', 'admin'].includes(t.id)).map((t) => <button key={t.id} type="button" className={tab === t.id ? 'active' : ''} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>{t.label}</button>)}
          </nav>
          <div className="topbar-end">
            <div
              className={`mode-pill ${localMode ? 'local' : supabaseConfigured ? 'cloud' : 'static'}`}
              title={
                localMode
                  ? 'Kết nối API local'
                  : supabaseConfigured
                    ? 'Đăng nhập Supabase · API cloud. Xem nguồn và lần cập nhật trong mục Dữ liệu.'
                    : 'Thiếu VITE_SUPABASE_* — cấu hình rồi build lại'
              }
            >
              <span className="dot" />
              {!checked
                ? 'Đang kiểm tra…'
                : localMode
                  ? 'Local API'
                  : supabaseConfigured
                    ? 'Cloud'
                    : 'Chưa cấu hình Cloud'}
            </div>
            {user?.email && (
              <div className="user-chip" title={user.email}>
                <span className="user-chip-mail">{user.email}</span>
                <button type="button" className="btn ghost sm" onClick={onSignOut}>
                  Đăng xuất
                </button>
              </div>
            )}
          </div>
        </header>
        <main className={`page${multi ? ' page-split' : ''}`}>
          {checked && visited['tender-report'] && <div className="tab-pane" hidden={tab !== 'tender-report'} aria-hidden={tab !== 'tender-report'}><Suspense fallback={<PaneFallback />}><TenderMarketReport localMode={localMode}/></Suspense></div>}
          {checked && visited['msc-report'] && <div className="tab-pane" hidden={tab !== 'msc-report'} aria-hidden={tab !== 'msc-report'}><Suspense fallback={<PaneFallback />}><TenderMarketReport localMode={localMode} source="msc"/></Suspense></div>}
          {checked && !multi && tab.startsWith('analytics-') && <Suspense fallback={<PaneFallback />}><AnalyticsApp key={tab} localMode={localMode} deep={true} /></Suspense>}
          {checked && !multi && visited.home && (
            <div className="tab-pane" hidden={tab !== 'home'} aria-hidden={tab !== 'home'}>
              <Suspense fallback={<PaneFallback />}>
              <HomeDashboard
                localMode={localMode}
                user={user}
                onOpenMsc={() => { setMscKind('tenders'); setTab('msc') }}
                onOpenAdmin={() => setTab('admin')}
              />
              </Suspense>
            </div>
          )}
          {checked && visited.dav && (
            <div className="tab-pane" hidden={tab !== 'dav'} aria-hidden={tab !== 'dav'}>
              <Suspense fallback={<PaneFallback />}>
              <DavSection localMode={localMode} />
              </Suspense>
            </div>
          )}
          {checked && visited.msc && (
            <div className="tab-pane" hidden={tab !== 'msc'} aria-hidden={tab !== 'msc'}>
              <Suspense fallback={<PaneFallback />}>
              {['tenders','prices','ycbg'].filter(kind=>visitedMsc[kind]).map(kind=><div key={kind} hidden={kind!==mscKind}>{kind === 'ycbg' ? <YcbgSection localMode={localMode} /> : <MscSection localMode={localMode} selectedKind={kind} />}</div>)}
              </Suspense>
            </div>
          )}
          {checked && visited.vss && (
            <div className="tab-pane" hidden={tab !== 'vss'} aria-hidden={tab !== 'vss'}>
              <Suspense fallback={<PaneFallback />}>
              <VssSection localMode={localMode} />
              </Suspense>
            </div>
          )}
          {checked && !multi && tab === 'map' && (
            <div className="tab-pane">
              <Suspense fallback={<PaneFallback />}>
              <MapSection localMode={localMode} />
              </Suspense>
            </div>
          )}
          {checked && !multi && visited.portfolio && (
            <div className="tab-pane" hidden={tab !== 'portfolio'} aria-hidden={tab !== 'portfolio'}>
              <Suspense fallback={<PaneFallback />}>
              <PortfolioCockpit localMode={localMode} />
              </Suspense>
            </div>
          )}
          {checked && !multi && visited.admin && (
            <div className="tab-pane" hidden={tab !== 'admin'} aria-hidden={tab !== 'admin'}>
              <Suspense fallback={<PaneFallback />}>
              <AdminSection localMode={localMode} />
              </Suspense>
            </div>
          )}
          {checked && multi && (
            <div className="split-view">
              <SplitPane
                side="left"
                appId={leftApp}
                onSelect={setLeftApp}
                onClear={() => setLeftApp(null)}
                localMode={localMode}
              />
              <SplitPane
                side="right"
                appId={rightApp}
                onSelect={setRightApp}
                onClear={() => setRightApp(null)}
                localMode={localMode}
              />
            </div>
          )}
        </main>
      </div>
  )
}
