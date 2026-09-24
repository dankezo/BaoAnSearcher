import { useEffect, useState } from 'react'
import { api, fmtDateTime, relativeTime, sectionMeta } from './api'
import { ErrorNote, Field, LoadingOverlay } from './components'

const STATE_LABEL = { idle: 'Sẵn sàng', running: 'Đang chạy', error: 'Lỗi' }

function StatusCard({ index, title, source, status, children }) {
  const pct = status?.progress || 0
  const state = status?.state || 'idle'
  const running = state === 'running'
  const m = sectionMeta({ x: status }, 'x')
  return (
    <div className={`admin-card state-${state}`}>
      <div className="admin-card-head">
        <span className="admin-index">{index}</span>
        <div>
          <h3>{title}</h3>
          <div className="muted small">{source}</div>
        </div>
        <span className={`state-pill ${state}`}>
          {running && <span className="dot" />}
          {STATE_LABEL[state] || state}
        </span>
      </div>

      <dl className="admin-stats">
        <div>
          <dt>Bản ghi</dt>
          <dd>{m.count != null ? Number(m.count).toLocaleString('vi-VN') : '—'}</dd>
        </div>
        <div>
          <dt>Cập nhật</dt>
          <dd title={m.updated || ''}>
            {m.updated ? fmtDateTime(m.updated) : '—'}
            {m.updated && <span className="muted small"> · {relativeTime(m.updated)}</span>}
          </dd>
        </div>
      </dl>

      {(running || (pct > 0 && pct < 100)) && (
        <div className="progress-line">
          <div className="progress-meta"><span>{status?.message || ''}</span><strong>{Math.round(pct)}%</strong></div>
          <div className="bar"><span style={{ width: `${pct}%` }} /></div>
        </div>
      )}
      {!running && status?.message && state !== 'idle' && (
        <div className={`admin-msg${state === 'error' ? ' error' : ''}`}>{status.message}</div>
      )}
      {!running && status?.message && state === 'idle' && (
        <div className="admin-msg">{status.message}</div>
      )}
      {status?.error && <div className="admin-msg error">{status.error}</div>}

      <div className="admin-actions">{children}</div>
    </div>
  )
}

