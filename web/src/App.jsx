import { useEffect, useState } from 'react'
import { api } from './api'
import { useAuth } from './auth'
import { Tt20Provider } from './components'
import { supabaseConfigured } from './supabaseCloud'
import DavSection from './DavSection'
import MscSection from './MscSection'
import VssSection from './VssSection'
import AdminSection from './AdminSection'

const TABS = [
  { id: 'dav', label: 'Thuốc DAV', sub: 'Số đăng ký' },
  { id: 'msc', label: 'Thầu MSC', sub: 'Đơn giá · gói thầu' },
  { id: 'vss', label: 'BHYT VSS', sub: 'Trúng thầu' },
  { id: 'admin', label: 'Quản trị', sub: 'Crawl · tài khoản' },
]

const SPLIT_APPS = [
  { id: 'dav', label: 'Thuốc DAV', desc: 'Số đăng ký · tag SĐK · TT20' },
  { id: 'msc', label: 'Thầu MSC', desc: 'Đơn giá · gói thầu quốc gia' },
  { id: 'vss', label: 'BHYT VSS', desc: 'Kết quả trúng thầu Tân dược' },
]

function SectionById({ id, localMode, embedded, filtersInModal }) {
  if (id === 'dav') return <DavSection localMode={localMode} embedded={embedded} filtersInModal={filtersInModal} />
  if (id === 'msc') return <MscSection localMode={localMode} embedded={embedded} filtersInModal={filtersInModal} />
  if (id === 'vss') return <VssSection localMode={localMode} embedded={embedded} filtersInModal={filtersInModal} />
  return null
}

function SplitPane({ side, appId, onSelect, onClear, localMode }) {
  const [picking, setPicking] = useState(!appId)
  const label = SPLIT_APPS.find((a) => a.id === appId)?.label || 'Chọn ứng dụng'

  useEffect(() => {
    if (!appId) setPicking(true)
  }, [appId])

  return (
    <div className={`split-pane${picking || !appId ? ' empty' : ''}`}>
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
          <SectionById id={appId} localMode={localMode} embedded filtersInModal />
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
    </div>
  )
}

export default function App() {
  const { user, signOut } = useAuth()
  const [tab, setTab] = useState(() => {
    const h = window.location.hash.replace('#', '')
    if (h === 'multi') return 'multi'
    return TABS.some((t) => t.id === h) ? h : 'dav'
  })
  const [localMode, setLocalMode] = useState(false)
  const [checked, setChecked] = useState(false)
  const [leftApp, setLeftApp] = useState('dav')
  const [rightApp, setRightApp] = useState('vss')

  const multi = tab === 'multi'

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
      if (h === 'multi' || TABS.some((t) => t.id === h)) setTab(h)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const onSignOut = async () => {
    await signOut()
    const base = import.meta.env.BASE_URL || '/'
    const login = `${base.endsWith('/') ? base : `${base}/`}login`
    window.history.replaceState(null, '', login)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  return (
    <Tt20Provider>
      <div className={`app-shell${multi ? ' multi' : ''}`}>
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">B</span>
            <span className="brand-text">BaoAn <span>Searcher</span></span>
          </div>
          <nav className="nav" aria-label="Chuyên mục">
            {TABS.map((t) => (
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
            <button
              type="button"
              className={multi ? 'active' : ''}
              onClick={() => setTab('multi')}
              aria-current={multi ? 'page' : undefined}
              title="Chia 2 khung song song"
            >
              Đa khung
            </button>
          </nav>
          <div className="topbar-end">
            <div
              className={`mode-pill ${localMode ? 'local' : supabaseConfigured ? 'cloud' : 'static'}`}
              title={
                localMode
                  ? 'Kết nối API local 127.0.0.1:8787'
                  : supabaseConfigured
                    ? 'Hybrid: Supabase Auth + Turso data (fallback Supabase RPC)'
                    : 'Thiếu VITE_SUPABASE_* — cấu hình rồi build lại'
              }
            >
              <span className="dot" />
              {!checked
                ? 'Đang kiểm tra…'
                : localMode
                  ? 'Local API'
                  : supabaseConfigured
                    ? 'Cloud · Auth+Turso'
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
          {checked && !multi && tab === 'dav' && <DavSection localMode={localMode} />}
          {checked && !multi && tab === 'msc' && <MscSection localMode={localMode} />}
          {checked && !multi && tab === 'vss' && <VssSection localMode={localMode} />}
          {checked && !multi && tab === 'admin' && <AdminSection localMode={localMode} />}
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
    </Tt20Provider>
  )
}
