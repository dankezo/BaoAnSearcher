import { useEffect, useRef, useState } from 'react'
import { api, fmtDateTime, relativeTime, sectionMeta } from './api'
import { cloudDataRegistry, cloudDatasetDownload } from './supabaseCloud'
import { ErrorNote, Field, LoadingOverlay } from './components'

const STATE_LABEL = { idle: 'Sẵn sàng', running: 'Đang chạy', error: 'Lỗi' }
const REGISTRY_STATE = {
  healthy: { label: 'Hoạt động tốt', icon: '●' },
  syncing: { label: 'Đang cập nhật', icon: '●' },
  warning: { label: 'Cần kiểm tra', icon: '●' },
}

function RegistryCard({ dataset, downloading, onOpen, onDownload }) {
  const state = REGISTRY_STATE[dataset.status] || REGISTRY_STATE.warning
  const size = dataset.fileSizeMb == null ? '' : ` · ${Number(dataset.fileSizeMb).toLocaleString('vi-VN')} MB`
  return (
    <article className="registry-card">
      <div className="registry-card-top">
        <span className={`registry-badge ${dataset.status || 'warning'}`}><i>{state.icon}</i>{state.label}</span>
        <span className="registry-code">{dataset.code}</span>
      </div>
      <div>
        <h2>{dataset.name}</h2>
        <p>{dataset.description}</p>
      </div>
      <div className="registry-total">
        <strong>{Number(dataset.totalRecords || 0).toLocaleString('vi-VN')}</strong>
        <span>bản ghi</span>
      </div>
      <dl className="registry-detail">
        <div><dt>Đồng bộ gần nhất</dt><dd title={dataset.lastSyncedAt || ''}>{dataset.lastSyncedAt ? `${fmtDateTime(dataset.lastSyncedAt)} · ${relativeTime(dataset.lastSyncedAt)}` : 'Chưa có dữ liệu'}</dd></div>
        <div><dt>Snapshot CSV</dt><dd>{dataset.r2DownloadUrl ? `Sẵn sàng${size}` : 'Chưa xuất Snapshot'}</dd></div>
      </dl>
      <div className="registry-actions">
        <button type="button" className="btn secondary" onClick={() => onOpen(dataset.code)}>Tra cứu dữ liệu</button>
        <button type="button" className="btn" disabled={!dataset.r2DownloadUrl || downloading === dataset.code} onClick={() => onDownload(dataset.code)}>
          {downloading === dataset.code ? 'Đang mở tải…' : 'Tải bản Snapshot (CSV)'}
        </button>
      </div>
    </article>
  )
}

function DataRegistryHub({ registry, loading, error, downloading, onOpen, onDownload, onRefresh }) {
  const datasets = registry?.datasets || []
  const healthy = datasets.length === 4 && datasets.every((dataset) => dataset.status === 'healthy')
  const syncing = datasets.some((dataset) => dataset.status === 'syncing')
  const headline = loading ? 'Đang đọc trạng thái hệ thống…' : syncing ? 'Có nguồn dữ liệu đang cập nhật' : healthy ? '4/4 nguồn đang hoạt động tốt' : 'Có nguồn cần kiểm tra'
  return (
    <section className="data-registry-hub" aria-labelledby="data-registry-title">
      <header className="data-registry-head">
        <div>
          <span className="kicker">Data Management Hub</span>
          <h1 id="data-registry-title">Trung tâm Quản trị Dữ liệu</h1>
          <p>Giám sát 4 nguồn lõi bằng snapshot metadata. Trang này không tải hay đếm bảng dữ liệu thô.</p>
        </div>
        <div className={`registry-overall ${healthy ? 'healthy' : syncing ? 'syncing' : 'warning'}`}>
          <span>{healthy ? '●' : syncing ? '●' : '●'}</span>{headline}
          <button type="button" className="btn ghost sm" onClick={onRefresh} disabled={loading}>Làm mới</button>
        </div>
      </header>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="registry-grid">
        {datasets.map((dataset) => <RegistryCard key={dataset.code} dataset={dataset} downloading={downloading} onOpen={onOpen} onDownload={onDownload} />)}
        {!loading && !datasets.length && <div className="empty-state">Chưa có metadata. Chạy migration TiDB 004 để khởi tạo 4 nguồn dữ liệu.</div>}
        {loading && !datasets.length && <div className="empty-state">Đang tải 4 nguồn dữ liệu…</div>}
      </div>
    </section>
  )
}