export default function AdminSection({ localMode }) {
  const [status, setStatus] = useState({})
  const [secrets, setSecrets] = useState({ msc: { username: '', password: '' }, vss: { cookie: '' }, autoCrawl: { enabled: false } })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [mscDates, setMscDates] = useState({ from: '', to: '' })

  const refresh = async () => {
    if (!localMode) return
    try {
      const s = await api.status()
      setStatus(s)
      setErr('')
    } catch (e) {
      setErr(String(e.message || e))
    }
  }

  const run = (fn) => async () => {
    try {
      const r = await fn()
      if (r && r.ok === false && r.message) setMsg(r.message)
      await refresh()
    } catch (e) {
      setErr(String(e.message || e))
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
  }, [localMode]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveCreds = async () => {
    setBusy(true)
    try {
      await api.saveSecrets(secrets)
      setMsg('Đã lưu tài khoản (chỉ trên máy local, không commit git).')
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setBusy(false)
    }
  }

  if (!localMode) {
    return (
      <div className="section">
        <header className="section-head">
          <div>
            <span className="kicker">Quản trị</span>
            <h1>Quản trị dữ liệu</h1>
            <p>Phần crawl chỉ chạy trên máy local (API 127.0.0.1:8787). Trên GitHub Pages chỉ xem dữ liệu đã export.</p>
          </div>
        </header>
        <div className="panel pad">
          <div className="empty-state">
            <strong>Đang ở chế độ tĩnh (GitHub Pages).</strong>
            <span className="muted">Chạy <code>MO_WEB.cmd</code> hoặc <code>uvicorn server.main:app --port 8787</code> để mở bảng điều khiển crawl.</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="section">
      <header className="section-head">
        <div>
          <span className="kicker">Quản trị · Local API</span>
          <h1>Quản trị dữ liệu &amp; crawl</h1>
          <p>Theo dõi 3 nguồn dữ liệu, chạy cập nhật có tiến độ, lưu tài khoản MSC để điền sẵn khi mở trình duyệt.</p>
        </div>
      </header>

      <ErrorNote>{err}</ErrorNote>

      <div className="admin-grid">
        <StatusCard index="01" title="DAV — Đăng ký thuốc" source="dichvucong.dav.gov.vn" status={status.dav}>
          <button type="button" className="btn" onClick={run(() => api.davCrawl({}))}>Tải / tiếp tục</button>
          <button type="button" className="btn secondary" onClick={run(() => api.davCrawl({ restart: true }))}>Từ đầu</button>
          <button type="button" className="btn ghost" onClick={run(() => api.davCrawlStop())}>Dừng</button>
          <button type="button" className="btn warn" onClick={run(() => api.davValidity())}>Rebuild hiệu lực</button>
        </StatusCard>

        <StatusCard index="02" title="MSC — Đơn giá & gói thầu" source="muasamcong.mpi.gov.vn" status={status.msc}>
          <div className="date-range">
            <Field label="Từ ngày"><input type="date" value={mscDates.from} onChange={(e) => setMscDates((d) => ({ ...d, from: e.target.value }))} /></Field>
            <Field label="Đến ngày"><input type="date" value={mscDates.to} onChange={(e) => setMscDates((d) => ({ ...d, to: e.target.value }))} /></Field>
          </div>
          <button
            type="button"
            className="btn"
            disabled={!mscDates.from || !mscDates.to}
            onClick={run(() => api.mscPrices({ dateFrom: mscDates.from, dateTo: mscDates.to }))}
          >
            Crawl đơn giá
          </button>
          <button type="button" className="btn secondary" onClick={run(() => api.mscTenders({ pages: 20 }))}>
            Crawl gói thầu (browser)
          </button>
        </StatusCard>

        <StatusCard index="03" title="VSS — BHYT trúng thầu" source="baohiemxahoi.gov.vn" status={status.vss}>
          <button type="button" className="btn" onClick={run(() => api.vssCrawl({ days: 7 }))}>Crawl 7 ngày</button>
          <button type="button" className="btn secondary" onClick={run(async () => { const r = await api.vssImport({}); setMsg(JSON.stringify(r)); return r })}>
            Import Excel mặc định
          </button>
        </StatusCard>
      </div>

      <div className="panel">
        <div className="toolbar">
          <div className="toolbar-title">
            <span className="kicker">Cấu hình</span>
            <h2>Tài khoản &amp; tự động</h2>
          </div>
        </div>
        <div className="filters">
          <div className="filter-grid">
            <Field label="MSC username">
              <input value={secrets.msc.username} autoComplete="off" onChange={(e) => setSecrets((s) => ({ ...s, msc: { ...s.msc, username: e.target.value } }))} />
            </Field>
            <Field label="MSC password">
              <input type="password" autoComplete="new-password" value={secrets.msc.password} onChange={(e) => setSecrets((s) => ({ ...s, msc: { ...s.msc, password: e.target.value } }))} />
            </Field>
            <Field label="VSS cookie" hint="tuỳ chọn">
              <input value={secrets.vss.cookie} onChange={(e) => setSecrets((s) => ({ ...s, vss: { ...s.vss, cookie: e.target.value } }))} placeholder="session=…" />
            </Field>
            <Field label="Nhắc tự cập nhật">
              <select
                value={secrets.autoCrawl?.enabled ? '1' : '0'}
                onChange={(e) => setSecrets((s) => ({ ...s, autoCrawl: { ...s.autoCrawl, enabled: e.target.value === '1' } }))}
              >
                <option value="0">Tắt</option>
                <option value="1">Bật (lưu preference local)</option>
              </select>
            </Field>
          </div>
          <div className="filter-actions">
            <button type="button" className="btn" onClick={saveCreds}>Lưu</button>
            <button type="button" className="btn secondary" onClick={refresh}>Làm mới trạng thái</button>
            {msg && <span className="muted small">{msg}</span>}
          </div>
        </div>
      </div>
      <LoadingOverlay show={busy} percent={40} message="Đang lưu…" />
    </div>
  )
}
