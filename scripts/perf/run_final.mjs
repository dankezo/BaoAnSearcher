/**
 * P7 local parity. Re-runs the 30-query suite on SQLite after the year-filter fix.
 * Does not overwrite docs/perf/baseline.md and does not open TiDB.
 *
 *   node scripts/perf/run_final.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const suitePath = path.join(root, 'scripts/perf/queries.json')
const baselinePath = path.join(root, 'docs/perf/baseline-samples.json')
const outMd = path.join(root, 'docs/perf/results-final.md')
const outJson = path.join(root, 'docs/perf/results-final.json')

const FIXED_IDS = [
  'vss-loai-nam-2025',
  'vss-loai-nam-tinh-79',
  'vss-nhom-n1-nam',
  'vss-complex-filter',
  'vss-deep-page-20',
  'vss-export-chunk-500',
]

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

function fmtInt(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return Number(n).toLocaleString('en-US')
}

function startWorker() {
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

function summarize(samples) {
  const ok = samples.filter((sample) => sample.ok)
  const walls = ok.map((sample) => sample.wallMs)
  const last = ok[ok.length - 1] || samples[samples.length - 1] || {}
  return {
    n: samples.length,
    ok: ok.length,
    p50: percentile(walls, 50),
    p95: percentile(walls, 95),
    rows: last.rows ?? null,
    total: last.total ?? null,
    bytes: last.bytes ?? null,
    trips: last.trips ?? null,
    firstId: last.firstId ?? null,
    needle: last.needle ?? null,
    error: ok.length ? null : (last.error || 'error'),
  }
}

async function runSqlite(suite) {
  let worker = startWorker()
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
    const timeoutMs = query.op === 'search' ? 120000 : (query.timeoutMs || 180000)
    const repeats = query.op === 'metrics-cold' ? 1 : (query.op === 'meta' ? 1 : 3)
    const warmup = query.op === 'search' ? 1 : 0
    process.stderr.write(`sqlite ${query.id}\n`)
    const samples = []
    for (let i = 0; i < warmup + repeats; i += 1) {
      const msg = await ask(query, timeoutMs)
      if (!msg.ok && (msg.error === 'timeout' || msg.error === 'worker-exit')) {
        worker.child.kill()
        worker = startWorker()
        if (i >= warmup) samples.push({ ok: false, error: msg.error || 'timeout', wallMs: timeoutMs })
        break
      }
      if (i >= warmup) {
        samples.push(msg.ok
          ? {
            ok: true,
            wallMs: msg.wallMs,
            bytes: msg.bytes,
            rows: msg.rows,
            trips: msg.trips,
            total: msg.total,
            firstId: msg.firstId,
            needle: msg.needle,
          }
          : { ok: false, error: msg.error || 'error' })
        if (!msg.ok) break
      }
    }
    const summary = summarize(samples)
    results.push({ id: query.id, endpoint: query.endpoint, op: query.op, ...summary })
    process.stderr.write(`  p50=${fmt(summary.p50)} rows=${summary.rows ?? '—'} total=${summary.total ?? '—'}\n`)
  }
  worker.child.stdin.end()
  return results
}

function baselineMap() {
  if (!fs.existsSync(baselinePath)) return {}
  const body = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
  return Object.fromEntries((body.sqlite || []).map((row) => [row.id, row]))
}

function render(suite, results, previous) {
  const byId = Object.fromEntries(results.map((row) => [row.id, row]))
  const lines = []
  lines.push('# Kết quả P7')
  lines.push('')
  lines.push(`Đo SQLite local lúc ${new Date().toISOString()}. Không ghi đè \`docs/perf/baseline.md\`. Không mở TiDB và không gửi lại 30 câu Turso.`)
  lines.push('')
  lines.push('## Cách đo')
  lines.push('')
  lines.push('- Bộ 30 câu: `scripts/perf/queries.json`.')
  lines.push('- Search: 1 lần warmup rồi 3 mẫu. Meta: 1 mẫu. Metric lạnh: 1 lần `slice_payload`, không ghi DB.')
  lines.push('- `needle` kiểm tra dòng đầu của trang có chứa từng từ của `q` sau `fold()`. Trang rỗng thì để trống.')
  lines.push('- Sáu câu VSS lọc `nam` ở baseline là `OperationalError`. Lần này dùng `json_extract(raw, \'$.congbo\')`.')
  lines.push('')
  lines.push('## SQLite')
  lines.push('')
  lines.push('| ID | p50 ms | p95 ms | Rows | Total | Needle | Baseline p50 |')
  lines.push('|---|---:|---:|---:|---:|---|---:|')
  for (const query of suite.queries) {
    const row = byId[query.id] || {}
    const old = previous[query.id]
    const oldP50 = old?.error ? 'ERROR' : fmt(old?.p50)
    const needle = row.needle == null ? '—' : (row.needle ? 'có' : 'không')
    const p50 = row.error ? 'ERROR' : fmt(row.p50)
    const p95 = row.error ? 'ERROR' : fmt(row.p95)
    lines.push(`| ${query.id} | ${p50} | ${p95} | ${row.rows ?? '—'} | ${fmtInt(row.total)} | ${needle} | ${oldP50} |`)
  }
  lines.push('')
  const search = results.filter((row) => row.op === 'search')
  const ok = search.filter((row) => row.ok > 0)
  const p50s = ok.map((row) => row.p50).filter((n) => Number.isFinite(n))
  const fixed = FIXED_IDS.map((id) => byId[id]).filter(Boolean)
  const fixedOk = fixed.filter((row) => row.ok > 0).length
  const needles = search.filter((row) => row.needle === false)
  lines.push('## Đối chiếu')
  lines.push('')
  lines.push(`- Search chạy được ${ok.length}/${search.length}. Trung vị p50 của cả 26 câu là ${fmt(percentile(p50s, 50))} ms, vì sáu câu VSS lọc năm (nhiều giây) nay nằm trong mẫu. Baseline 413 ms chỉ tính 20 câu chạy được lúc đó.`)
  lines.push(`- Sáu câu năm từng lỗi: ${fixedOk}/6 chạy được.`)
  const cillin = byId['vss-substring-cillin']
  const uroxim = byId['vss-substring-uroxim']
  lines.push(`- \`cillin\` total ${fmtInt(cillin?.total)}, needle trang 1 ${cillin?.needle ? 'có' : 'không'}. Baseline đã ghi 3,916.`)
  lines.push(`- \`uroxim\` total ${fmtInt(uroxim?.total)}, needle trang 1 ${uroxim?.needle ? 'có' : 'không'}. Baseline đã ghi 4,248.`)
  if (needles.length) lines.push(`- Trang 1 không chứa từ khóa: ${needles.map((row) => row.id).join(', ')}.`)
  lines.push('- Câu SQL cloud của cả 26 câu search vẫn là `LIKE \'%từ%\'` trên cột đã fold. Khóa đó nằm ở `tests/p7-parity.test.mjs`.')
  lines.push('')
  lines.push('## Chưa đo trên cluster')
  lines.push('')
  lines.push('- TiDB chưa có `TIDB_DATABASE_URL` hoặc `TIDB_HOST` + `TIDB_USER` + `TIDB_DATABASE`, nên chưa so số dòng với SQLite.')
  lines.push('- Turso ở baseline là `BLOCKED` (reads forbidden). Lần này không gửi lại 30 câu.')
  lines.push('- Supabase vẫn là backend mặc định của app. Bộ này không gọi PostgREST.')
  lines.push('')
  return lines.join('\n')
}

const suite = JSON.parse(fs.readFileSync(suitePath, 'utf8'))
if (suite.queries.length !== 30) throw new Error(`expected 30 queries, got ${suite.queries.length}`)
const results = await runSqlite(suite)
const previous = baselineMap()
fs.mkdirSync(path.dirname(outMd), { recursive: true })
fs.writeFileSync(outJson, JSON.stringify({ measuredAt: new Date().toISOString(), results }, null, 2))
fs.writeFileSync(outMd, render(suite, results, previous))
process.stderr.write(`wrote ${outMd}\n`)
const failed = results.filter((row) => row.op === 'search' && !(row.ok > 0))
if (failed.length) {
  process.stderr.write(`search errors: ${failed.map((row) => row.id).join(', ')}\n`)
  process.exitCode = 1
}