function localISODate(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function recentDateRange(days) {
  const to = new Date()
  const from = new Date()
  from.setDate(to.getDate() - (days - 1))
  return { from: localISODate(from), to: localISODate(to) }
}

function StatusCard({ index, title, source, status, recordLabel = 'Bản ghi', recordValue, children }) {
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
          <dt>{recordLabel}</dt>
          <dd>{recordValue ?? (m.count != null ? Number(m.count).toLocaleString('vi-VN') : '—')}</dd>
        </div>
        <div>
          <dt>Cập nhật</dt>
          <dd title={m.updated || ''}>
            {m.updated ? fmtDateTime(m.updated) : '—'}
            {m.updated && <span className="muted small"> · {relativeTime(m.updated)}</span>}
          </dd>
        </div>
      </dl>
      {Number.isFinite(Number(status?.added)) && (
        <div className="muted small">Mới trong lượt này: <strong>+{Number(status.added).toLocaleString('vi-VN')}</strong> bản ghi</div>
      )}

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

function PlatformCheck({ title, value }) {
  const state = value?.state || 'not_configured'
  const label = state === 'ok' ? 'Ổn' : state === 'error' ? 'Cần kiểm tra' : 'Chưa cấu hình'
  return (
    <div className={`admin-msg ${state === 'error' ? 'error' : ''}`}>
      <strong>{title} · {label}</strong><br />
      <span className="muted small">{value?.message || 'Đang chờ kiểm tra…'}</span>
    </div>
  )
}

export default function AdminSection({ localMode }) {
  const [status, setStatus] = useState({})
  const [secrets, setSecrets] = useState({ msc: { username: '', password: '' }, vss: { cookie: '' }, autoCrawl: { enabled: false } })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [mscDates, setMscDates] = useState(() => recentDateRange(20))
  const [showMscPassword, setShowMscPassword] = useState(false)
  const [platform, setPlatform] = useState({ state: 'idle', checks: {}, production: {} })
  const [productionSync, setProductionSync] = useState({ state: 'idle', verified: false })
  const [registry, setRegistry] = useState({ datasets: [] })
  const [registryLoading, setRegistryLoading] = useState(true)
  const [registryError, setRegistryError] = useState('')
  const [downloading, setDownloading] = useState('')
  const refreshInFlight = useRef(false)
  const refreshFailures = useRef(0)

  const refresh = async () => {
    if (!localMode || refreshInFlight.current) return { ok: false, running: true }
    refreshInFlight.current = true
    try {
      let lastError
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const [s, sync] = await Promise.all([api.status(), api.productionSyncStatus().catch(() => null)])
          setStatus(s)
          if (sync) setProductionSync(sync)
          refreshFailures.current = 0
          setErr((previous) => previous.startsWith('Không lấy được trạng thái') ? '' : previous)
          return { ok: true, running: [s.dav, s.msc, s.vss, s.msc_scope].some((item) => item?.state === 'running') }
        } catch (error) {
          lastError = error
          if (attempt === 0) await new Promise((resolve) => window.setTimeout(resolve, 400))
        }
      }
      refreshFailures.current += 1
      // A single missed status poll is normal while Windows releases a file
      // handle. Keep the last good progress on screen and retry quietly.
      if (refreshFailures.current >= 3) {
        setErr('Không lấy được trạng thái crawl. Ứng dụng vẫn đang tự thử lại; tiến độ gần nhất được giữ nguyên.')
      }
      return { ok: false, running: true, error: lastError }
    } finally {
      refreshInFlight.current = false
    }
  }

  const refreshPlatform = async (force = false) => {
    try {
      const value = await api.platformStatus(force)
      setPlatform(value)
      return value
    } catch {
      return null
    }
  }

  const refreshRegistry = async () => {
    setRegistryLoading(true)
    try {
      const next = await cloudDataRegistry()
      setRegistry(next || { datasets: [] })
      setRegistryError('')
    } catch (error) {
      setRegistryError('Không lấy được trạng thái Data Hub. Vui lòng thử lại.')
    } finally {
      setRegistryLoading(false)
    }
  }

  const openDataset = (code) => {
    window.dispatchEvent(new CustomEvent('baoan-open-dataset', { detail: code }))
  }

  const downloadDataset = async (code) => {
    setDownloading(code)
    try {
      const result = await cloudDatasetDownload(code)
      if (!result?.url) throw new Error('Snapshot chưa sẵn sàng.')
      window.location.assign(result.url)
    } catch (error) {
      setRegistryError(String(error.message || 'Không mở được Snapshot R2.'))
    } finally {
      setDownloading('')
    }
  }

  useEffect(() => {
    let stopped = false
    const load = async () => {
      await refreshRegistry()
      if (!stopped) timer = window.setTimeout(load, 30000)
    }
    let timer = null
    load()
    return () => { stopped = true; if (timer) window.clearTimeout(timer) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
    refreshPlatform(true)
    let stopped = false
    let timer = null
    const poll = async () => {
      const result = await refresh()
      refreshPlatform(false)
      if (stopped) return
      const delay = result.ok
        ? (result.running ? 3000 : 12000)
        : Math.min(30000, 2000 * (2 ** Math.min(refreshFailures.current, 4)))
      timer = window.setTimeout(poll, delay)
    }
    poll()
    return () => { stopped = true; if (timer) window.clearTimeout(timer) }
  }, [localMode]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleMscPassword = async () => {
    if (showMscPassword) {
      setSecrets((s) => ({ ...s, msc: { ...s.msc, password: s.msc.password ? '********' : '' } }))
      setShowMscPassword(false)
      return
    }
    try {
      const current = await api.secrets({ revealPassword: true })
      setSecrets((s) => ({ ...s, msc: { ...s.msc, password: current.msc?.password || '' } }))
      setShowMscPassword(true)
    } catch (e) {
      setErr(String(e.message || e))
    }
  }

  const saveCreds = async () => {
    setBusy(true)
    try {
      const saved = await api.saveSecrets(secrets)
      const task = saved?.task ? ` ${saved.task}` : ''
      setMsg(`Đã lưu cấu hình trên máy local.${task}`)
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setBusy(false)
    }
  }

  if (!localMode) {
    return (
      <div className="section">
        <DataRegistryHub registry={registry} loading={registryLoading} error={registryError} downloading={downloading} onOpen={openDataset} onDownload={downloadDataset} onRefresh={refreshRegistry} />
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

      <DataRegistryHub registry={registry} loading={registryLoading} error={registryError} downloading={downloading} onOpen={openDataset} onDownload={downloadDataset} onRefresh={refreshRegistry} />

      <div className="admin-grid">
        <StatusCard index="01" title="DAV — Đăng ký thuốc" source="dichvucong.dav.gov.vn" status={status.dav}>
          <button type="button" className="btn" onClick={run(() => api.davCrawl({}))}>Tải cập nhật</button>
          <button type="button" className="btn secondary" onClick={run(() => api.davCrawl({ restart: true }))}>Từ đầu</button>
          <button type="button" className="btn ghost" onClick={run(() => api.davCrawlStop())}>Dừng</button>
          <button type="button" className="btn warn" onClick={run(() => api.davValidity())}>Rebuild hiệu lực</button>
        </StatusCard>

        <StatusCard
          index="02"
          title="MSC — Đơn giá & gói thầu"
          source="muasamcong.mpi.gov.vn"
          status={status.msc}
          recordLabel="Đơn giá hiển thị"
          recordValue={status.msc?.meta?.prices != null ? Number(status.msc.meta.prices).toLocaleString('vi-VN') : undefined}
        >
          <p className="muted small">Gói thầu: {status.msc?.meta?.tenders != null ? Number(status.msc.meta.tenders).toLocaleString('vi-VN') : '—'} bản ghi — được quản lý riêng trong tab Gói thầu.</p>
          <div className="date-range">
            <Field label="Từ ngày"><input type="date" value={mscDates.from} onChange={(e) => setMscDates((d) => ({ ...d, from: e.target.value }))} /></Field>
            <Field label="Đến ngày"><input type="date" value={mscDates.to} onChange={(e) => setMscDates((d) => ({ ...d, to: e.target.value }))} /></Field>
          </div>
          <button
            type="button"
            className="btn"
            disabled={!mscDates.from || !mscDates.to}
            onClick={run(() => api.mscPricesBrowser({ dateFrom: mscDates.from, dateTo: mscDates.to, maxPages: 20 }))}
          >
            Cập nhật hằng ngày · 20 trang × 50 / nhóm (browser)
          </button>
          <button
            type="button"
            className="btn warn"
            disabled={!mscDates.to}
            onClick={run(() => api.mscPricesBrowser({ dateFrom: '2024-01-01', dateTo: mscDates.to, fullScan: true }))}
          >
            Quét tổng thể đơn giá 2024 → nay
          </button>
          <button
            type="button"
            className="btn warn"
            disabled={!mscDates.to}
            onClick={run(() => api.mscPricesBrowser({ dateFrom: '2014-01-01', dateTo: mscDates.to, fullScan: true }))}
          >
            Quét toàn bộ lịch sử 2014 → nay
          </button>
          <button
            type="button"
            className="btn secondary"
            disabled={!mscDates.from || !mscDates.to}
            onClick={run(() => api.mscPricesBrowser({ dateFrom: mscDates.from, dateTo: mscDates.to, fullScan: true }))}
          >
            Quét đủ khoảng đã chọn
          </button>
          <button type="button" className="btn secondary" onClick={run(() => api.mscTenders({ pages: 20 }))}>
            Crawl gói thầu (browser)
          </button>
          <p className="muted small">Trình duyệt mở phiên MSC bình thường rồi lấy 50 dòng/trang. Lượt hằng ngày lấy 20 trang cho mỗi nhóm thuốc; quét đủ dùng Export trong chính phiên đó và chỉ xác nhận khi số dòng/ID khớp. Số tổng trên website nguồn có thể gồm cả trước 2024: dùng “toàn bộ lịch sử” khi cần đối chiếu con số đó. Nếu được hỏi, xác nhận captcha trong cửa sổ MSC.</p>
        </StatusCard>

        <StatusCard index="02b" title="MSC — Hồ sơ gói đang mở" source="Tải danh mục thuốc từ trang nguồn và đối chiếu Bảo An" status={status.msc_scope}>
          {status.msc_scope?.errors?.length > 0 && <ul className="scope-pending">{status.msc_scope.errors.map((row) => <li key={row.tender_no}><strong>{row.tender_no}</strong> · {row.message} {/^https:\/\/muasamcong\.mpi\.gov\.vn\//.test(row.source_url || '') && <a href={row.source_url} target="_blank" rel="noreferrer">Mở hồ sơ nguồn ↗</a>}</li>)}</ul>}
          <p className="muted small">Chạy cùng lượt Crawl gói thầu, không đăng nhập lần hai. Bấm ở đây chỉ khi cần quét lại riêng.</p>
          <button type="button" className="btn" disabled={status.msc_scope?.state === 'running'} onClick={run(() => api.mscScope())}>Quét hồ sơ gói đang mở</button>
          <button type="button" className="btn secondary" disabled={status.msc_scope?.state === 'running'} onClick={run(() => api.mscScope({ refresh: true }))}>Tải lại & đối chiếu</button>
        </StatusCard>

        <StatusCard index="04" title="Bảng tin pháp luật" source="DAV · Bộ Y tế · Báo Chính phủ · Thư viện Pháp luật" status={{
          state: secrets.autoCrawl?.daily?.regulatory === 'error' ? 'error' : secrets.autoCrawl?.daily?.regulatory === 'running' ? 'running' : 'idle',
          message: secrets.autoCrawl?.daily?.regulatory === 'ok'
            ? 'Lượt cào tin hôm nay đã xong.'
            : (secrets.autoCrawl?.daily?.message || 'Tin đưa vào Trang chủ sau khi cào và phân tích.'),
          updated: secrets.autoCrawl?.daily?.updated,
        }}>
          <p className="muted small">Nút này chỉ lấy tin quy phạm. Không đụng DAV, MSC hay VSS. Tin sau khi cào hiện ở Trang chủ.</p>
          <button type="button" className="btn" onClick={run(async () => { const result = await api.regulatoryCrawl(); setMsg(result.message || ''); return result })}>Cào tin pháp luật</button>
        </StatusCard>

        <StatusCard index="03" title="VSS — BHYT trúng thầu" source="quanlythuocv1.vss.gov.vn/kqdt/export" status={status.vss}>
          <button type="button" className="btn" onClick={run(() => api.vssCrawl({ days: 90, catchup: true }))}>
            Crawl bắt kịp (export Excel/ngày)
          </button>
          <button type="button" className="btn secondary" onClick={run(() => api.vssCrawl({ days: 2 }))}>
            Crawl 2 ngày
          </button>
          <button type="button" className="btn ghost" onClick={run(() => api.vssCrawlStop())}>Dừng</button>
          <button type="button" className="btn secondary" onClick={run(async () => { const r = await api.vssImport({}); setMsg(JSON.stringify(r)); return r })}>
            Import Excel mặc định
          </button>
        </StatusCard>
      </div>

      <div className="panel pad" style={{ marginTop: 16 }}>
        <div className="toolbar-title" style={{ marginBottom: 8 }}>
          <span className="kicker">Production</span>
          <h2>Đồng bộ &amp; kiểm chứng TiDB</h2>
        </div>
        <p className="muted" style={{ margin: '0 0 10px' }}>
          Nút chính đẩy SQLite local lên TiDB, rồi tự đối chiếu số lượng local–TiDB. Chỉ khi đối chiếu đạt mới được báo hoàn tất.
        </p>
        <div className="admin-actions">
          <button type="button" className="btn" disabled={busy || productionSync.state === 'running'} onClick={run(() => api.productionSync({}))}>
            Đồng bộ &amp; đối chiếu TiDB
          </button>
          <button type="button" className="btn secondary" onClick={() => refreshPlatform(true)}>
            Kiểm tra các dịch vụ
          </button>
        </div>
        {productionSync.state === 'running' && <div className="admin-msg">{productionSync.message || 'Đang đồng bộ…'}</div>}
        {productionSync.state === 'error' && <div className="admin-msg error">{productionSync.message}</div>}
        {productionSync.verified && <div className="admin-msg">✓ {productionSync.message}</div>}
        <div className="admin-actions" style={{ marginTop: 12 }}>
          <PlatformCheck title="TiDB" value={platform.checks?.tidb} />
          <PlatformCheck title="Supabase" value={platform.checks?.supabase} />
          <PlatformCheck title="Vercel" value={platform.checks?.vercel} />
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>
          Backend local: <strong>{platform.production?.configuredBackend || 'đang kiểm tra'}</strong>. {platform.production?.message || ''}
        </p>
        <details className="muted small" style={{ marginTop: 8 }}>
          <summary>Đồng bộ Supabase bản sao (không thay TiDB production)</summary>
          <div className="admin-actions" style={{ marginTop: 8 }}>
            <button type="button" className="btn secondary" disabled={busy} onClick={run(() => api.supabaseSync({ only: 'vss,dav,msc' }))}>Đồng bộ Supabase</button>
          </div>
        </details>
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
              <div className="password-field">
                <input type={showMscPassword ? 'text' : 'password'} autoComplete="new-password" value={secrets.msc.password} onChange={(e) => setSecrets((s) => ({ ...s, msc: { ...s.msc, password: e.target.value } }))} />
                <button type="button" className="btn ghost sm" onClick={toggleMscPassword} aria-pressed={showMscPassword}>
                  {showMscPassword ? 'Ẩn' : 'Xem'}
                </button>
              </div>
            </Field>
            <Field
              label="VSS cookie"
              help={(
                <>
                  <strong>Cách lấy cookie</strong>
                  <ol>
                    <li>Đăng nhập <a href="https://quanlythuocv1.vss.gov.vn" target="_blank" rel="noreferrer">quanlythuocv1.vss.gov.vn</a>, mở trang kết quả trúng thầu.</li>
                    <li>Nhấn F12 → thẻ Network → tải lại trang.</li>
                    <li>Chọn một request tới site này → phần Request Headers.</li>
                    <li>Copy nguyên giá trị dòng Cookie (dạng JSESSIONID=… hoặc session=…).</li>
                    <li>Dán vào ô bên dưới. Cookie chỉ lưu trên máy local.</li>
                  </ol>
                </>
              )}
            >
              <input value={secrets.vss.cookie} onChange={(e) => setSecrets((s) => ({ ...s, vss: { ...s.vss, cookie: e.target.value } }))} placeholder="JSESSIONID=… hoặc session=…" />
            </Field>
            <Field
              label="Tự cập nhật hàng ngày"
                hint="Tin pháp luật từ MOH/DAV/Thư viện Pháp luật; DAV danh mục, MSC 20 trang đơn giá mới nhất, VSS 2 ngày. Chạy khi mở app và đăng nhập máy; mỗi nguồn pháp luật có lịch riêng."
            >
              <select
                value={secrets.autoCrawl?.enabled ? '1' : '0'}
                onChange={(e) => setSecrets((s) => ({
                  ...s,
                  autoCrawl: { ...s.autoCrawl, enabled: e.target.value === '1' },
                }))}
              >
                <option value="0">Tắt</option>
                  <option value="1">Bật — Pháp luật + DAV + MSC + VSS</option>
              </select>
            </Field>
          </div>
          <div className="filter-actions">
            <button type="button" className="btn" onClick={saveCreds}>Lưu</button>
            <button type="button" className="btn secondary" onClick={run(() => api.dailyRun())}>
              Chạy cập nhật hôm nay
            </button>
            <button type="button" className="btn secondary" onClick={refresh}>Làm mới trạng thái</button>
            {secrets.autoCrawl?.daily?.message && (
              <span className="muted small">
                {secrets.autoCrawl.daily.date ? `${secrets.autoCrawl.daily.date}: ` : ''}
                {secrets.autoCrawl.daily.message}
              </span>
            )}
            {msg && <span className="muted small">{msg}</span>}
          </div>
        </div>
      </div>
      <LoadingOverlay show={busy} percent={40} message="Đang lưu…" />
    </div>
  )
}
