/** Decision metrics panels for DAV / MSC / VSS — filter-reactive with light motion. */
import { useEffect, useMemo, useState } from 'react'
import { TAG_CAM, TAG_VANG, TAG_XAM, TAG_XANH } from './tagConfig'

const num = (v) => {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

export function fmtInt(n) {
  if (n == null || Number.isNaN(Number(n))) return '—'
  return Math.round(Number(n)).toLocaleString('vi-VN')
}

export function fmtMoney(n) {
  if (n == null || Number.isNaN(Number(n))) return '—'
  const v = Number(n)
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} Tỷ`
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} Tr`
  return v.toLocaleString('vi-VN')
}

export function fmtPct(n, digits = 1) {
  if (n == null || Number.isNaN(Number(n))) return '—'
  const v = Number(n)
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(digits)}%`
}

function monthsLeft(iso) {
  if (!iso) return null
  const t = Date.parse(String(iso).slice(0, 19))
  if (!Number.isFinite(t)) return null
  return (t - Date.now()) / (30.4375 * 24 * 3600 * 1000)
}

function buyerTier(buyer) {
  const s = String(buyer || '').toLowerCase()
  if (/bộ y tế|trung ương|tw\b|trung uong/.test(s)) return 'tw'
  if (/sở y tế|so y te|đấu thầu tập trung|dau thau tap trung/.test(s)) return 'so'
  return 'bv'
}

function parseMonthKey(raw) {
  if (!raw) return null
  const s = String(raw).trim()
  const m = s.match(/^(\d{4})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}`
  const t = Date.parse(s.replace(' ', 'T').slice(0, 19))
  if (!Number.isFinite(t)) return null
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function parseQuarterKey(raw) {
  const mk = parseMonthKey(raw)
  if (!mk) return null
  const [y, m] = mk.split('-').map(Number)
  const q = Math.ceil(m / 3)
  return `${y}-Q${q}`
}

function prevMonthKey(mk) {
  if (!mk) return null
  const [y, m] = mk.split('-').map(Number)
  if (m === 1) return `${y - 1}-12`
  return `${y}-${String(m - 1).padStart(2, '0')}`
}

function prevQuarterKey(qk) {
  if (!qk) return null
  const m = qk.match(/^(\d{4})-Q(\d)$/)
  if (!m) return null
  let y = Number(m[1])
  let q = Number(m[2]) - 1
  if (q < 1) { y -= 1; q = 4 }
  return `${y}-Q${q}`
}

function ingredientKey(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 80) || '—'
}

function groupBucket(g) {
  const s = String(g || '').toLowerCase()
  if (/nhóm\s*1|\bn1\b|group\s*1|^1$/.test(s)) return '1'
  if (/nhóm\s*2|\bn2\b|group\s*2|^2$/.test(s)) return '2'
  if (/nhóm\s*3|\bn3\b|group\s*3|^3$/.test(s)) return '3'
  if (/nhóm\s*4|\bn4\b|group\s*4|^4$/.test(s)) return '4'
  if (/nhóm\s*5|\bn5\b|group\s*5|^5$/.test(s)) return '5'
  return null
}

function useFlashKey(dep) {
  const [flash, setFlash] = useState(false)
  useEffect(() => {
    setFlash(true)
    const t = setTimeout(() => setFlash(false), 420)
    return () => clearTimeout(t)
  }, [dep])
  return flash
}

