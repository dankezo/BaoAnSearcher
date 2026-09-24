import { useEffect, useState } from 'react'
import { api } from './api'
import { LoadingOverlay } from './components'

function Card({ title, status, children }) {
  const pct = status?.progress || 0
  const running = status?.state === 'running'
  return (
    <div className="admin-card">
      <h3>{title}</h3>
      <div className="meta">
        Trạng thái: <strong>{status?.state || 'idle'}</strong>
        {status?.count != null && <> · {Number(status.count).toLocaleString('vi-VN')} bản ghi</>}
        {status?.updated && <> · {status.updated}</>}
      </div>
      {(running || pct > 0) && (
        <div className="progress-line">
          <div style={{ marginBottom: 6 }}>{status?.message || ''} — {Math.round(pct)}%</div>
          <div className="bar"><span style={{ width: `${pct}%` }} /></div>
        </div>
      )}
      {!running && status?.message && status.state !== 'idle' && (
        <div className="meta" style={{ color: status.state === 'error' ? 'var(--danger)' : undefined }}>{status.message}</div>
      )}
      <div className="btn-row" style={{ marginTop: 12 }}>{children}</div>
    </div>
  )
}

export default function AdminSection({ localMode }) {
  const [status, setStatus] = useState({})
  const [secrets, setSecrets] = useState({ msc: { username: '', password: '' }, vss: { cookie: '' }, autoCrawl: { enabled: false } })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [mscDates, setMscDates] = useState({ from: '', to: '' })

  const refresh = async () => {
    if (!localMode) return
    try {
      const s = await api.status()
      setStatus(s)
    } catch (e) {
      setMsg(String(e.message || e))
    }
  }

  useEffect(() => {
    if (!localMode) return
    api.secrets().then((s) => {
      setSecrets({
        msc: { username: s.msc?.username || '', password: s.msc?.hasPassword ? '********' : '' },
        vss: { cookie: s.vss?.cookie || '' },
        autoCrawl: s.autoCrawl || { enabled: false },
      })
    }).catch(() => {})
    refresh()
    const t = setInterval(refresh, 2000)
    return () => clearInterval(t)
  }, [localMode])

  const saveCreds = async () => {
    setBusy(true)
    try {
      await api.saveSecrets(secrets)
      setMsg('Đã lưu tài khoản (local, không commit git).')
    } catch (e) {
      setMsg(String(e.message || e))
    } finally {
      setBusy(false)
    }
  }

  if (!localMode) {
    return (
      <div>
        <section className="hero">
          <h1>Quản trị dữ liệu</h1>
          <p>Phần crawl chỉ chạy trên máy local. Trên GitHub Pages chỉ xem data đã export.</p>
        </section>
      </div>
    )
  }

  return (
    <div>
      <section className="hero">
        <h1>Quản trị dữ liệu & crawl</h1>
        <p>Theo dõi 3 miniapp, chạy cập nhật có tiến độ %, lưu tài khoản MSC để điền sẵn khi mở trình duyệt.</p>
      </section>

      <div className="admin-grid">
        <Card title="1. DAV — Đăng ký thuốc" status={status.dav}>
          <button type="button" className="btn" onClick={() => api.davCrawl({}).then(refresh)}>Tải / tiếp tục</button>
          <button type="button" className="btn secondary" onClick={() => api.davCrawl({ restart: true }).then(refresh)}>Từ đầu</button>
          <button type="button" className="btn ghost" onClick={() => api.davCrawlStop().then(refresh)}>Dừng</button>
          <button type="button" className="btn warn" onClick={() => api.davValidity().then(refresh)}>Rebuild hiệu lực</button>
        </Card>

        <Card title="2. MSC — Lọc thầu" status={status.msc}>
          <div className="field" style={{ width: '100%' }}>
            <label>Khoảng ngày đơn giá</label>
            <div className="btn-row">
              <input type="date" value={mscDates.from} onChange={(e) => setMscDates((d) => ({ ...d, from: e.target.value }))} />
              <input type="date" value={mscDates.to} onChange={(e) => setMscDates((d) => ({ ...d, to: e.target.value }))} />
            </div>
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => api.mscPrices({ dateFrom: mscDates.from, dateTo: mscDates.to }).then(refresh)}
          >
            Crawl đơn giá
          </button>
          <button type="button" className="btn secondary" onClick={() => api.mscTenders({ pages: 20 }).then(refresh)}>
            Crawl gói thầu (browser)
          </button>
        </Card>

        <Card title="3. VSS — BHYT trúng thầu" status={status.vss}>
          <button type="button" className="btn" onClick={() => api.vssCrawl({ days: 7 }).then(refresh)}>Crawl 7 ngày</button>
          <button type="button" className="btn secondary" onClick={() => api.vssImport({}).then((r) => { setMsg(JSON.stringify(r)); refresh() })}>
            Import Excel mặc định
          </button>
        </Card>
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <div className="panel-head"><h2>Tài khoản & tự động</h2></div>
        <div className="filters">
          <div className="filter-grid">
            <div className="field">
              <label>MSC username</label>
              <input value={secrets.msc.username} onChange={(e) => setSecrets((s) => ({ ...s, msc: { ...s.msc, username: e.target.value } }))} />
            </div>
            <div className="field">
              <label>MSC password</label>
              <input type="password" value={secrets.msc.password} onChange={(e) => setSecrets((s) => ({ ...s, msc: { ...s.msc, password: e.target.value } }))} />
            </div>
            <div className="field">
              <label>VSS cookie (tuỳ chọn)</label>
              <input value={secrets.vss.cookie} onChange={(e) => setSecrets((s) => ({ ...s, vss: { ...s.vss, cookie: e.target.value } }))} placeholder="session=…" />
            </div>
            <div className="field">
              <label>Nhắc tự cập nhật</label>
              <select
                value={secrets.autoCrawl?.enabled ? '1' : '0'}
                onChange={(e) => setSecrets((s) => ({ ...s, autoCrawl: { ...s.autoCrawl, enabled: e.target.value === '1' } }))}
              >
                <option value="0">Tắt</option>
                <option value="1">Bật (lưu preference local)</option>
              </select>
            </div>
          </div>
          <div className="btn-row">
            <button type="button" className="btn" onClick={saveCreds}>Lưu</button>
            <button type="button" className="btn secondary" onClick={refresh}>Làm mới trạng thái</button>
          </div>
          {msg && <div className="meta">{msg}</div>}
        </div>
      </div>
      <LoadingOverlay show={busy} percent={40} message="Đang lưu…" />
    </div>
  )
}
