import { lazy, Suspense, useEffect, useState } from 'react'
import { api } from './api'
import { useAuth } from './auth'
import { PaneOverlayContext } from './components'
import { supabaseConfigured } from './supabaseCloud'

const DavSection = lazy(() => import('./DavSection'))
const MscSection = lazy(() => import('./MscSection'))
const VssSection = lazy(() => import('./VssSection'))
const AdminSection = lazy(() => import('./AdminSection'))
const HomeDashboard = lazy(() => import('./home/HomeDashboard'))
const PortfolioCockpit = lazy(() => import('./PortfolioCockpit'))
const BaoAnCatalog = lazy(() => import('./BaoAnCatalog'))
const MapSection = lazy(() => import('./MapSection'))

function PaneFallback() {
  return <p className="info-note" role="status">Đang mở mục…</p>
}

const TABS = [
  { id: 'home', label: 'Trang chủ', sub: 'Nhịp thầu · bảng tin' },
  { id: 'dav', label: 'Thuốc DAV', sub: 'Số đăng ký' },
  { id: 'msc', label: 'Thầu MSC', sub: 'Đơn giá · gói thầu' },
  { id: 'vss', label: 'BHYT VSS', sub: 'Trúng thầu' },
  { id: 'map', label: 'Bản đồ', sub: 'Nhiệt tỉnh · chủ đầu tư' },
  { id: 'portfolio', label: 'Danh mục Bảo An', sub: 'Portfolio Cockpit' },
  { id: 'admin', label: 'Quản trị', sub: 'Crawl · tài khoản' },
]

const SPLIT_APPS = [
  { id: 'baoan', label: 'Danh mục Bảo An', desc: 'Tên thuốc · hoạt chất · SĐK' },
  { id: 'dav', label: 'Thuốc DAV', desc: 'Số đăng ký · tag SĐK' },
  { id: 'msc', label: 'Thầu MSC', desc: 'Đơn giá · gói thầu quốc gia' },
  { id: 'vss', label: 'BHYT VSS', desc: 'Kết quả trúng thầu Tân dược' },
  { id: 'map', label: 'Bản đồ', desc: 'Nhiệt tỉnh · chủ đầu tư' },
  { id: 'portfolio', label: 'Portfolio Cockpit', desc: 'Cockpit danh mục Bảo An' },
]

function SectionById({ id, localMode, embedded, filtersInModal }) {
  let section = null
  if (id === 'dav') section = <DavSection localMode={localMode} embedded={embedded} filtersInModal={filtersInModal} />
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
          <SectionById key={appId} id={appId} localMode={localMode} embedded filtersInModal />
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
  const [localMode, setLocalMode] = useState(false)
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
      else if (code === 'MSC_BID') { setMscKind('tenders'); setTab('msc') }
    }
    window.addEventListener('baoan-open-dataset', onOpenDataset)
    return () => window.removeEventListener('baoan-open-dataset', onOpenDataset)
  }, [])

  useEffect(() => {
    api.health()
      .then((h) => setLocalMode(!!h?.ok))
      .catch(() => setLocalMode(false))
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
            {TABS.map((t) => t.id === 'msc' ? (
              <details className={`msc-nav-menu${tab === 'msc' ? ' active' : ''}`} key={t.id} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.open = false }} onKeyDown={(e) => { if (e.key === 'Escape') e.currentTarget.open = false }}>
                <summary>Thầu MSC <span aria-hidden="true">⌄</span></summary>
                <div className="msc-nav-options">
                  {[['tenders', 'Gói thầu'], ['prices', 'Đơn giá']].map(([value, label]) => <button type="button" key={value} aria-pressed={tab === 'msc' && mscKind === value} onClick={(e) => { setMscKind(value); setTab('msc'); e.currentTarget.closest('details').open = false }}>{label}</button>)}
                </div>
              </details>
            ) : (
              <button
                key={t.id}
                type="button"
                className={!multi && tab === t.id ? 'active' : ''}
                onClick={() => setTab(t.id)}
                aria-current={!multi && tab === t.id ? 'page' : undefined}
              >
                {t.label}
              </button>
            ))}
            {!phone && (
              <button
                type="button"
                className={multi ? 'active' : ''}
                onClick={() => setTab('multi')}
                aria-current={multi ? 'page' : undefined}
                title="Chia 2 khung song song"
              >
                Đa khung
              </button>
            )}
          </nav>
          <div className="topbar-end">
            <div
              className={`mode-pill ${localMode ? 'local' : supabaseConfigured ? 'cloud' : 'static'}`}
              title={
                localMode
                  ? 'Kết nối API local 127.0.0.1:8787'
                  : supabaseConfigured
                    ? 'Supabase Auth + kho Supabase (SEARCH_BACKEND). Turso chỉ khi bật rollback.'
                    : 'Thiếu VITE_SUPABASE_* — cấu hình rồi build lại'
              }
            >
              <span className="dot" />
              {!checked
                ? 'Đang kiểm tra…'
                : localMode
                  ? 'Local API'
                  : supabaseConfigured
                    ? 'Cloud · Supabase'
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
          {checked && !multi && tab === 'dav' && (
            <div className="tab-pane">
              <Suspense fallback={<PaneFallback />}>
              <DavSection localMode={localMode} />
              </Suspense>
            </div>
          )}
          {checked && !multi && tab === 'msc' && (
            <div className="tab-pane">
              {phone && (
                <div className="mobile-msc-switch" role="tablist" aria-label="Dữ liệu MSC">
                  <button type="button" className={mscKind === 'tenders' ? 'on' : ''} aria-pressed={mscKind === 'tenders'} onClick={() => setMscKind('tenders')}>Gói thầu</button>
                  <button type="button" className={mscKind === 'prices' ? 'on' : ''} aria-pressed={mscKind === 'prices'} onClick={() => setMscKind('prices')}>Đơn giá</button>
                </div>
              )}
              <Suspense fallback={<PaneFallback />}>
              <MscSection key={mscKind} localMode={localMode} selectedKind={mscKind} />
              </Suspense>
            </div>
          )}
          {checked && !multi && tab === 'vss' && (
            <div className="tab-pane">
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