export function DonutChart({ slices, size = 100 }) {
  const total = slices.reduce((s, x) => s + (x.value || 0), 0) || 1
  const r = 36
  const c = 2 * Math.PI * r
  let offset = 0
  const sum = slices.reduce((a, s) => a + (s.value || 0), 0)
  return (
    <div className="donut-wrap">
      <svg width={size} height={size} viewBox="0 0 100 100" className="donut-svg" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--line)" strokeWidth="11" />
        {slices.map((sl) => {
          const len = ((sl.value || 0) / total) * c
          const el = (
            <circle
              key={sl.key}
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke={sl.color}
              strokeWidth="11"
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 50 50)"
              className="donut-seg"
            />
          )
          offset += len
          return el
        })}
        <text x="50" y="53" textAnchor="middle" className="donut-center">{fmtInt(sum)}</text>
      </svg>
      <ul className="donut-legend">
        {slices.map((sl) => (
          <li key={sl.key}>
            <span className="donut-swatch" style={{ background: sl.color }} />
            <span className="donut-label">{sl.label}</span>
            <span className="donut-n">{fmtInt(sl.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function MiniBars({ bars, horizontal = false }) {
  const max = Math.max(1, ...bars.map((b) => b.value || 0))
  if (horizontal) {
    return (
      <div className="h-bars" role="img">
        {bars.map((b) => (
          <div key={b.key} className="h-bar-row">
            <div className="h-bar-label" title={b.label}>{b.label}</div>
            <div className="h-bar-track">
              <div
                className="h-bar-fill"
                style={{ width: `${Math.round(((b.value || 0) / max) * 100)}%`, background: b.color || '#0d9488' }}
              />
            </div>
            <div className="h-bar-val">{b.display || fmtInt(b.value)}</div>
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="mini-bars" role="img">
      {bars.map((b) => (
        <div key={b.key} className="mini-bar-col">
          <div className="mini-bar-track">
            <div className="mini-bar-fill" style={{ height: `${Math.round(((b.value || 0) / max) * 100)}%`, background: b.color }} />
          </div>
          <div className="mini-bar-val">{b.display || fmtInt(b.value)}</div>
          <div className="mini-bar-label">{b.label}</div>
        </div>
      ))}
    </div>
  )
}

function StatCard({ kicker, value, sub, badge, tone }) {
  return (
    <div className={`stats-card insight${tone ? ` tone-${tone}` : ''}`}>
      <div className="stats-kicker">{kicker}</div>
      <div className="stats-value-row">
        <div className="stats-value">{value}</div>
        {badge && <span className={`insight-badge ${badge.tone || ''}`}>{badge.text}</span>}
      </div>
      {sub && <div className="stats-sub">{sub}</div>}
    </div>
  )
}

export function MetricsPanel({ title, stats, charts, flash }) {
  return (
    <aside className={`filters-stats insight-panel${flash ? ' metrics-flash' : ''}`} aria-label={title || 'Chỉ số quyết định'}>
      {title && <div className="insight-title">{title}</div>}
      {stats?.length > 0 && (
        <div className="insight-stats">
          {stats.map((s) => (
            <StatCard key={s.key} {...s} />
          ))}
        </div>
      )}
      <div className="insight-charts">
        {(charts || []).map((c) => (
          <div key={c.key} className="stats-card insight-chart">
            {c.title && <div className="stats-kicker">{c.title}</div>}
            {c.node}
          </div>
        ))}
      </div>
    </aside>
  )
}

/* ---- DAV ---- */
export function computeDavMetrics(items) {
  const rows = items || []
  let safe = 0
  let cycle3 = 0
  for (const r of rows) {
    const m = r.monthsLeft != null ? Number(r.monthsLeft) : monthsLeft(r.ngayHetHan)
    const ky = r.kyCapNam != null ? Number(r.kyCapNam) : null
    if (m != null && m > 18 && ky != null && ky >= 4.5 && ky <= 6) safe += 1
    if (ky != null && ky >= 2.5 && ky < 4) cycle3 += 1
  }
  const base = rows.length || 1
  const safePct = Math.round((safe / base) * 100)

  // Per hoạt chất: count distinct SĐK
  const byIng = new Map()
  const formsByIng = new Map()
  for (const r of rows) {
    const ik = ingredientKey(r.hoatChat)
    if (!byIng.has(ik)) byIng.set(ik, new Set())
    byIng.get(ik).add(String(r.soDangKy || r.id || Math.random()))
    if (!formsByIng.has(ik)) formsByIng.set(ik, new Set())
    const form = String(r.dangBaoChe || '').trim().toLowerCase()
    if (form) formsByIng.get(ik).add(form)
  }
  const sdkBuckets = { '1-2': 0, '3-4': 0, '5-10': 0, '10+': 0 }
  for (const set of byIng.values()) {
    const n = set.size
    if (n <= 2) sdkBuckets['1-2'] += 1
    else if (n <= 4) sdkBuckets['3-4'] += 1
    else if (n <= 10) sdkBuckets['5-10'] += 1
    else sdkBuckets['10+'] += 1
  }
  const formBuckets = { '1': 0, '2': 0, '3': 0, '4+': 0 }
  for (const set of formsByIng.values()) {
    const n = set.size || 1
    if (n <= 1) formBuckets['1'] += 1
    else if (n === 2) formBuckets['2'] += 1
    else if (n === 3) formBuckets['3'] += 1
    else formBuckets['4+'] += 1
  }

  const tags = { xanh: 0, vang: 0, cam: 0, xam: 0 }
  for (const r of rows) {
    if (r.tagId === TAG_XANH) tags.xanh += 1
    else if (r.tagId === TAG_VANG) tags.vang += 1
    else if (r.tagId === TAG_CAM) tags.cam += 1
    else if (r.tagId === TAG_XAM) tags.xam += 1
    else tags.vang += 1
  }

  return {
    stats: [
      {
        key: 'cycle',
        kicker: 'An toàn chu kỳ thầu 36 tháng',
        value: `${safePct}%`,
        badge: cycle3 > 0 ? { text: `${fmtInt(cycle3)} SĐK · 3 năm`, tone: 'warn' } : { text: 'Ổn định', tone: 'ok' },
        tone: safePct >= 50 ? 'ok' : 'warn',
        sub: 'Hạn >18 tháng & cấp ~5 năm · theo bộ lọc',
      },
    ],
    charts: [
      {
        key: 'sdk',
        title: 'Hoạt chất theo số SĐK',
        slices: [
          { key: '1-2', label: '1–2 SĐK', value: sdkBuckets['1-2'], color: '#0d9488' },
          { key: '3-4', label: '3–4 SĐK', value: sdkBuckets['3-4'], color: '#2563eb' },
          { key: '5-10', label: '5–10 SĐK', value: sdkBuckets['5-10'], color: '#d97706' },
          { key: '10+', label: '10+ SĐK', value: sdkBuckets['10+'], color: '#dc2626' },
        ],
      },
      {
        key: 'forms',
        title: 'Hoạt chất theo số dạng bào chế',
        slices: [
          { key: '1', label: '1 dạng', value: formBuckets['1'], color: '#0d9488' },
          { key: '2', label: '2 dạng', value: formBuckets['2'], color: '#2563eb' },
          { key: '3', label: '3 dạng', value: formBuckets['3'], color: '#d97706' },
          { key: '4+', label: '4+ dạng', value: formBuckets['4+'], color: '#7c3aed' },
        ],
      },
      {
        key: 'tags',
        title: 'Cơ cấu trạng thái',
        slices: [
          { key: 'xanh', label: 'Xanh', value: tags.xanh, color: '#22c55e' },
          { key: 'vang', label: 'Vàng', value: tags.vang, color: '#eab308' },
          { key: 'cam', label: 'Cam DM93', value: tags.cam, color: '#f97316' },
          { key: 'xam', label: 'Xám', value: tags.xam, color: '#64748b' },
        ],
      },
    ],
  }
}

export function DavMetrics({ items, total }) {
  const m = useMemo(() => computeDavMetrics(items), [items])
  const flash = useFlashKey(`${items?.length}|${total}|${m.stats[0]?.value}`)
  const sample = (items?.length || 0) < (total || 0)
    ? ` · mẫu ${fmtInt(items.length)}/${fmtInt(total)}`
    : ''
  return (
    <MetricsPanel
      title={`Chỉ số DAV${sample}`}
      flash={flash}
      stats={m.stats}
      charts={m.charts.map((c) => ({
        key: c.key,
        title: c.title,
        node: <DonutChart slices={c.slices} />,
      }))}
    />
  )
}

/* ---- MSC prices ---- */
export function computeMscPriceMetrics(items) {
  const rows = items || []
  let volume = 0
  let value = 0
  const byGroup = new Map()
  const byProv = new Map()
  const byQuarter = new Map()

  for (const r of rows) {
    const qty = num(r.quantity) ?? 0
    const price = num(r.unit_price ?? r.unitPrice) ?? 0
    const line = qty * price
    volume += qty
    value += line
    const g = groupBucket(r.group_name ?? r.groupName) || String(r.group_name || r.groupName || 'Khác').trim() || 'Khác'
    byGroup.set(g, (byGroup.get(g) || 0) + (line || qty || 1))
    const prov = String(r.province || '').trim() || '—'
    byProv.set(prov, (byProv.get(prov) || 0) + (line || qty || 1))
    const qk = parseQuarterKey(r.published || r.decision_date || r.collected_at)
    if (qk) byQuarter.set(qk, (byQuarter.get(qk) || 0) + (qty || 1))
  }

  const groupBars = [...byGroup.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, v], i) => ({
      key: k,
      label: /^[1-5]$/.test(k) ? `Nhóm ${k}` : (k.length > 14 ? `${k.slice(0, 12)}…` : k),
      value: v,
      display: fmtMoney(v),
      color: ['#0d9488', '#2563eb', '#d97706', '#7c3aed', '#dc2626'][i % 5],
    }))

  const provBars = [...byProv.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k, v]) => ({
      key: k,
      label: k.length > 16 ? `${k.slice(0, 14)}…` : k,
      value: v,
      display: fmtMoney(v),
      color: '#0f766e',
    }))

  const quarters = [...byQuarter.keys()].sort()
  const latestQ = quarters[quarters.length - 1]
  const prevQ = prevQuarterKey(latestQ)
  const curVol = latestQ ? (byQuarter.get(latestQ) || 0) : 0
  const prevVol = prevQ ? (byQuarter.get(prevQ) || 0) : 0
  let qoq = null
  if (prevVol > 0) qoq = ((curVol - prevVol) / prevVol) * 100
  else if (curVol > 0 && prevQ) qoq = 100

  return {
    stats: [
      {
        key: 'vol',
        kicker: 'Dung lượng tiêu thụ (KQLCNT)',
        value: fmtInt(volume),
        sub: `≈ ${fmtMoney(value)} · ${fmtInt(rows.length)} dòng lọc`,
      },
      {
        key: 'qoq',
        kicker: 'Tiêu thụ so quý trước (QoQ)',
        value: fmtPct(qoq),
        badge: qoq == null
          ? null
          : qoq >= 0
            ? { text: 'Tăng', tone: 'ok' }
            : { text: 'Giảm', tone: 'danger' },
        tone: qoq == null ? '' : qoq >= 0 ? 'ok' : 'danger',
        sub: latestQ && prevQ ? `${latestQ} vs ${prevQ} · theo SL` : 'Thiếu dữ liệu quý trước trong mẫu',
      },
    ],
    charts: [
      { key: 'groups', title: 'So sánh giá trị theo nhóm thuốc', bars: groupBars, horizontal: false },
      { key: 'prov', title: 'So sánh giá trị theo tỉnh', bars: provBars, horizontal: true },
    ],
  }
}

export function MscPriceMetrics({ items }) {
  const m = useMemo(() => computeMscPriceMetrics(items), [items])
  const flash = useFlashKey(`${items?.length}|${m.stats[0]?.value}|${m.stats[1]?.value}`)
  return (
    <MetricsPanel
      title="Định giá · thị trường"
      flash={flash}
      stats={m.stats}
      charts={m.charts.map((c) => ({
        key: c.key,
        title: c.title,
        node: <MiniBars bars={c.bars} horizontal={c.horizontal} />,
      }))}
    />
  )
}

/* ---- MSC tenders (keep) ---- */
export function computeMscTenderMetrics(items) {
  const rows = items || []
  const now = Date.now()
  const open = rows.filter((r) => {
    const st = String(r.status_label || r.status_code || '').toLowerCase()
    const close = r.close_date ? Date.parse(String(r.close_date).replace(' ', 'T')) : NaN
    if (/đóng|hủy|đã chọn|hết hạn/.test(st)) return false
    if (Number.isFinite(close)) return close >= now
    return /mở|đang|chưa đóng|tiếp nhận/.test(st)
  })
  let nearestDays = null
  for (const r of open) {
    const close = Date.parse(String(r.close_date || '').replace(' ', 'T'))
    if (!Number.isFinite(close)) continue
    const d = Math.ceil((close - now) / 86400000)
    if (d >= 0 && (nearestDays == null || d < nearestDays)) nearestDays = d
  }
  let pipeline = 0
  let under50 = 0
  const tiers = { tw: 0, so: 0, bv: 0 }
  for (const r of rows) {
    const bp = num(r.bid_price ?? r.bidPrice) ?? 0
    pipeline += bp
    if (bp > 0 && bp < 50_000_000) under50 += 1
    else if (bp === 0) under50 += 1
    tiers[buyerTier(r.buyer)] += 1
  }
  const safePct = rows.length ? Math.round((under50 / rows.length) * 100) : 0

  return {
    stats: [
      {
        key: 'open',
        kicker: 'Cơ hội thầu đang mở',
        value: `${fmtInt(open.length)} gói`,
        badge: nearestDays != null ? { text: `⏱ ${nearestDays} ngày`, tone: nearestDays <= 7 ? 'danger' : 'warn' } : null,
        sub: nearestDays != null ? 'Đến hạn đóng gần nhất' : 'Theo trạng thái / ngày đóng',
      },
      {
        key: 'pipe',
        kicker: 'Tổng ngân sách mời thầu',
        value: fmtMoney(pipeline),
        sub: `${fmtInt(rows.length)} gói trong kết quả lọc`,
      },
      {
        key: 'bond',
        kicker: 'An toàn bảo lãnh (< 50 Tr)',
        value: `${safePct}%`,
        badge: { text: `${fmtInt(under50)} gói`, tone: safePct >= 70 ? 'ok' : 'warn' },
        tone: safePct >= 70 ? 'ok' : 'warn',
        sub: 'Không cần bảo lãnh ngân hàng',
      },
    ],
    slices: [
      { key: 'tw', label: 'Tuyến TW / Bộ', value: tiers.tw, color: '#2563eb' },
      { key: 'so', label: 'Sở Y tế tập trung', value: tiers.so, color: '#0d9488' },
      { key: 'bv', label: 'BV tự mua sắm', value: tiers.bv, color: '#d97706' },
    ],
  }
}

export function MscTenderMetrics({ items }) {
  const m = useMemo(() => computeMscTenderMetrics(items), [items])
  const flash = useFlashKey(`${items?.length}|${m.stats[0]?.value}`)
  return (
    <MetricsPanel
      title="Săn thầu · dòng tiền"
      flash={flash}
      stats={m.stats}
      charts={[{ key: 'tier', title: 'Cấp mời thầu', node: <DonutChart slices={m.slices} /> }]}
    />
  )
}

/* ---- VSS ---- */
export function computeVssMetrics(items) {
  const rows = items || []
  const byMonth = new Map()
  const byProv = new Map()
  const byGroup = new Map()
  let totalPay = 0

  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - 12)
  const cutoffMs = cutoff.getTime()

  for (const r of rows) {
    const pay = num(r.thanhtien) ?? ((num(r.gia) || 0) * (num(r.soluong) || 0))
    totalPay += pay
    const dateRaw = r.tungay_hd || r.congbo || r.created_date || r.tungay
    const mk = parseMonthKey(dateRaw)
    if (mk) byMonth.set(mk, (byMonth.get(mk) || 0) + pay)
    const prov = String(r.ten_tinh || r.ma_tinh || '').trim() || '—'
    byProv.set(prov, (byProv.get(prov) || 0) + pay)

    const t = dateRaw ? Date.parse(String(dateRaw).replace(' ', 'T').slice(0, 19)) : NaN
    if (Number.isFinite(t) && t >= cutoffMs) {
      const g = groupBucket(r.nhomthau) || String(r.nhomthau || 'Khác').trim() || 'Khác'
      byGroup.set(g, (byGroup.get(g) || 0) + pay)
    }
  }

  const months = [...byMonth.keys()].sort()
  const latest = months[months.length - 1]
  const prev = prevMonthKey(latest)
  const cur = latest ? (byMonth.get(latest) || 0) : 0
  const prv = prev ? (byMonth.get(prev) || 0) : 0
  let mom = null
  if (prv > 0) mom = ((cur - prv) / prv) * 100
  else if (cur > 0 && prev) mom = 100

  const provBars = [...byProv.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k, v]) => ({
      key: k,
      label: k.length > 18 ? `${k.slice(0, 16)}…` : k,
      value: totalPay > 0 ? (v / totalPay) * 100 : 0,
      display: totalPay > 0 ? `${((v / totalPay) * 100).toFixed(1)}%` : '—',
      color: '#0f766e',
    }))

  const groupBars = ['1', '2', '3', '4', '5']
    .map((k, i) => ({
      key: k,
      label: `N${k}`,
      value: byGroup.get(k) || 0,
      display: fmtMoney(byGroup.get(k) || 0),
      color: ['#0d9488', '#2563eb', '#d97706', '#7c3aed', '#dc2626'][i],
    }))
    .filter((b) => b.value > 0)
  // include "Khác" if present
  const other = [...byGroup.entries()].filter(([k]) => !/^[1-5]$/.test(k))
  for (const [k, v] of other.slice(0, 2)) {
    groupBars.push({
      key: k,
      label: k.length > 8 ? `${k.slice(0, 6)}…` : k,
      value: v,
      display: fmtMoney(v),
      color: '#94a3b8',
    })
  }

  return {
    stats: [
      {
        key: 'mom',
        kicker: 'Tăng trưởng chi trả BHYT MoM',
        value: fmtPct(mom),
        badge: mom == null
          ? null
          : mom >= 0
            ? { text: 'MoM ↑', tone: 'ok' }
            : { text: 'MoM ↓', tone: 'danger' },
        tone: mom == null ? '' : mom >= 0 ? 'ok' : 'danger',
        sub: latest && prev
          ? `${latest} vs ${prev} · nhịp trần quỹ`
          : 'Thiếu tháng trước trong mẫu lọc',
      },
      {
        key: 'pay',
        kicker: 'Tổng chi trả (mẫu lọc)',
        value: fmtMoney(totalPay),
        sub: `${fmtInt(rows.length)} dòng · theo thành tiền`,
      },
    ],
    charts: [
      {
        key: 'prov',
        title: 'Tỷ trọng chi trả BHYT theo tỉnh',
        bars: provBars,
        horizontal: true,
      },
      {
        key: 'group',
        title: 'Hấp thụ tiền · nhóm kỹ thuật 12 tháng',
        bars: groupBars.length ? groupBars : [{ key: '0', label: '—', value: 0, display: '—', color: '#94a3b8' }],
        horizontal: false,
      },
    ],
  }
}

export function VssMetrics({ items }) {
  const m = useMemo(() => computeVssMetrics(items), [items])
  const flash = useFlashKey(`${items?.length}|${m.stats[0]?.value}|${m.stats[1]?.value}`)
  return (
    <MetricsPanel
      title="Thanh toán BHYT"
      flash={flash}
      stats={m.stats}
      charts={m.charts.map((c) => ({
        key: c.key,
        title: c.title,
        node: <MiniBars bars={c.bars} horizontal={c.horizontal} />,
      }))}
    />
  )
}
