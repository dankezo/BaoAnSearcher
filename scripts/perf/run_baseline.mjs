/**
 * P0 baseline. Times the current Turso search/metrics functions and local SQLite.
 * Does not print env values, tokens, or SQL arguments.
 *
 *   node scripts/perf/run_baseline.mjs
 *   node scripts/perf/run_baseline.mjs --backend turso
 *   node scripts/perf/run_baseline.mjs --backend sqlite
 */
import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const suitePath = path.join(root, 'scripts/perf/queries.json')
const outDir = path.join(root, 'docs/perf')
const outMd = path.join(outDir, 'baseline.md')
const outJson = path.join(outDir, 'baseline-samples.json')

function loadEnv() {
  const file = path.join(root, '.env')
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key]) continue
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

function regionOf(url) {
  const host = String(url || '').replace(/^[a-z]+:\/\//, '').split('/')[0]
  const match = host.match(/\.(aws-[a-z0-9-]+)\.turso\.io$/i)
  return match ? match[1] : 'unparsed'
}

function percentile(values, p) {
  const nums = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
  if (!nums.length) return null
  const idx = Math.min(nums.length - 1, Math.max(0, Math.ceil((p / 100) * nums.length) - 1))
  return nums[idx]
}

function fmt(n) {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 100) return `${Math.round(n)}`
  return n.toFixed(1)
}

