import { useEffect, useState } from 'react'
import { api } from './api'
import DavSection from './DavSection'
import MscSection from './MscSection'
import VssSection from './VssSection'
import AdminSection from './AdminSection'

const TABS = [
  { id: 'dav', label: 'Thuốc DAV' },
  { id: 'msc', label: 'Thầu MSC' },
  { id: 'vss', label: 'BHYT VSS' },
  { id: 'admin', label: 'Quản trị' },
]

export default function App() {
  const [tab, setTab] = useState('dav')
  const [localMode, setLocalMode] = useState(false)

  useEffect(() => {
    api.health().then((h) => setLocalMode(!!h?.ok)).catch(() => setLocalMode(false))
  }, [])

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">BaoAn Searcher</div>
        <nav className="nav">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={tab === t.id ? 'active' : ''}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="mode-pill">{localMode ? 'Local API' : 'GitHub Pages'}</div>
      </header>
      <main className="page">
        {tab === 'dav' && <DavSection localMode={localMode} />}
        {tab === 'msc' && <MscSection localMode={localMode} />}
        {tab === 'vss' && <VssSection localMode={localMode} />}
        {tab === 'admin' && <AdminSection localMode={localMode} />}
      </main>
    </div>
  )
}
