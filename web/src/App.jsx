import { useEffect, useState } from 'react'
import { api } from './api'
import { Tt20Provider } from './components'
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

export default function App() {
  const [tab, setTab] = useState(() => {
    const h = window.location.hash.replace('#', '')
    return TABS.some((t) => t.id === h) ? h : 'dav'
  })
  const [localMode, setLocalMode] = useState(false)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    api.health()
      .then((h) => setLocalMode(!!h?.ok))
      .catch(() => setLocalMode(false))
      .finally(() => setChecked(true))
  }, [])

  useEffect(() => {
    if (window.location.hash !== `#${tab}`) window.history.replaceState(null, '', `#${tab}`)
  }, [tab])

  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash.replace('#', '')
      if (TABS.some((t) => t.id === h)) setTab(h)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  return (
    <Tt20Provider>
      <div className="app-shell">
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
                className={tab === t.id ? 'active' : ''}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? 'page' : undefined}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className={`mode-pill ${localMode ? 'local' : 'static'}`} title={localMode ? 'Kết nối API local 127.0.0.1:8787' : 'Đọc dữ liệu export tĩnh'}>
            <span className="dot" />
            {!checked ? 'Đang kiểm tra…' : localMode ? 'Local API' : 'GitHub Pages'}
          </div>
        </header>
        <main className="page">
          {checked && tab === 'dav' && <DavSection localMode={localMode} />}
          {checked && tab === 'msc' && <MscSection localMode={localMode} />}
          {checked && tab === 'vss' && <VssSection localMode={localMode} />}
          {checked && tab === 'admin' && <AdminSection localMode={localMode} />}
        </main>
      </div>
    </Tt20Provider>
  )
}