function fmtBytes(n) {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(2)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${n} B`
}

function payloadStats(payload, op) {
  const text = JSON.stringify(payload ?? null)
  const bytes = Buffer.byteLength(text)
  let rows = null
  if (Array.isArray(payload?.items)) rows = payload.items.length
  else if (Array.isArray(payload?.cards)) rows = payload.cards.length
  else if (op === 'meta') rows = 1
  return { bytes, rows, total: payload?.total ?? null, cached: payload?.cached ?? null }
}

function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function safeError(error) {
  const code = error?.code === 'TIMEOUT' ? 'timeout' : String(error?.code || error?.name || 'error')
  const msg = String(error?.message || '').replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]').slice(0, 180)
  if (/BLOCKED|forbidden/i.test(`${code} ${msg}`)) return 'BLOCKED'
  if (code === 'timeout' || /timeout/i.test(msg)) return 'timeout'
  return msg || code
}

async function timeTursoQuery(run, query) {
  const timeoutMs = query.timeoutMs || 90000
  const repeats = query.repeats || 5
  const warmup = query.warmup ?? 1
  const samples = []
  let failLabel = null
  for (let i = 0; i < warmup + repeats; i += 1) {
    const warm = i < warmup
    const t0 = performance.now()
    try {
      const measured = await withTimeout(run(), timeoutMs)
      if (!warm) samples.push({ ...measured, ok: true })
    } catch (error) {
      failLabel = safeError(error)
      if (!warm) samples.push({ ok: false, error: failLabel, wallMs: performance.now() - t0 })
      if (failLabel === 'timeout' || failLabel === 'BLOCKED') break
    }
  }
  const summary = summarize(samples, timeoutMs)
  if (!summary.ok && failLabel) summary.error = failLabel
  return summary
}

function summarize(samples, timeoutMs) {
  const ok = samples.filter((s) => s.ok)
  const walls = ok.map((s) => s.wallMs)
  const dbs = ok.map((s) => s.dbMs).filter((n) => Number.isFinite(n))
  const last = ok[ok.length - 1] || samples[samples.length - 1] || {}
  return {
    n: samples.length,
    ok: ok.length,
    timeout: samples.some((s) => s.error === 'timeout'),
    timeoutMs,
    p50: percentile(walls, 50),
    p95: percentile(walls, 95),
    dbP50: percentile(dbs, 50),
    dbP95: percentile(dbs, 95),
    bytes: last.bytes ?? null,
    rows: last.rows ?? null,
    trips: last.trips ?? null,
    total: last.total ?? null,
    cached: last.cached ?? null,
    error: ok.length ? null : (last.error || 'error'),
  }
}

function wrapDb(db) {
  const stats = { trips: 0, dbMs: 0 }
  return {
    stats,
    reset() {
      stats.trips = 0
      stats.dbMs = 0
    },
    async execute(stmt) {
      stats.trips += 1
      const t0 = performance.now()
      try {
        return await db.execute(stmt)
      } finally {
        stats.dbMs += performance.now() - t0
      }
    },
  }
}

async function runTurso(suite) {
  const url = process.env.TURSO_DATABASE_URL || ''
  const token = process.env.TURSO_AUTH_TOKEN || ''
  if (!url || !token) return { skipped: true, reason: 'missing TURSO env', results: [] }
  const { createClient } = await import('@libsql/client')
  const { searchVss, searchDav, searchMsc } = await import('../../api-lib/routes/tenderSearch.js')
  const { computeSectionMetrics } = await import('../../api-lib/metricsCompute.js')
  const client = createClient({ url, authToken: token })
  const db = wrapDb(client)
  const results = []
  let blocked = false
  for (const query of suite.queries) {
    if (blocked) {
      results.push({
        id: query.id, n: 0, ok: 0, timeout: false, timeoutMs: query.timeoutMs || 90000,
        p50: null, p95: null, dbP50: null, dbP95: null,
        bytes: null, rows: null, trips: null, total: null, cached: null, error: 'BLOCKED',
      })
      continue
    }
    process.stderr.write(`turso ${query.id}\n`)
    const measured = await timeTursoQuery(async () => {
      db.reset()
      const t0 = performance.now()
      let payload
      if (query.op === 'search') {
        const page = query.page || 0
        const size = query.size || 100
        if (query.kind === 'dav') payload = await searchDav(db, query.filters, page, size)
        else if (query.kind === 'msc_prices' || query.kind === 'msc_tenders') {
          payload = await searchMsc(db, query.kind, query.filters, page, size)
        } else payload = await searchVss(db, query.filters, page, size)
      } else if (query.op === 'meta') {
        const rs = await db.execute('SELECT key_name, total_records, updated_at FROM app_metadata')
        const meta = Object.fromEntries((rs.rows || []).map((row) => [row.key_name, Number(row.total_records || 0)]))
        payload = { count: meta.vss_total || meta.msc_total || 0, totals: meta }
      } else if (query.op === 'metrics-cache') {
        const key = query.section === 'vss' ? 'metrics_vss' : `metrics_${query.section}`
        const rs = await db.execute({
          sql: 'SELECT value, updated_at FROM app_meta WHERE key = ? LIMIT 1',
          args: [key],
        })
        const row = rs.rows?.[0]
        let value = row?.value
        if (typeof value === 'string') {
          try { value = JSON.parse(value) } catch { value = { raw: true } }
        }
        payload = value || { missing: true }
      } else if (query.op === 'metrics-cold') {
        payload = await computeSectionMetrics(db, query.section || 'vss')
      } else {
        throw new Error('unknown op')
      }
      const wallMs = performance.now() - t0
      const stats = payloadStats(payload, query.op)
      return { wallMs, dbMs: db.stats.dbMs, trips: db.stats.trips, ...stats }
    }, query)
    results.push({ id: query.id, ...measured })
    if (measured.error === 'BLOCKED') blocked = true
    process.stderr.write(`  p50=${fmt(measured.p50)} rows=${measured.rows ?? '—'}\n`)
  }
  return { skipped: false, region: regionOf(url), results }
}

function startSqliteWorker() {
  const child = spawn(process.env.PYTHON || 'python', ['-u', path.join(root, 'scripts/perf/sqlite_worker.py')], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  })
  let stdout = ''
  const pending = new Map()
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    stdout += chunk
    let nl
    while ((nl = stdout.indexOf('\n')) >= 0) {
      const line = stdout.slice(0, nl).trim()
      stdout = stdout.slice(nl + 1)
      if (!line) continue
      let msg
      try { msg = JSON.parse(line) } catch { continue }
      const wait = pending.get(msg.id)
      if (wait) {
        pending.delete(msg.id)
        wait.resolve(msg)
      }
    }
  })
  child.stderr.on('data', (chunk) => process.stderr.write(chunk))
  child.on('exit', () => {
    for (const wait of pending.values()) wait.resolve({ ok: false, error: 'worker-exit' })
    pending.clear()
  })
  return { child, pending }
}

async function runSqlite(suite) {
  let worker = startSqliteWorker()
  const results = []
  const ask = (query, timeoutMs) => new Promise((resolveOne) => {
    const timer = setTimeout(() => {
      worker.pending.delete(query.id)
      resolveOne({ ok: false, error: 'timeout', wallMs: timeoutMs })
    }, timeoutMs)
    worker.pending.set(query.id, {
      resolve: (msg) => {
        clearTimeout(timer)
        resolveOne(msg)
      },
    })
    worker.child.stdin.write(`${JSON.stringify(query)}\n`)
  })

  for (const query of suite.queries) {
    const timeoutMs = query.op === 'search' ? 90000 : (query.timeoutMs || 120000)
    const repeats = query.op === 'metrics-cold' ? 1 : 3
    const warmup = query.op === 'metrics-cold' || query.op === 'meta' ? 0 : 1
    process.stderr.write(`sqlite ${query.id}\n`)
    const samples = []
    for (let i = 0; i < warmup + repeats; i += 1) {
      const msg = await ask(query, timeoutMs)
      if (!msg.ok && (msg.error === 'timeout' || msg.error === 'worker-exit')) {
        worker.child.kill()
        worker = startSqliteWorker()
        if (i >= warmup) samples.push({ ok: false, error: 'timeout', wallMs: timeoutMs })
        break
      }
      if (i >= warmup) {
        samples.push(msg.ok
          ? { ok: true, wallMs: msg.wallMs, bytes: msg.bytes, rows: msg.rows, trips: msg.trips, total: msg.total }
          : { ok: false, error: msg.error || 'error' })
        if (!msg.ok) break
      }
    }
    const summary = summarize(samples, timeoutMs)
    results.push({ id: query.id, ...summary })
    process.stderr.write(`  p50=${fmt(summary.p50)} rows=${summary.rows ?? '—'}\n`)
  }
  worker.child.stdin.end()
  return results
}

function median(nums) {
  return percentile(nums.filter((n) => Number.isFinite(n)), 50)
}

function render(suite, turso, sqlite) {
  const byId = (list) => Object.fromEntries((list || []).map((row) => [row.id, row]))
  const tMap = byId(turso.results)
  const sMap = byId(sqlite)
  const lines = []
  lines.push('# Baseline hiệu năng P0')
  lines.push('')
  lines.push(`Đo lúc ${new Date().toISOString()}. Logic tìm kiếm không đổi. Số liệu là thời gian gọi thẳng hàm hiện tại, chưa gồm vòng auth Supabase \`getUser\` trên Vercel.`)
  lines.push('')
  lines.push('## Cách đo')
  lines.push('')
  lines.push('- Bộ truy vấn: `scripts/perf/queries.json` (30 câu).')
  lines.push('- Turso: cùng hàm `searchVss` / `searchDav` / `searchMsc`, `app_metadata`, `app_meta`, và `computeSectionMetrics`. Nếu dịch vụ trả `BLOCKED`, các câu sau được ghi nhận cùng trạng thái, không gửi thêm SQL.')
  lines.push('- SQLite local: cùng filter, gọi `search_bids` / `search_drugs` / `msc.search` / `read_metrics`. Mỗi câu search: 1 warmup + 3 mẫu. Meta: 3 mẫu, không warmup. Metric lạnh local: 1 lần `slice_payload` (lọc hoạt chất, không ghi DB), vì dashboard local không tính lại fact table khi mở trang.')
  lines.push('- VSS local luôn kèm `COUNT(*)` (2 round-trip). p50/p95 tính trên mẫu thành công. Payload là byte JSON của kết quả hàm.')
  lines.push(`- Turso region (từ hostname, không ghi URL): ${turso.skipped ? 'không đo' : turso.region}.`)
  lines.push('- Turso đọc SQL đang bị chặn ở phía dịch vụ (`BLOCKED`: reads are forbidden trên plan hiện tại). Cột Turso ghi BLOCKED khi không có mẫu thành công. Thời gian nhận lỗi không được tính là latency truy vấn.')
  if (turso.skipped) lines.push(`- Turso bỏ qua: ${turso.reason}.`)
  lines.push('')
  lines.push('## Catalog (từ meta Turso, nếu đo được)')
  lines.push('')
  const meta = tMap['meta-vss']
  lines.push(meta?.rows != null ? 'Tổng catalog nằm trong kết quả `meta-vss` / `meta-msc` ở bảng dưới (cột rows chỉ là số bản ghi trả về, không phải số dòng bảng).' : 'Chưa có số catalog.')
  lines.push('')
  lines.push('## Từng truy vấn')
  lines.push('')
  lines.push('| ID | Endpoint | Turso p50 ms | Turso p95 ms | DB p50 ms | Bytes | Rows | Trips | SQLite p50 ms | SQLite p95 ms | SQLite rows |')
  lines.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
  for (const query of suite.queries) {
    const t = tMap[query.id] || {}
    const s = sMap[query.id] || {}
    const blocked = t.ok === 0 && t.error === 'BLOCKED'
    const tP50 = blocked ? 'BLOCKED' : (t.timeout && t.ok === 0 ? `>${t.timeoutMs}` : fmt(t.p50))
    const tP95 = blocked ? 'BLOCKED' : (t.timeout && t.ok === 0 ? `>${t.timeoutMs}` : fmt(t.p95))
    const sP50 = s.timeout && s.ok === 0 ? `>${s.timeoutMs}` : fmt(s.p50)
    const sP95 = s.timeout && s.ok === 0 ? `>${s.timeoutMs}` : fmt(s.p95)
    lines.push(`| ${query.id} | \`${query.endpoint}\` | ${tP50} | ${tP95} | ${fmt(t.dbP50)} | ${fmtBytes(t.bytes)} | ${t.rows ?? '—'} | ${t.trips ?? '—'} | ${sP50} | ${sP95} | ${s.rows ?? '—'} |`)
  }
  lines.push('')
  const searchIds = suite.queries.filter((q) => q.op === 'search').map((q) => q.id)
  const tSearch = searchIds.map((id) => tMap[id]?.p50).filter((n) => Number.isFinite(n))
  const sSearch = searchIds.map((id) => sMap[id]?.p50).filter((n) => Number.isFinite(n))
  lines.push('## Tóm tắt search')
  lines.push('')
  const tP95s = searchIds.map((id) => tMap[id]?.p95).filter((n) => Number.isFinite(n))
  const worst = tP95s.length ? ` p95 xấu nhất = ${fmt(Math.max(...tP95s))} ms.` : ''
  lines.push(`- Turso: ${tSearch.length}/${searchIds.length} câu có mẫu. Trung vị p50 = ${fmt(median(tSearch))} ms.${worst}`)
  lines.push(`- SQLite: ${sSearch.length}/${searchIds.length} câu có mẫu. Trung vị p50 = ${fmt(median(sSearch))} ms.`)
  const cold = tMap['metrics-vss-cold']
  lines.push(`- Metric VSS lạnh (Turso): p50 ${fmt(cold?.p50)} ms, ${cold?.trips ?? '—'} round-trip SQL, payload ${fmtBytes(cold?.bytes)}.`)
  const cache = tMap['metrics-vss-cache']
  lines.push(`- Metric VSS cache (Turso): p50 ${fmt(cache?.p50)} ms, payload ${fmtBytes(cache?.bytes)}.`)
  lines.push('')
  lines.push('## Ghi chú')
  lines.push('')
  lines.push('- Header `Server-Timing` (`auth`, `db`, `serialize`) và log `requestId, dbMs, rows, bytes` đã gắn ở `/api/tender/search|metrics|meta`. Bản đo này gọi hàm DB trực tiếp nên chưa có số `auth` của production.')
  lines.push('- `total` trên Turso search hiện là `null` (không `COUNT`). SQLite VSS trả `total` vì `search_bids` đếm trước khi lấy trang.')
  lines.push('- Dừng tại P0. Chưa đổi schema, adapter, hay UI.')
  lines.push('')
  return lines.join('\n')
}

