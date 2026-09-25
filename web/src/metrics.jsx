/** Compound metric cards — 4 per section, dbl-click pills → table filters. No long tips. */
import { useEffect, useMemo, useState } from 'react'
import { TAG_CAM, TAG_VANG, TAG_XAM, TAG_XANH } from './tagConfig'

const MONTH_MS = 30.4375 * 24 * 3600 * 1000
const DAY_MS = 86400000

const num = (v) => {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  let s = String(v).trim().replace(/\s/g, '')
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.')
  else s = s.replace(/[^\d.-]/g, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const pad2 = (n) => String(n).padStart(2, '0')

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

function parseDateMs(raw) {
  if (!raw) return null
  const s = String(raw).trim()
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) {
    const t = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime()
    return Number.isFinite(t) ? t : null
  }
  const t = Date.parse(s.replace(' ', 'T').slice(0, 19))
  return Number.isFinite(t) ? t : null
}

function monthsLeft(iso) {
  const t = parseDateMs(iso)
  if (t == null) return null
  return (t - Date.now()) / MONTH_MS
}

function buyerTier(buyer) {
  const s = String(buyer || '').toLowerCase()
  if (/bộ y tế|trung ương|tw\b|trung uong/.test(s)) return 'tw'
  if (/sở y tế|so y te|đấu thầu tập trung|dau thau tap trung/.test(s)) return 'so'
  return 'bv'
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

function sampleNote(items, total) {
  const n = items?.length || 0
  const t = Number(total)
  if (Number.isFinite(t) && t > n) return `mẫu ${fmtInt(n)}/${fmtInt(t)}`
  return null
}

/* ------------------------------------------------------------------ */
/* Compound card                                                        */
/* ------------------------------------------------------------------ */
export function CompoundMetricCard({
  title,
  mainValue,
  unit,
  subtitle,
  titleTip,
  subMetrics = [],
  segments = null,
  progressPercent = null,
  progressColor = '#2563eb',
  activeId = null,
  onFilter,
}) {
  return (
    <div className="compound-card" title={titleTip || undefined}>
      <div className="compound-head">
        <span className="compound-title">{title}</span>
        {subtitle && <span className="compound-sub">{subtitle}</span>}
      </div>
      <div className="compound-kpi">
        <span className="compound-value">{mainValue}</span>
        {unit && <span className="compound-unit">{unit}</span>}
      </div>
      {subMetrics.length > 0 && (
        <div className="compound-pills">
          {subMetrics.map((item) => {
            const on = activeId === item.id
            // item.info = read-only pill (no table filter), item.title = hover explanation
            return (
              <button
                key={item.id}
                type="button"
                className={`compound-pill tone-${item.tone || 'neutral'}${on ? ' on' : ''}${item.info ? ' info' : ''}`}
                title={item.title || (item.info ? undefined : 'Nhấp đúp để lọc bảng bên dưới')}
                onDoubleClick={item.info ? undefined : (e) => {
                  e.preventDefault()
                  onFilter?.(item.patch || { _quick: item.id }, item.id)
                }}
              >
                <span className="compound-pill-label">{item.label}</span>
                <span className="compound-pill-count">{item.count}</span>
              </button>
            )
          })}
        </div>
      )}
      {Array.isArray(segments) && segments.length > 0 ? (
        <div className="compound-bar segmented" aria-hidden>
          {segments.map((s) => (
            <span
              key={s.key}
              className="compound-seg"
              style={{ width: `${Math.max(0, Math.min(100, s.pct || 0))}%`, background: s.color }}
              title={s.label}
            />
          ))}
        </div>
      ) : progressPercent != null && progressPercent > 0 ? (
        <div className="compound-bar" aria-hidden>
          <span style={{ width: `${Math.min(100, progressPercent)}%`, background: progressColor }} />
        </div>
      ) : null}
    </div>
  )
}

export function CompoundMetricsGrid({ title, cards, flash, activeId, onFilter }) {
  return (
    <aside className={`filters-stats compound-panel${flash ? ' metrics-flash' : ''}`} aria-label={title || 'Chỉ số'}>
      {title && <div className="insight-title">{title}</div>}
      <div className="compound-grid">
        {cards.map((c) => (
          <CompoundMetricCard key={c.key} {...c} activeId={activeId} onFilter={onFilter} />
        ))}
      </div>
    </aside>
  )
}

/* ---- DAV ---- */
export function computeDavCompound(items, total) {
  const all = items || []
  const cutoff = Date.now() - 365 * DAY_MS
  let rows = all.filter((r) => {
    const t = parseDateMs(r.ngayCap)
    return t == null || t >= cutoff
  })
  if (rows.length < Math.min(20, all.length)) rows = all

  const byIng = new Map()
  for (const r of rows) {
    const ik = ingredientKey(r.hoatChat)
    if (!byIng.has(ik)) byIng.set(ik, new Set())
    byIng.get(ik).add(String(r.soDangKy || r.id || Math.random()))
  }
  let blue = 0
  let mid = 0
  let red = 0
  for (const set of byIng.values()) {
    const n = set.size
    if (n <= 2) blue += 1
    else if (n <= 5) mid += 1
    else red += 1
  }
  const cells = blue + mid + red || 1

  const tags = { xanh: 0, vang: 0, cam: 0, xam: 0 }
  for (const r of rows) {
    if (r.tagId === TAG_XANH) tags.xanh += 1
    else if (r.tagId === TAG_VANG) tags.vang += 1
    else if (r.tagId === TAG_CAM) tags.cam += 1
    else if (r.tagId === TAG_XAM) tags.xam += 1
    else tags.vang += 1
  }
  const tagN = rows.length || 1

  let safeLong = 0
  let riskShort = 0
  let live = 0
  for (const r of rows) {
    const m = r.monthsLeft != null ? Number(r.monthsLeft) : monthsLeft(r.ngayHetHan)
    if (m != null && m > 0) live += 1
    if (m != null && m > 24) safeLong += 1
    if (m != null && m >= 0 && m < 12) riskShort += 1
  }

  const note = sampleNote(all, total)

  return [
    {
      key: 'density',
      title: 'Ô kỹ thuật · mật độ SĐK',
      mainValue: fmtInt(blue),
      unit: 'ô xanh',
      subtitle: note,
      titleTip: '12 tháng gần nhất theo ngày cấp (nếu có)',
      subMetrics: [
        { id: 'sdk_1_2', label: '1–2 SĐK', count: fmtInt(blue), tone: 'ok', patch: { ingredientCount: '1' } },
        { id: 'sdk_3_5', label: '3–5 SĐK', count: fmtInt(mid), tone: 'warn', patch: { ingredientCount: '3' } },
        { id: 'sdk_red', label: '>5 SĐK', count: fmtInt(red), tone: 'danger', patch: { ingredientCount: '5' } },
      ],
      segments: [
        { key: 'b', pct: (blue / cells) * 100, color: '#22c55e', label: 'Xanh' },
        { key: 'm', pct: (mid / cells) * 100, color: '#eab308', label: 'Cân nhắc' },
        { key: 'r', pct: (red / cells) * 100, color: '#ef4444', label: 'Đỏ' },
      ],
    },
    {
      key: 'tags',
      title: 'Tag hồ sơ',
      mainValue: fmtInt(tags.xanh),
      unit: 'SĐK xanh',
      subtitle: note,
      subMetrics: [
        { id: 'tag_xanh', label: 'Xanh', count: fmtInt(tags.xanh), tone: 'ok', patch: { _tag: TAG_XANH } },
        { id: 'tag_vang', label: 'Vàng', count: fmtInt(tags.vang), tone: 'warn', patch: { _tag: TAG_VANG } },
        { id: 'tag_xam', label: 'Xám', count: fmtInt(tags.xam), tone: 'neutral', patch: { _tag: TAG_XAM } },
      ],
      segments: [
        { key: 'x', pct: (tags.xanh / tagN) * 100, color: '#22c55e' },
        { key: 'v', pct: (tags.vang / tagN) * 100, color: '#eab308' },
        { key: 'c', pct: (tags.cam / tagN) * 100, color: '#f97316' },
        { key: 'g', pct: (tags.xam / tagN) * 100, color: '#94a3b8' },
      ],
    },
    {
      key: 'dm93',
      title: 'Rào cản DM93',
      mainValue: fmtInt(tags.cam),
      unit: 'SĐK cam',
      subtitle: note,
      subMetrics: [
        { id: 'tag_cam', label: 'Tag Cam', count: fmtInt(tags.cam), tone: 'danger', patch: { _tag: TAG_CAM } },
        { id: 'tag_xanh2', label: 'Sẵn sàng thầu', count: fmtInt(tags.xanh), tone: 'ok', patch: { _tag: TAG_XANH } },
      ],
      progressPercent: tagN ? (tags.cam / tagN) * 100 : 0,
      progressColor: '#f97316',
    },
    {
      key: 'life',
      title: 'Chu kỳ thầu 36 tháng',
      mainValue: fmtInt(live),
      unit: 'còn HL',
      subtitle: note,
      subMetrics: [
        { id: 'safe_24', label: '>24 th', count: fmtInt(safeLong), tone: 'ok', patch: { _quick: 'safe_24' } },
        { id: 'risk_12', label: '<12 th', count: fmtInt(riskShort), tone: 'warn', patch: { _quick: 'risk_12' } },
      ],
      progressPercent: live ? (safeLong / live) * 100 : 0,
      progressColor: '#0d9488',
    },
  ]
}

export function DavMetrics({ items, total, activeId, onFilter }) {
  const cards = useMemo(() => computeDavCompound(items, total), [items, total])
  const flash = useFlashKey(`${items?.length}|${total}|${cards[0]?.mainValue}`)
  const note = sampleNote(items, total)
  return (
    <CompoundMetricsGrid
      title={`DAV${note ? ` · ${note}` : ''}`}
      flash={flash}
      cards={cards}
      activeId={activeId}
      onFilter={onFilter}
    />
  )
}

/* ---- MSC tenders ---- */
export function computeMscTenderCompound(items, total) {
  const rows = items || []
  const now = Date.now()
  let closing7 = 0
  let new72 = 0
  let openLater = 0
  let openVal = 0
  let big50t = 0
  let small10t = 0
  let under50m = 0
  let over50m = 0
  const tiers = { so: 0, tw: 0, bv: 0 }
  let buyers = new Set()

  for (const r of rows) {
    const close = parseDateMs(r.close_date)
    const pub = parseDateMs(r.published)
    const st = String(r.status_label || r.status_code || '').toLowerCase()
    const closed = /đóng|hủy|đã chọn|hết hạn/.test(st)
    const bp = num(r.bid_price ?? r.bidPrice) ?? 0
    const tier = buyerTier(r.buyer)
    tiers[tier] += 1
    if (r.buyer) buyers.add(String(r.buyer).trim())

    let isOpen = !closed
    if (Number.isFinite(close)) isOpen = close >= now && !closed

    if (isOpen) {
      openVal += bp
      if (close != null) {
        const d = (close - now) / DAY_MS
        if (d >= 0 && d < 7) closing7 += 1
        else if (d >= 7) openLater += 1
      } else openLater += 1
      if (bp >= 50e9) big50t += 1
      if (bp > 0 && bp < 10e9) small10t += 1
    }
    if (pub != null && now - pub < 72 * 3600 * 1000 && isOpen) new72 += 1

    if (bp > 0 && bp < 50e6) under50m += 1
    else if (bp >= 50e6) over50m += 1
    else under50m += 1
  }

  const n = rows.length || 1
  const openN = closing7 + new72 + openLater || 1
  const bondN = under50m + over50m || 1
  const freePct = Math.round((under50m / n) * 100)
  const note = sampleNote(items, total)
  const urgentPct = (closing7 / openN) * 100

  return [
    {
      key: 'pipeline',
      title: 'Nhịp thầu & cơ hội mở',
      mainValue: fmtInt(Number.isFinite(total) ? total : rows.length),
      unit: 'gói',
      subtitle: note,
      subMetrics: [
        { id: 'closing_7d', label: 'Sắp đóng <7d', count: fmtInt(closing7), tone: 'danger', patch: { _quick: 'closing_7d' } },
        { id: 'new_72h', label: 'Mới mở <72h', count: fmtInt(new72), tone: 'ok', patch: { _quick: 'new_72h' } },
        { id: 'open_later', label: 'Đang mở >7d', count: fmtInt(openLater), tone: 'neutral', patch: { _quick: 'open_later' } },
      ],
      progressPercent: urgentPct,
      progressColor: '#f59e0b',
    },
    {
      key: 'budget',
      title: 'Ngân sách mời thầu (đang mở)',
      mainValue: fmtMoney(openVal),
      unit: 'đ',
      subtitle: note,
      subMetrics: [
        { id: 'big_50t', label: 'Gói >50 Tỷ', count: fmtInt(big50t), tone: 'warn', patch: { _quick: 'big_50t' } },
        { id: 'small_10t', label: 'Gói <10 Tỷ', count: fmtInt(small10t), tone: 'ok', patch: { _quick: 'small_10t' } },
      ],
      progressPercent: openVal > 0 ? Math.min(100, (big50t / (big50t + small10t || 1)) * 100) : 0,
      progressColor: '#7c3aed',
    },
    {
      key: 'bond',
      title: 'Miễn bảo lãnh NH',
      mainValue: `${freePct}%`,
      unit: 'gói ≤50 Tr',
      subtitle: note,
      subMetrics: [
        { id: 'under_50m', label: '≤50 Tr', count: fmtInt(under50m), tone: 'ok', patch: { _quick: 'under_50m' } },
        { id: 'over_50m', label: '>50 Tr', count: fmtInt(over50m), tone: 'warn', patch: { _quick: 'over_50m' } },
      ],
      segments: [
        { key: 'u', pct: (under50m / bondN) * 100, color: '#22c55e' },
        { key: 'o', pct: (over50m / bondN) * 100, color: '#f59e0b' },
      ],
    },
    {
      key: 'tier',
      title: 'Cấp mời thầu',
      mainValue: fmtInt(buyers.size),
      unit: 'CĐT',
      subtitle: note,
      subMetrics: [
        { id: 'tier_so', label: 'Sở Y tế', count: fmtInt(tiers.so), tone: 'ok', patch: { _quick: 'tier_so' } },
        { id: 'tier_tw', label: 'TW / Bộ', count: fmtInt(tiers.tw), tone: 'warn', patch: { _quick: 'tier_tw' } },
        { id: 'tier_bv', label: 'BV tự mua', count: fmtInt(tiers.bv), tone: 'neutral', patch: { _quick: 'tier_bv' } },
      ],
      segments: [
        { key: 'so', pct: (tiers.so / n) * 100, color: '#0d9488' },
        { key: 'tw', pct: (tiers.tw / n) * 100, color: '#2563eb' },
        { key: 'bv', pct: (tiers.bv / n) * 100, color: '#d97706' },
      ],
    },
  ]
}

export function MscTenderMetrics({ items, total, activeId, onFilter }) {
  const cards = useMemo(() => computeMscTenderCompound(items, total), [items, total])
  const flash = useFlashKey(`${items?.length}|${cards[0]?.mainValue}`)
  return (
    <CompoundMetricsGrid
      title={`Gói thầu${sampleNote(items, total) ? ` · ${sampleNote(items, total)}` : ''}`}
      flash={flash}
      cards={cards}
      activeId={activeId}
      onFilter={onFilter}
    />
  )
}

/* ---- MSC prices ---- */
export function computeMscPriceCompound(items, total) {
  const rows = items || []
  // Discount proxy: vs max price of same ingredient in sample
  const byIngPrices = new Map()
  for (const r of rows) {
    const ik = ingredientKey(r.ingredient || r.name)
    const p = num(r.unit_price ?? r.unitPrice)
    if (p == null || p <= 0) continue
    if (!byIngPrices.has(ik)) byIngPrices.set(ik, [])
    byIngPrices.get(ik).push(p)
  }
  let dLow = 0
  let dMid = 0
  let dHigh = 0
  let dSum = 0
  let dN = 0
  for (const r of rows) {
    const ik = ingredientKey(r.ingredient || r.name)
    const p = num(r.unit_price ?? r.unitPrice)
    const list = byIngPrices.get(ik)
    if (p == null || !list || list.length < 2) continue
    const mx = Math.max(...list)
    if (mx <= 0) continue
    const disc = ((mx - p) / mx) * 100
    dSum += disc
    dN += 1
    if (disc < 5) dLow += 1
    else if (disc <= 15) dMid += 1
    else dHigh += 1
  }
  const avgDisc = dN ? dSum / dN : 0

  const g2 = []
  const g4 = []
  const byWinner = new Map()
  let value = 0
  const byIngMinMax = new Map()

  for (const r of rows) {
    const qty = num(r.quantity) ?? 0
    const price = num(r.unit_price ?? r.unitPrice) ?? 0
    const line = qty * price
    value += line
    const g = groupBucket(r.group_name)
    if (g === '2' && price > 0) g2.push(price)
    if (g === '4' && price > 0) g4.push(price)
    const w = String(r.winner || '').trim() || '—'
    byWinner.set(w, (byWinner.get(w) || 0) + line)
    const ik = ingredientKey(r.ingredient || r.name)
    if (price > 0) {
      const cur = byIngMinMax.get(ik) || { min: price, max: price }
      cur.min = Math.min(cur.min, price)
      cur.max = Math.max(cur.max, price)
      byIngMinMax.set(ik, cur)
    }
  }

  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null)
  const avg2 = avg(g2)
  const avg4 = avg(g4)
  const margin = avg4 > 0 && avg2 != null ? ((avg2 - avg4) / avg4) * 100 : null

  const sortedW = [...byWinner.entries()].sort((a, b) => b[1] - a[1])
  const top3 = sortedW.slice(0, 3).reduce((s, [, v]) => s + v, 0)
  const top1Share = value > 0 && sortedW[0] ? (sortedW[0][1] / value) * 100 : 0
  const top3Share = value > 0 ? (top3 / value) * 100 : 0
  const fragShare = Math.max(0, 100 - top3Share)

  let spreadSum = 0
  let spreadN = 0
  let minSeen = null
  let maxSeen = null
  for (const { min, max } of byIngMinMax.values()) {
    if (max > min) {
      spreadSum += (max - min) / ((min + max) / 2)
      spreadN += 1
    }
    if (minSeen == null || min < minSeen) minSeen = min
    if (maxSeen == null || max > maxSeen) maxSeen = max
  }
  const avgSpreadPct = spreadN ? (spreadSum / spreadN) * 100 : null
  const note = sampleNote(items, total)
  const discN = dLow + dMid + dHigh || 1

  return [
    {
      key: 'discount',
      title: 'Giảm giá vs đỉnh HC (mẫu)',
      mainValue: dN ? `${avgDisc.toFixed(1)}%` : '—',
      unit: 'TB',
      subtitle: note,
      titleTip: 'Không có giá kế hoạch — đo so với giá cao nhất cùng hoạt chất trong mẫu',
      subMetrics: [
        { id: 'disc_low', label: 'Giữ giá <5%', count: fmtInt(dLow), tone: 'ok', patch: { _quick: 'disc_low' } },
        { id: 'disc_mid', label: '5–15%', count: fmtInt(dMid), tone: 'warn', patch: { _quick: 'disc_mid' } },
        { id: 'disc_high', label: 'Phá giá >15%', count: fmtInt(dHigh), tone: 'danger', patch: { _quick: 'disc_high' } },
      ],
      segments: [
        { key: 'l', pct: (dLow / discN) * 100, color: '#22c55e' },
        { key: 'm', pct: (dMid / discN) * 100, color: '#eab308' },
        { key: 'h', pct: (dHigh / discN) * 100, color: '#ef4444' },
      ],
    },
    {
      key: 'g24',
      title: 'Biên giá N2 vs N4',
      mainValue: margin == null ? '—' : fmtPct(margin),
      unit: 'TB',
      subtitle: note,
      subMetrics: [
        { id: 'g2', label: 'Giá TB N2', count: avg2 != null ? fmtInt(avg2) : '—', tone: 'ok', patch: { group_name: '2' } },
        { id: 'g4', label: 'Giá TB N4', count: avg4 != null ? fmtInt(avg4) : '—', tone: 'neutral', patch: { group_name: '4' } },
      ],
      progressPercent: margin != null ? Math.min(100, Math.abs(margin) / 2) : 0,
      progressColor: '#2563eb',
    },
    {
      key: 'share',
      title: 'Thị phần Top 3 nhà thầu',
      mainValue: `${top3Share.toFixed(0)}%`,
      unit: 'GT',
      subtitle: note,
      subMetrics: [
        { id: 'top1', label: 'Top 1', count: `${top1Share.toFixed(0)}%`, tone: 'warn', patch: { winner: sortedW[0]?.[0] || '' } },
        { id: 'frag', label: 'Phân mảnh', count: `${fragShare.toFixed(0)}%`, tone: 'ok', patch: { _quick: 'frag_winners' } },
      ],
      progressPercent: top3Share,
      progressColor: '#7c3aed',
    },
    {
      key: 'spread',
      title: 'Biên đơn giá (min–max HC)',
      mainValue: avgSpreadPct == null ? '—' : `${avgSpreadPct.toFixed(0)}%`,
      unit: 'TB',
      subtitle: note,
      subMetrics: [
        { id: 'pmin', label: 'Sàn', count: minSeen != null ? fmtInt(minSeen) : '—', tone: 'ok', patch: { _quick: 'price_floor' } },
        { id: 'pmax', label: 'Trần', count: maxSeen != null ? fmtInt(maxSeen) : '—', tone: 'warn', patch: { _quick: 'price_ceil' } },
      ],
      progressPercent: avgSpreadPct != null ? Math.min(100, avgSpreadPct) : 0,
      progressColor: '#0d9488',
    },
  ]
}

export function MscPriceMetrics({ items, total, activeId, onFilter }) {
  const cards = useMemo(() => computeMscPriceCompound(items, total), [items, total])
  const flash = useFlashKey(`${items?.length}|${cards[0]?.mainValue}`)
  return (
    <CompoundMetricsGrid
      title={`Đơn giá${sampleNote(items, total) ? ` · ${sampleNote(items, total)}` : ''}`}
      flash={flash}
      cards={cards}
      activeId={activeId}
      onFilter={onFilter}
    />
  )
}

/* ---- VSS ----------------------------------------------------------------
 * Row = one winning-bid contract line (KQLCNT BHYT).
 *   value      = thanhtien (fallback gia × soluong)          → contracted tender value
 *   start/end  = tungay_hd/denngay_hd (fallback tungay/denngay) → contract window
 *   month key  = contract start (→ congbo when no start)     → "tháng gọi hàng"
 *   actual     = optional spend fields if a source ever provides them (VSS_ACTUAL_KEYS)
 * Server/static paths sort newest-first, so in a partial sample every month newer
 * than the oldest sampled month is complete; the oldest month is truncated.
 * ------------------------------------------------------------------------ */
const VSS_ACTUAL_KEYS = ['thanhtien_thuc', 'thanhtien_thuchien', 'chi_thuc_te', 'da_thanh_toan', 'giatri_thuc_hien', 'thuc_hien']

export function vssLineValue(r) {
  const v = num(r.thanhtien)
  if (v != null) return v
  return (num(r.gia) || 0) * (num(r.soluong) || 0)
}
function vssActualSpend(r) {
  for (const k of VSS_ACTUAL_KEYS) {
    const v = num(r[k])
    if (v != null) return v
  }
  return null
}
const vssStartRaw = (r) => r.tungay_hd || r.tungay || null
const vssEndRaw = (r) => r.denngay_hd || r.denngay || null
const vssMonthRaw = (r) => r.tungay_hd || r.tungay || r.congbo || null

/** Spoken money for badges: 1,2 tỷ · 120 triệu (absolute; caller adds sign). */
export function fmtMoneyWord(n) {
  if (n == null || Number.isNaN(Number(n))) return '—'
  const v = Math.abs(Number(n))
  if (v >= 1e9) return `${(v / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} tỷ`
  if (v >= 1e6) return `${(v / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: v >= 1e8 ? 0 : 1 })} triệu`
  if (v >= 1e3) return `${(v / 1e3).toLocaleString('vi-VN', { maximumFractionDigits: 0 })} nghìn`
  return v.toLocaleString('vi-VN')
}

/** Full VND: 850.000.000 đ (tỷ when very large). */
export function fmtVnd(n) {
  if (n == null || Number.isNaN(Number(n))) return '—'
  const v = Number(n)
  if (Math.abs(v) >= 1e11) return `${(v / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tỷ đ`
  return `${Math.round(v).toLocaleString('vi-VN')} đ`
}

function parseMonthKey(raw) {
  if (!raw) return null
  const s = String(raw).trim()
  const m = s.match(/^(\d{4})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}`
  const t = parseDateMs(s)
  if (t == null) return null
  const d = new Date(t)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}
function shiftMonthKey(mk, delta) {
  if (!mk) return null
  const [y, m] = mk.split('-').map(Number)
  const idx = y * 12 + (m - 1) + delta
  return `${Math.floor(idx / 12)}-${pad2((idx % 12) + 1)}`
}
function currentMonthKey() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}
/** "2026-09" → "T9/2026" (short: "T9") */
function fmtMonthKey(mk, short = false) {
  if (!mk) return '—'
  const [y, m] = mk.split('-').map(Number)
  return short ? `T${m}` : `T${m}/${y}`
}

/** Monthly Σ value keyed "YYYY-MM" (months after the current one — future-start HĐ — are ignored). */
export function vssMonthlySeries(rows) {
  const nowMk = currentMonthKey()
  const byMonth = new Map()
  for (const r of rows) {
    const mk = parseMonthKey(vssMonthRaw(r))
    if (!mk || mk > nowMk) continue
    byMonth.set(mk, (byMonth.get(mk) || 0) + vssLineValue(r))
  }
  const keys = [...byMonth.keys()].sort()
  return { byMonth, keys, latest: keys[keys.length - 1] || null, minMonth: keys[0] || null }
}

/**
 * Latest-month value + ABSOLUTE delta vs previous month (never a fake +100%).
 * Missing previous month → "Tháng đầu gọi hàng" (complete sample) or "Thiếu T trước (mẫu)" (partial).
 */
export function computeRunRate(series, { partial = false } = {}) {
  const { byMonth, latest, minMonth } = series
  if (!latest) return { latest: null, cur: 0, delta: null, text: 'Không có ngày HĐ', tone: 'warn' }
  const cur = byMonth.get(latest) || 0
  const curTruncated = partial && latest === minMonth
  const prevKey = shiftMonthKey(latest, -1)
  let prev = null
  if (partial) {
    if (prevKey > minMonth) prev = byMonth.get(prevKey) || 0 // strictly newer than oldest sampled month → complete
  } else if (byMonth.has(prevKey)) {
    prev = byMonth.get(prevKey) || 0
  } else if (minMonth < prevKey) {
    prev = 0 // complete sample with older months → previous month truly had no HĐ
  }
  if (prev == null) {
    return {
      latest, cur, curTruncated, prevKey, prev: null, delta: null,
      text: partial ? 'Thiếu T trước (mẫu)' : 'Tháng đầu gọi hàng',
      tone: partial ? 'warn' : 'ok',
    }
  }
  const delta = cur - prev
  const rel = prev > 0 ? delta / prev : null
  let state = 'Ổn định'
  let tone = 'ok'
  if (rel == null) state = delta > 0 ? 'Khởi phát' : 'Ổn định'
  else if (Math.abs(rel) > 0.10) {
    if (delta > 0) state = 'Tăng'
    else { state = 'Giảm'; tone = 'danger' }
  }
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±'
  return { latest, cur, curTruncated, prevKey, prev, delta, rel, state, tone, text: `${sign}${fmtMoneyWord(delta)} (${state})` }
}

/** R3M: Σ(M, M-1, M-2) vs Σ(M-3, M-4, M-5). Requires the sample to reach M-5. */
export function computeR3M(series, { partial = false } = {}) {
  const { byMonth, latest, minMonth } = series
  if (!latest) return { pct: null, reason: '—' }
  const curKeys = [0, -1, -2].map((d) => shiftMonthKey(latest, d))
  const prevKeys = [-3, -4, -5].map((d) => shiftMonthKey(latest, d))
  const oldest = prevKeys[2]
  const covered = partial ? minMonth < oldest : minMonth <= oldest
  const sum = (ks) => ks.reduce((s, k) => s + (byMonth.get(k) || 0), 0)
  const cur3 = sum(curKeys)
  const prev3 = sum(prevKeys)
  if (!covered) return { pct: null, cur3, prev3, reason: partial ? 'Mẫu chưa phủ 6 th' : 'Chưa đủ 6 tháng' }
  if (!(prev3 > 0)) return { pct: null, cur3, prev3, reason: 'Kỳ trước = 0' }
  return { pct: ((cur3 - prev3) / prev3) * 100, cur3, prev3, window: `${fmtMonthKey(curKeys[2], true)}–${fmtMonthKey(latest, true)}` }
}

/**
 * Absorption of currently-active contracts (start ≤ now ≤ end):
 *   contracted = Σ thanhtien · timePct = value-weighted elapsed share of the HĐ window
 *   absPct     = Σ actual spend / contracted when a spend field exists; else = timePct (proxy)
 * Flag only with real spend: time ≫ absorption → "Chậm hấp thụ".
 */
export function computeAbsorption(rows, now = Date.now()) {
  let n = 0
  let contracted = 0
  let actual = 0
  let hasActual = false
  let wElapsed = 0
  let wLen = 0
  let wLeft = 0
  for (const r of rows) {
    const start = parseDateMs(vssStartRaw(r))
    const end = parseDateMs(vssEndRaw(r))
    if (start == null || end == null || end <= start) continue
    if (start > now || end < now) continue
    const v = vssLineValue(r)
    if (!(v > 0)) continue
    const frac = Math.min(1, Math.max(0, (now - start) / (end - start)))
    n += 1
    contracted += v
    wElapsed += v * frac
    wLen += (v * (end - start)) / MONTH_MS
    wLeft += (v * (end - now)) / MONTH_MS
    const a = vssActualSpend(r)
    if (a != null) { actual += a; hasActual = true }
  }
  if (!n || !(contracted > 0)) return { n: 0, contracted: 0, absPct: null, timePct: null, proxy: true }
  const timePct = (wElapsed / contracted) * 100
  const absPct = hasActual ? (actual / contracted) * 100 : timePct
  let flag = null
  if (hasActual) {
    if (timePct - absPct >= 20) flag = { text: 'Chậm hấp thụ', tone: 'danger' }
    else if (absPct - timePct >= 15) flag = { text: 'Hấp thụ nhanh', tone: 'ok' }
    else flag = { text: 'Đúng nhịp', tone: 'ok' }
  }
  return {
    n, contracted, actual: hasActual ? actual : null, proxy: !hasActual,
    absPct, timePct, lenMonths: wLen / contracted, leftMonths: Math.max(0, wLeft / contracted), flag,
  }
}

/** Primary VSS decision card: latest-month value + delta / absorption / R3M pills. */
function vssRunRateCard(rows, total, note) {
  const partial = Number(total) > rows.length
  const series = vssMonthlySeries(rows)
  const run = computeRunRate(series, { partial })
  const r3m = computeR3M(series, { partial })
  const abs = computeAbsorption(rows)

  let absPill
  if (!abs.n) {
    absPill = { count: '— không HĐ hiệu lực', tone: 'neutral', title: 'Không có hợp đồng còn hiệu lực trong mẫu' }
  } else if (abs.proxy) {
    absPill = {
      count: `${Math.round(abs.timePct)}% / ${Math.max(1, Math.round(abs.lenMonths))} th`,
      tone: abs.timePct >= 75 ? 'warn' : 'neutral',
      title: `Tiến độ thời gian HĐ đang hiệu lực (trọng số giá trị) · còn ~${Math.round(abs.leftMonths)} tháng · ${fmtMoney(abs.contracted)} · ${fmtInt(abs.n)} dòng. Chưa có số chi thực tế → chưa so được hấp thụ vs thời gian.`,
    }
  } else {
    absPill = {
      count: `${Math.round(abs.absPct)}% / ${Math.max(1, Math.round(abs.lenMonths))} th · ${abs.flag.text}`,
      tone: abs.flag.tone,
      title: `Chi thực tế ${fmtMoney(abs.actual)} / giá trị HĐ ${fmtMoney(abs.contracted)} · thời gian đã qua ${Math.round(abs.timePct)}%`,
    }
  }

  const r3mPill = r3m.pct == null
    ? { count: r3m.reason, tone: 'neutral', title: '3 tháng gần nhất so 3 tháng liền trước — cần dữ liệu phủ 6 tháng' }
    : {
      count: `${r3m.pct >= 0 ? '↑' : '↓'} ${Math.abs(r3m.pct).toFixed(1)}%`,
      tone: r3m.pct >= 0 ? 'ok' : 'danger',
      title: `${r3m.window}: ${fmtMoney(r3m.cur3)} vs 3 tháng liền trước ${fmtMoney(r3m.prev3)}`,
    }

  return {
    key: 'runrate',
    title: `Giải ngân BHYT · ${series.latest ? fmtMonthKey(series.latest) : 'tháng gần nhất'}`,
    mainValue: series.latest ? `${run.curTruncated ? '≥ ' : ''}${fmtVnd(run.cur)}` : '—',
    unit: series.latest ? 'HĐ khởi phát' : '',
    subtitle: note,
    titleTip: 'Σ thành tiền các dòng trúng thầu có HĐ bắt đầu trong tháng gần nhất',
    subMetrics: [
      {
        id: 'vs_prev', info: true, label: 'vs T trước', count: run.text, tone: run.tone,
        title: run.prev != null ? `${fmtMonthKey(run.prevKey)}: ${fmtMoney(run.prev)} → ${fmtMonthKey(run.latest)}: ${fmtMoney(run.cur)}` : undefined,
      },
      { id: 'absorb', info: true, label: abs.proxy ? 'Tiến độ HĐ' : 'Hấp thụ gói', ...absPill },
      { id: 'r3m', info: true, label: 'R3M', ...r3mPill },
    ],
    progressPercent: abs.n ? Math.max(1, Math.round(abs.proxy ? abs.timePct : abs.absPct)) : null,
    progressColor: abs.flag?.tone === 'danger' ? '#ef4444' : '#0d9488',
  }
}

export function computeVssCompound(items, total) {
  const rows = items || []
  const byYear = new Map()
  let qty = 0
  let pay12 = 0
  let payG12 = 0
  let payG4 = 0
  const cskcb = new Set()
  const byProv = new Map()
  const cutoff = Date.now() - 365 * DAY_MS

  for (const r of rows) {
    const q = num(r.soluong) ?? 0
    qty += q
    const pay = vssLineValue(r)
    const y = String(r.nam || '').trim()
      || (parseDateMs(r.tungay_hd || r.congbo) != null
        ? String(new Date(parseDateMs(r.tungay_hd || r.congbo)).getFullYear())
        : '')
    if (y) byYear.set(y, (byYear.get(y) || 0) + 1)

    const t = parseDateMs(r.tungay_hd || r.congbo)
    if (t != null && t >= cutoff) {
      pay12 += pay
      const g = groupBucket(r.nhomthau)
      if (g === '1' || g === '2') payG12 += pay
      if (g === '4') payG4 += pay
    }

    const cs = String(r.ma_cskcb || r.ten_cskcb || '').trim()
    if (cs) cskcb.add(cs)
    const prov = String(r.ten_tinh || r.ma_tinh || '').trim() || '—'
    byProv.set(prov, (byProv.get(prov) || 0) + pay)
  }

  const y2026 = byYear.get('2026') || 0
  const y2025 = byYear.get('2025') || 0
  const y2024 = byYear.get('2024') || 0
  const ySum = y2024 + y2025 + y2026 || 1
  const gSum = payG12 + payG4 || 1
  const highShare = pay12 > 0 ? (payG12 / pay12) * 100 : (payG12 / gSum) * 100

  const totalPay = [...byProv.values()].reduce((a, b) => a + b, 0) || 1
  const top5 = [...byProv.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  const top5Share = (top5.reduce((s, [, v]) => s + v, 0) / totalPay) * 100
  const top1 = top5[0]
  const avgPerCs = cskcb.size ? totalPay / cskcb.size : null
  const note = sampleNote(items, total)

  // Tier proxy: count CSKCB only (no grade in row) — split by whether name suggests TW
  let twLike = 0
  let localLike = 0
  for (const r of rows) {
    const name = String(r.ten_cskcb || '').toLowerCase()
    if (/trung ương|tw\b|bạch mai|chợ rẫy|việt đức/.test(name)) twLike += 1
    else localLike += 1
  }
  const tierN = twLike + localLike || 1

  return [
    // Primary decision card: latest-month value, absolute delta, absorption, R3M
    vssRunRateCard(rows, total, note),
    {
      key: 'groups',
      title: 'Dòng tiền nhóm KT (12 th)',
      mainValue: `${highShare.toFixed(0)}%`,
      unit: 'N1+N2',
      subtitle: note,
      subMetrics: [
        { id: 'g12', label: 'Nhóm 1–2', count: fmtMoney(payG12), tone: 'ok', patch: { nhomthau: ['1', '2', 'N1', 'N2'] } },
        { id: 'g4', label: 'Nhóm 4', count: fmtMoney(payG4), tone: 'neutral', patch: { nhomthau: ['4', 'N4'] } },
      ],
      segments: [
        { key: 'h', pct: (payG12 / (pay12 || gSum)) * 100, color: '#2563eb' },
        { key: 'g', pct: (payG4 / (pay12 || gSum)) * 100, color: '#0d9488' },
      ],
    },
    {
      key: 'cskcb',
      title: 'Phủ CSKCB',
      mainValue: fmtInt(cskcb.size),
      unit: 'cơ sở',
      subtitle: note,
      subMetrics: [
        { id: 'tw', label: 'TW / Hạng I (ước)', count: fmtInt(twLike), tone: 'warn', patch: { _quick: 'cskcb_tw' } },
        { id: 'local', label: 'Tỉnh–Huyện (ước)', count: fmtInt(localLike), tone: 'ok', patch: { _quick: 'cskcb_local' } },
      ],
      segments: [
        { key: 't', pct: (twLike / tierN) * 100, color: '#7c3aed' },
        { key: 'l', pct: (localLike / tierN) * 100, color: '#94a3b8' },
      ],
    },
    {
      key: 'region',
      title: 'Tập trung Top 5 tỉnh',
      mainValue: `${top5Share.toFixed(0)}%`,
      unit: 'GT',
      subtitle: note,
      subMetrics: [
        {
          id: 'top1p',
          label: top1 ? (top1[0].length > 14 ? `${top1[0].slice(0, 12)}…` : top1[0]) : 'Top 1',
          count: top1 ? `${((top1[1] / totalPay) * 100).toFixed(0)}%` : '—',
          tone: 'warn',
          patch: top1 ? { ma_tinh: top1[0], ten_tinh: top1[0] } : {},
        },
        {
          id: 'avg_cs',
          label: 'TB / CSKCB',
          count: avgPerCs != null ? fmtMoney(avgPerCs) : '—',
          tone: 'neutral',
          patch: {},
        },
      ],
      progressPercent: top5Share,
      progressColor: '#0f766e',
    },
  ]
}

export function VssMetrics({ items, total, activeId, onFilter }) {
  const cards = useMemo(() => computeVssCompound(items, total), [items, total])
  const flash = useFlashKey(`${items?.length}|${cards[0]?.mainValue}`)
  return (
    <CompoundMetricsGrid
      title={`BHYT VSS${sampleNote(items, total) ? ` · ${sampleNote(items, total)}` : ''}`}
      flash={flash}
      cards={cards}
      activeId={activeId}
      onFilter={onFilter}
    />
  )
}

/** Client-side quick filters from metric pills (current loaded page/sample). */
export function applyMetricQuick(rows, quick, kind) {
  if (!quick || !rows?.length) return rows
  const now = Date.now()
  if (kind === 'msc_tenders') {
    return rows.filter((r) => {
      const close = parseDateMs(r.close_date)
      const pub = parseDateMs(r.published)
      const bp = num(r.bid_price ?? r.bidPrice) ?? 0
      const st = String(r.status_label || r.status_code || '').toLowerCase()
      const closed = /đóng|hủy|đã chọn|hết hạn/.test(st)
      const isOpen = close != null ? close >= now && !closed : !closed
      if (quick === 'closing_7d') return isOpen && close != null && (close - now) / DAY_MS < 7 && (close - now) >= 0
      if (quick === 'new_72h') return isOpen && pub != null && now - pub < 72 * 3600 * 1000
      if (quick === 'open_later') return isOpen && (close == null || (close - now) / DAY_MS >= 7)
      if (quick === 'big_50t') return isOpen && bp >= 50e9
      if (quick === 'small_10t') return isOpen && bp > 0 && bp < 10e9
      if (quick === 'under_50m') return bp < 50e6
      if (quick === 'over_50m') return bp >= 50e6
      if (quick === 'tier_so') return buyerTier(r.buyer) === 'so'
      if (quick === 'tier_tw') return buyerTier(r.buyer) === 'tw'
      if (quick === 'tier_bv') return buyerTier(r.buyer) === 'bv'
      return true
    })
  }
  if (kind === 'dav') {
    return rows.filter((r) => {
      const m = r.monthsLeft != null ? Number(r.monthsLeft) : monthsLeft(r.ngayHetHan)
      if (quick === 'safe_24') return m != null && m > 24
      if (quick === 'risk_12') return m != null && m >= 0 && m < 12
      return true
    })
  }
  if (kind === 'vss') {
    return rows.filter((r) => {
      const name = String(r.ten_cskcb || '').toLowerCase()
      const tw = /trung ương|tw\b|bạch mai|chợ rẫy|việt đức/.test(name)
      if (quick === 'cskcb_tw') return tw
      if (quick === 'cskcb_local') return !tw
      return true
    })
  }
  return rows
}