async function main() {
  loadEnv()
  const backend = process.argv.includes('--backend')
    ? process.argv[process.argv.indexOf('--backend') + 1]
    : 'both'
  const suite = JSON.parse(fs.readFileSync(suitePath, 'utf8'))
  const only = process.argv.includes('--only')
    ? process.argv[process.argv.indexOf('--only') + 1]
    : ''
  if (only) suite.queries = suite.queries.filter((q) => q.id === only)
  if (!only && suite.queries.length !== 30) {
    throw new Error(`expected 30 queries, got ${suite.queries.length}`)
  }
  const turso = backend === 'sqlite' ? { skipped: true, reason: 'flag', results: [] } : await runTurso(suite)
  const sqlite = backend === 'turso' ? [] : await runSqlite(suite)
  fs.mkdirSync(outDir, { recursive: true })
  const body = {
    measuredAt: new Date().toISOString(),
    tursoRegion: turso.region || null,
    queries: suite.queries.map((q) => ({ id: q.id, endpoint: q.endpoint, op: q.op, kind: q.kind || null })),
    turso: turso.results,
    sqlite,
  }
  fs.writeFileSync(outJson, JSON.stringify(body, null, 2))
  fs.writeFileSync(outMd, render(suite, turso, sqlite))
  process.stderr.write(`wrote ${outMd}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error?.name || 'Error'}: ${error?.message || 'baseline failed'}\n`)
  process.exit(1)
})
