/** Compound metric cards — 4 per section, dbl-click pills → table filters. No long tips. */
import { useEffect, useMemo, useState } from 'react'
import { TAG_CAM, TAG_VANG, TAG_XAM, TAG_XANH } from './tagConfig'
import { resolveBidStatusFromRow } from './bidStatus'
import { Modal } from './components'

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

/** Current calendar year — MSC/VSS metrics window starts Jan 1 of this year. */
export const METRICS_YEAR = new Date().getFullYear()
/** VSS metrics year window (inclusive). DAV uses full catalog (no year filter). */
export const VSS_METRICS_YEARS = [METRICS_YEAR]

function sampleNote(items, total, opts = {}) {
  if (opts.years?.length === 1) return `từ đầu năm ${opts.years[0]}`
  if (opts.years?.length) return `từ ${opts.years.join('–')}`
  if (opts.yearFrom) return `từ đầu năm ${opts.yearFrom}`
  const n = items?.length || 0
  const t = Number(total)
  const partial = Number.isFinite(t) && t > n ? `đã nạp ${fmtInt(n)}/${fmtInt(t)}` : ''
  return partial || 'Toàn bộ dữ liệu đã nạp'
}

/** Date in [Jan 1 yearFrom, now]. Missing dates excluded when yearFrom is set. */
function inYearFrom(raw, yearFrom) {
  if (!yearFrom) return true
  const t = parseDateMs(raw)
  if (t == null) return false
  return t >= new Date(yearFrom, 0, 1).getTime() && t <= Date.now()
}

function inYears(row, years, dateKeys = []) {
  if (!years?.length) return true
  const set = new Set(years.map(Number))
  const nam = Number(row?.nam)
  if (nam >= 1900 && nam <= 2200) return set.has(nam)
  for (const k of dateKeys) {
    const t = parseDateMs(row?.[k])
    if (t != null && set.has(new Date(t).getFullYear())) return true
  }
  return false
}

/** MSC metrics sample: published/decision from Jan 1 METRICS_YEAR through now. */
export function scopeMscMetricsRows(items) {
  return (items || []).filter((r) => inYearFrom(r.published || r.close_date || r.decision_date, METRICS_YEAR))
}

/** VSS metrics sample: nam / contract dates in VSS_METRICS_YEARS. */
export function scopeVssMetricsRows(items) {
  return (items || []).filter((r) => inYears(r, VSS_METRICS_YEARS, ['tungay_hd', 'tungay', 'congbo', 'denngay_hd']))
}

function formKey(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim() || '—'
}

/* ------------------------------------------------------------------ */
/* Donut                                                                */
/* ------------------------------------------------------------------ */
export function DonutChart({ slices, size = 100, center = null }) {
  const total = slices.reduce((s, x) => s + (x.value || 0), 0) || 1
  const r = 40
  const c = 2 * Math.PI * r
  let offset = 0
  const sum = slices.reduce((a, s) => a + (s.value || 0), 0)
  return (
    <div className="donut-wrap">
      <svg width={size} height={size} viewBox="0 0 100 100" className="donut-svg" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--line)" strokeWidth="12" />
        {slices.map((sl) => {
          const len = (sl.value / total) * c
          const el = (
            <circle
              key={sl.key}
              className="donut-seg"
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke={sl.color}
              strokeWidth="12"
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 50 50)"
            />
          )
          offset += len
          return el
        })}
        <text x="50" y="52" textAnchor="middle" className="donut-center">
          {center != null ? center : fmtInt(sum)}
        </text>
      </svg>
      <ul className="donut-legend">
        {slices.map((sl) => (
          <li key={sl.key}>
            <span className="donut-swatch" style={{ background: sl.color }} />
            <span className="donut-label">{sl.label}</span>
            <span className="donut-n">{sl.display || fmtInt(sl.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
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
  chart = null,
  scope = 'live',
  explore = null,
  activeId = null,
  onFilter,
  filtering = false,
}) {
  return (
    <div
      className={`compound-card scope-${scope}${filtering ? ' is-filtering' : ''}`}
      title={titleTip || undefined}
      data-scope={scope}
    >
      <div className="compound-head">
        <span className="compound-title">{title}</span>
        <span className="compound-head-right">
          {subtitle && <span className="compound-sub">{subtitle}</span>}
        </span>
      </div>
      <div className="compound-kpi">
        <span className="compound-value">{mainValue}</span>
        {unit && <span className="compound-unit">{unit}</span>}
        {filtering && <span className="compound-loading">đang lọc…</span>}
      </div>
      {chart}
      {subMetrics.length > 0 && (
        <div className="compound-pills">
          {subMetrics.map((item) => {
            const on = activeId === item.id
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
      {explore}
    </div>
  )
}

export function CompoundMetricsGrid({ title, cards, flash, activeId, onFilter, loading = false }) {
  return (
    <aside className={`filters-stats compound-panel${flash ? ' metrics-flash' : ''}${loading ? ' is-loading' : ''}`} aria-label={title || 'Chỉ số'}>
      {title && (
        <div className="insight-title">
          {title}
          {loading && <span className="compound-loading"> · đang nạp…</span>}
        </div>
      )}
      <div className="compound-grid">
        {cards.map((c) => (
          <CompoundMetricCard key={c.key} {...c} activeId={activeId} onFilter={onFilter} filtering={loading} />
        ))}
      </div>
    </aside>
  )
}

/* ---- DAV ---- */
export function computeDavCompound(items, total) {
  // DAV: full catalog — no year filter
  const rows = items || []
  const note = sampleNote(rows, total)

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

  const tags = { xanh: 0, vang: 0, cam: 0, xam: 0 }
  for (const r of rows) {
    if (r.tagId === TAG_XANH) tags.xanh += 1
    else if (r.tagId === TAG_VANG) tags.vang += 1
    else if (r.tagId === TAG_CAM) tags.cam += 1
    else if (r.tagId === TAG_XAM) tags.xam += 1
    else tags.vang += 1
  }

  // Per ingredient: distinct dosage forms → buckets 1 / 2 / 3 / 4+
  const byIngForms = new Map()
  for (const r of rows) {
    const ik = ingredientKey(r.hoatChat)
    if (!byIngForms.has(ik)) byIngForms.set(ik, new Set())
    byIngForms.get(ik).add(formKey(r.dangBaoChe))
  }
  const forms = { 1: 0, 2: 0, 3: 0, '4+': 0 }
  for (const set of byIngForms.values()) {
    const n = set.size
    if (n <= 1) forms[1] += 1
    else if (n === 2) forms[2] += 1
    else if (n === 3) forms[3] += 1
    else forms['4+'] += 1
  }
  const formTotal = forms[1] + forms[2] + forms[3] + forms['4+']

  const now = Date.now()
  let new3 = 0
  let new6 = 0
  let new12 = 0
  for (const r of rows) {
    const t = parseDateMs(r.ngayCap)
    if (t == null) continue
    const age = now - t
    if (age < 0) continue
    if (age <= 3 * MONTH_MS) new3 += 1
    if (age <= 6 * MONTH_MS) new6 += 1
    if (age <= 12 * MONTH_MS) new12 += 1
  }

  return [
    {
      key: 'density',
      scope: 'fixed',
      title: 'Ô kỹ thuật · mật độ SĐK',
      mainValue: fmtInt(blue),
      unit: 'ô 1–2 SĐK',
      subtitle: note,
      subMetrics: [
        { id: 'sdk_1_2', label: '1–2 SĐK', count: fmtInt(blue), tone: 'ok', patch: { ingredientCount: '1' } },
        { id: 'sdk_3_5', label: '3–5 SĐK', count: fmtInt(mid), tone: 'warn', patch: { ingredientCount: '3' } },
        { id: 'sdk_red', label: '>5 SĐK', count: fmtInt(red), tone: 'danger', patch: { ingredientCount: '5' } },
      ],
    },
    {
      key: 'tags',
      scope: 'fixed',
      title: 'Tag hồ sơ',
      mainValue: fmtInt(tags.xanh),
      unit: 'SĐK xanh',
      subtitle: note,
      subMetrics: [
        { id: 'tag_xanh', label: 'Xanh', count: fmtInt(tags.xanh), tone: 'ok', patch: { _tag: TAG_XANH } },
        { id: 'tag_vang', label: 'Vàng', count: fmtInt(tags.vang), tone: 'warn', patch: { _tag: TAG_VANG } },
        { id: 'tag_cam', label: 'Cam', count: fmtInt(tags.cam), tone: 'danger', patch: { _tag: TAG_CAM } },
        { id: 'tag_xam', label: 'Xám', count: fmtInt(tags.xam), tone: 'neutral', patch: { _tag: TAG_XAM } },
      ],
    },
    {
      key: 'forms',
      scope: 'fixed',
      title: 'Dạng bào chế / hoạt chất',
      mainValue: fmtInt(formTotal),
      unit: 'HC',
      subtitle: note,
      titleTip: 'Số hoạt chất có 1 / 2 / 3 / ≥4 dạng bào chế khác nhau trong danh mục',
      subMetrics: [
        { id: 'form_1', label: '1 dạng', count: fmtInt(forms[1]), tone: 'ok', patch: { dosageFormCount: '1' } },
        { id: 'form_2', label: '2 dạng', count: fmtInt(forms[2]), tone: 'warn', patch: { dosageFormCount: '2' } },
        { id: 'form_3', label: '3 dạng', count: fmtInt(forms[3]), tone: 'warn', patch: { dosageFormCount: '3' } },
        { id: 'form_4', label: '4+ dạng', count: fmtInt(forms['4+']), tone: 'danger', patch: { dosageFormCount: '4' } },
      ],
    },
    {
      key: 'new_sdk',
      scope: 'fixed',
      title: 'SĐK mới cấp',
      mainValue: fmtInt(new12),
      unit: '12 tháng',
      subtitle: note,
      titleTip: 'Số SĐK có ngày cấp trong 3 / 6 / 12 tháng gần nhất',
      subMetrics: [
        { id: 'new_3m', label: '3 th', count: fmtInt(new3), tone: 'ok', patch: { _quick: 'new_3m' } },
        { id: 'new_6m', label: '6 th', count: fmtInt(new6), tone: 'warn', patch: { _quick: 'new_6m' } },
        { id: 'new_12m', label: '12 th', count: fmtInt(new12), tone: 'neutral', patch: { _quick: 'new_12m' } },
      ],
    },
  ]
}

export function DavMetrics({ items, total, cards: cardsProp, activeId, onFilter, loading }) {
  const cards = useMemo(
    () => (cardsProp?.length ? cardsProp : computeDavCompound(items, total)),
    [cardsProp, items, total],
  )
  const flash = useFlashKey(`${cardsProp ? 'api' : items?.length}|${total}|${cards[0]?.mainValue}`)
  const note = cardsProp?.length ? (cards[0]?.subtitle || 'Toàn bộ dữ liệu đã nạp') : sampleNote(items, total)
  return (
    <CompoundMetricsGrid
      title={`DAV · ${note}`}
      flash={flash}
      cards={cards}
      activeId={activeId}
      onFilter={onFilter}
      loading={loading}
    />
  )
}

/* ---- MSC tenders ---- */
/** Pipeline stage for MSC tenders.
 * Open = EMPTY status_code only (future close). DXT = reviewing. Not DXT-as-open.
 */
export function mscTenderStage(r, now = Date.now()) {
  const close = parseDateMs(r.close_date)
  const pub = parseDateMs(r.published)
  const bid = resolveBidStatusFromRow(r, now)
  const code = bid.code || String(r.status_code || '').trim().toUpperCase()

  if (bid.key === 'open') {
    // Priority among empty/OPEN: closing -> new -> open
    if (close != null) {
      const d = (close - now) / DAY_MS
      if (d >= 0 && d < 7) return { stage: 'closing', close, pub, code, isOpen: true, bid }
    }
    if (pub != null && now - pub < 72 * 3600 * 1000) {
      return { stage: 'new', close, pub, code, isOpen: true, bid }
    }
    return { stage: 'open', close, pub, code, isOpen: true, bid }
  }
  if (bid.key === 'review') {
    return { stage: 'review', close, pub, code, isOpen: false, bid }
  }
  return { stage: 'closed', close, pub, code, isOpen: false, bid }
}

export function mscStatusDisplay(r) {
  return resolveBidStatusFromRow(r).label
}

export function computeMscTenderCompound(items, total) {
  const rows = scopeMscMetricsRows(items)
  const note = sampleNote(rows, total, { yearFrom: METRICS_YEAR })
  const now = Date.now()
  let openN = 0
  let reviewN = 0
  let newN = 0
  let closingN = 0
  let openVal = 0
  let big50t = 0
  let small10t = 0
  let under50m = 0
  let over50m = 0
  const tiers = { so: 0, tw: 0, bv: 0 }
  const buyers = new Set()

  for (const r of rows) {
    const { stage, isOpen } = mscTenderStage(r, now)
    const bp = num(r.bid_price ?? r.bidPrice) ?? 0
    const tier = buyerTier(r.buyer)
    tiers[tier] += 1
    if (r.buyer) buyers.add(String(r.buyer).trim())

    if (stage === 'open') openN += 1
    else if (stage === 'review') reviewN += 1
    else if (stage === 'new') newN += 1
    else if (stage === 'closing') closingN += 1

    if (isOpen) {
      openVal += bp
      if (bp >= 50e9) big50t += 1
      if (bp > 0 && bp < 10e9) small10t += 1
    }
    if (bp > 0 && bp < 50e6) under50m += 1
    else if (bp >= 50e6) over50m += 1
    else under50m += 1
  }

  const n = rows.length || 1
  const bondN = under50m + over50m || 1
  const freePct = Math.round((under50m / n) * 100)
  const highlightOpen = openN + newN + closingN
  const pipelineN = highlightOpen + reviewN || 1

  return [
    {
      key: 'pipeline',
      scope: 'fixed',
      title: 'Nhịp thầu & cơ hội mở',
      mainValue: fmtInt(highlightOpen),
      unit: 'đang mở',
      subtitle: note,
      subMetrics: [
        { id: 'open_dxt', label: 'Đang mở', count: fmtInt(openN), tone: 'ok', patch: { _quick: 'open_dxt' } },
        { id: 'reviewing', label: 'Đang xét', count: fmtInt(reviewN), tone: 'warn', patch: { _quick: 'reviewing' } },
        { id: 'new_72h', label: 'Mới <72h', count: fmtInt(newN), tone: 'ok', patch: { _quick: 'new_72h' } },
        { id: 'closing_7d', label: 'Sắp đóng', count: fmtInt(closingN), tone: 'danger', patch: { _quick: 'closing_7d' } },
      ],
      segments: [
        { key: 'o', pct: (openN / pipelineN) * 100, color: '#22c55e', label: 'Đang mở' },
        { key: 'r', pct: (reviewN / pipelineN) * 100, color: '#eab308', label: 'Xét thầu' },
        { key: 'n', pct: (newN / pipelineN) * 100, color: '#2563eb', label: 'Mới mở' },
        { key: 'c', pct: (closingN / pipelineN) * 100, color: '#ef4444', label: 'Sắp đóng' },
      ],
    },
    {
      key: 'budget',
      scope: 'fixed',
      title: 'Ngân sách mời thầu (đang mở)',
      mainValue: fmtMoney(openVal),
      unit: 'đ',
      subtitle: note,
      subMetrics: [
        { id: 'big_50t', label: 'Gói >50 Tỷ', count: fmtInt(big50t), tone: 'warn', patch: { _quick: 'big_50t' } },
        { id: 'small_10t', label: 'Gói <10 Tỷ', count: fmtInt(small10t), tone: 'ok', patch: { _quick: 'small_10t' } },
      ],
    },
    {
      key: 'bond',
      scope: 'fixed',
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
      scope: 'fixed',
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

export function MscTenderMetrics({ items, total, cards: cardsProp, activeId, onFilter, loading }) {
  const cards = useMemo(
    () => (cardsProp?.length ? cardsProp : computeMscTenderCompound(items, total)),
    [cardsProp, items, total],
  )
  const flash = useFlashKey(`${cardsProp ? 'api' : items?.length}|${cards[0]?.mainValue}`)
  const note = cardsProp?.length
    ? (cards[0]?.subtitle || `từ đầu năm ${METRICS_YEAR}`)
    : sampleNote(scopeMscMetricsRows(items), total, { yearFrom: METRICS_YEAR })
  return (
    <CompoundMetricsGrid
      title={`Gói thầu · ${note}`}
      flash={flash}
      cards={cards}
      activeId={activeId}
      onFilter={onFilter}
      loading={loading}
    />
  )
}

/* ---- Province YoY rank (12 tháng vs cùng kỳ năm trước) ---- */
const YEAR_MS = 365.25 * DAY_MS

/** Rank all provinces by YoY revenue growth (trailing 12m vs prior 12m). */
export function buildProvinceYoYTable(rows, {
  nameKey = 'province',
  valueFn,
  dateKey = 'published',
} = {}) {
  const now = Date.now()
  const curFrom = now - YEAR_MS
  const prevFrom = now - 2 * YEAR_MS
  const cur = new Map()
  const prev = new Map()
  const allNames = new Set()

  for (const r of rows || []) {
    const name = String(r[nameKey] || '').trim() || 'Chưa xác định tỉnh'
    allNames.add(name)
    const v = valueFn?.(r) || 0
    if (!(v > 0)) continue
    const t = parseDateMs(r[dateKey])
    if (t == null) continue
    if (t >= curFrom && t <= now) cur.set(name, (cur.get(name) || 0) + v)
    else if (t >= prevFrom && t < curFrom) prev.set(name, (prev.get(name) || 0) + v)
  }

  const totalCur = [...cur.values()].reduce((s, v) => s + v, 0) || 1
  return [...allNames]
    .map((name) => {
      const value = cur.get(name) || 0
      const p = prev.get(name) || 0
      const growth = p > 0 ? ((value - p) / p) * 100 : (value > 0 ? null : 0)
      return { name, value, prev: p, share: (value / totalCur) * 100, growth }
    })
    .sort((a, b) => {
      if (a.growth == null && b.growth == null) return b.value - a.value
      if (a.growth == null) return 1
      if (b.growth == null) return -1
      if (b.growth !== a.growth) return b.growth - a.growth
      return b.value - a.value
    })
}

/** @deprecated kept for tests — prefer buildProvinceYoYTable */
export function buildRankTable(rows, {
  nameKey,
  valueFn,
  dateKey,
  months = 12,
  limit = 9999,
} = {}) {
  const now = Date.now()
  const winMs = months * MONTH_MS
  const curFrom = now - winMs
  const prevFrom = now - 2 * winMs
  const cur = new Map()
  const prev = new Map()
  for (const r of rows || []) {
    const name = String(r[nameKey] || '').trim() || '—'
    const t = parseDateMs(r[dateKey])
    const v = valueFn(r) || 0
    if (!(v > 0)) continue
    if (t == null || t >= curFrom) cur.set(name, (cur.get(name) || 0) + v)
    else if (t >= prevFrom) prev.set(name, (prev.get(name) || 0) + v)
  }
  const total = [...cur.values()].reduce((s, v) => s + v, 0) || 1
  return [...cur.entries()]
    .map(([name, val]) => {
      const p = prev.get(name) || 0
      const growth = p > 0 ? ((val - p) / p) * 100 : (val > 0 ? null : 0)
      return { name, value: val, share: (val / total) * 100, prev: p, growth }
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
}

function RankHeatRow({ share, growth }) {
  const hot = growth != null && growth > 5
  const cold = growth != null && growth < -5
  return (
    <span
      className={`rank-heat${hot ? ' up' : ''}${cold ? ' down' : ''}`}
      style={{ '--heat': `${Math.min(100, Math.max(8, share))}%` }}
      title={growth == null ? 'Kỳ trước = 0 / thiếu mẫu' : fmtPct(growth)}
    />
  )
}

export function RankExploreModal({
  open,
  onClose,
  title,
  rows,
  rankedRows,
  nameKey,
  valueFn,
  dateKey,
  onPick,
}) {
  const [query, setQuery] = useState('')
  const ranked = useMemo(
    () => (rankedRows?.length
      ? rankedRows
      : buildProvinceYoYTable(rows, { nameKey, valueFn, dateKey })),
    [rankedRows, rows, nameKey, valueFn, dateKey],
  )
  const visible = useMemo(() => {
    const q = ingredientKey(query)
    if (!q) return ranked
    return ranked.filter((r) => ingredientKey(r.name).includes(q))
  }, [ranked, query])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      subtitle="Doanh thu 12 tháng gần nhất so cùng kỳ năm trước · đủ tất cả tỉnh"
      width={980}
      footer={(
        <>
          <span className="muted">{ranked.length} tỉnh</span>
          <div className="spacer" />
          <button type="button" className="btn secondary" onClick={onClose}>Đóng</button>
        </>
      )}
    >
      <div className="province-toolbar">
        <input
          aria-label="Tìm tỉnh"
          placeholder="Tìm tỉnh…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span>{visible.length} / {ranked.length} tỉnh</span>
      </div>
      <div className="rank-table-wrap province-table-wrap">
        <table className="rank-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Tỉnh / TP</th>
              <th>DT 12 th</th>
              <th>Cùng kỳ NH</th>
              <th>Tỷ trọng</th>
              <th>YoY %</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.name}>
                <td>{ranked.indexOf(r) + 1}</td>
                <td>
                  <button type="button" className="linkish" onClick={() => onPick?.(r.name)}>{r.name}</button>
                </td>
                <td className="mono">{fmtMoney(r.value)}</td>
                <td className="mono">{fmtMoney(r.prev)}</td>
                <td>
                  <div className="rank-share-cell">
                    <RankHeatRow share={r.share} growth={r.growth} />
                    <span>{r.share.toFixed(1)}%</span>
                  </div>
                </td>
                <td className={r.growth != null && r.growth < 0 ? 'neg' : 'pos'}>
                  {r.growth == null ? '—' : fmtPct(r.growth)}
                </td>
                <td>
                  <button type="button" className="btn secondary tiny" onClick={() => onPick?.(r.name)}>Lọc</button>
                </td>
              </tr>
            ))}
            {!visible.length && (
              <tr><td colSpan={7} className="empty">Chưa có dữ liệu tỉnh.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}

function RankExploreButton({ label, topHint, onOpen }) {
  return (
    <button type="button" className="rank-explore-btn" onClick={onOpen}>
      <span className="rank-explore-label">{label}</span>
      {topHint && <span className="rank-explore-hint">{topHint}</span>}
      <span className="rank-explore-cta">Xem xếp hạng →</span>
    </button>
  )
}

/* ---- MSC prices ---- */
function mscLineValue(r) {
  return (num(r.quantity) || 0) * (num(r.unit_price ?? r.unitPrice) || 0)
}

export function computeMscPriceCompound(items, total, { onExploreProvinces } = {}) {
  const rows = scopeMscMetricsRows(items)
  const note = sampleNote(rows, total, { yearFrom: METRICS_YEAR })

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
  const byProv = new Map()
  let value = 0

  for (const r of rows) {
    const line = mscLineValue(r)
    value += line
    const g = groupBucket(r.group_name)
    const price = num(r.unit_price ?? r.unitPrice)
    if (g === '2' && price > 0) g2.push(price)
    if (g === '4' && price > 0) g4.push(price)
    const prov = String(r.province || '').trim() || 'Chưa xác định tỉnh'
    byProv.set(prov, (byProv.get(prov) || 0) + line)
  }

  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null)
  const avg2 = avg(g2)
  const avg4 = avg(g4)
  const margin = avg4 > 0 && avg2 != null ? ((avg2 - avg4) / avg4) * 100 : null

  const sortedProv = [...byProv.entries()].sort((a, b) => b[1] - a[1])
  const topProv = sortedProv[0]
  const yoy = buildProvinceYoYTable(rows, {
    nameKey: 'province',
    valueFn: mscLineValue,
    dateKey: 'published',
  })
  const topGrowth = yoy.find((p) => p.growth != null) || yoy[0]
  const discN = dLow + dMid + dHigh || 1

  return [
    {
      key: 'discount',
      scope: 'fixed',
      title: 'Giảm giá vs đỉnh HC',
      mainValue: dN ? `${avgDisc.toFixed(1)}%` : '—',
      unit: 'TB',
      subtitle: note,
      subMetrics: [
        { id: 'disc_low', label: '<5%', count: fmtInt(dLow), tone: 'ok', patch: { _quick: 'disc_low' } },
        { id: 'disc_mid', label: '5–15%', count: fmtInt(dMid), tone: 'warn', patch: { _quick: 'disc_mid' } },
        { id: 'disc_high', label: '>15%', count: fmtInt(dHigh), tone: 'danger', patch: { _quick: 'disc_high' } },
      ],
      segments: [
        { key: 'l', pct: (dLow / discN) * 100, color: '#22c55e' },
        { key: 'm', pct: (dMid / discN) * 100, color: '#eab308' },
        { key: 'h', pct: (dHigh / discN) * 100, color: '#ef4444' },
      ],
    },
    {
      key: 'g24',
      scope: 'fixed',
      title: 'Biên giá N2 vs N4',
      mainValue: margin == null ? '—' : fmtPct(margin),
      unit: 'TB',
      subtitle: note,
      subMetrics: [
        { id: 'g2', label: 'Giá TB N2', count: avg2 != null ? fmtInt(avg2) : '—', tone: 'ok', patch: { group_name: '2' } },
        { id: 'g4', label: 'Giá TB N4', count: avg4 != null ? fmtInt(avg4) : '—', tone: 'neutral', patch: { group_name: '4' } },
      ],
    },
    {
      key: 'province_lead',
      scope: 'fixed',
      title: 'Tỉnh dẫn đầu doanh thu',
      mainValue: topProv ? (topProv[0].length > 18 ? `${topProv[0].slice(0, 16)}…` : topProv[0]) : '—',
      unit: topProv ? fmtMoney(topProv[1]) : '',
      subtitle: note,
      titleTip: `Tỉnh có tổng thành tiền (SL × ĐG) cao nhất từ đầu năm ${METRICS_YEAR}`,
      subMetrics: [
        { id: 'prov_n', label: 'Số tỉnh', count: fmtInt(byProv.size), tone: 'neutral', info: true },
        { id: 'prov_total', label: 'Tổng DT', count: fmtMoney(value), tone: 'ok', info: true },
      ],
    },
    {
      key: 'province_yoy',
      scope: 'fixed',
      title: 'Tăng trưởng YoY theo tỉnh',
      mainValue: topGrowth?.growth == null ? '—' : fmtPct(topGrowth.growth),
      unit: topGrowth ? (topGrowth.name.length > 14 ? `${topGrowth.name.slice(0, 12)}…` : topGrowth.name) : '',
      subtitle: note,
      titleTip: `Mẫu từ đầu năm ${METRICS_YEAR} — 12 tháng gần nhất so cùng kỳ năm trước`,
      explore: (
        <RankExploreButton
          label={topGrowth?.name || 'Chưa có tỉnh'}
          topHint={topGrowth ? `${fmtMoney(topGrowth.value)} · ${yoy.length} tỉnh` : null}
          onOpen={() => onExploreProvinces?.()}
        />
      ),
    },
  ]
}

export function MscPriceMetrics({ items, total, cards: cardsProp, provincesYoy, activeId, onFilter, loading }) {
  const [explore, setExplore] = useState(false)
  const scoped = useMemo(() => scopeMscMetricsRows(items), [items])
  const cards = useMemo(() => {
    const base = cardsProp?.length
      ? cardsProp
      : computeMscPriceCompound(items, total, { onExploreProvinces: () => setExplore(true) })
    if (!cardsProp?.length) return base
    return base.map((c) => (c.explore
      ? {
        ...c,
        explore: (
          <RankExploreButton
            label={c.unit || c.mainValue || 'Chưa có tỉnh'}
            topHint={provincesYoy?.length ? `${provincesYoy.length} tỉnh` : null}
            onOpen={() => setExplore(true)}
          />
        ),
      }
      : c))
  }, [cardsProp, items, total, provincesYoy])
  const flash = useFlashKey(`${cardsProp ? 'api' : scoped.length}|${cards[0]?.mainValue}`)
  const note = cardsProp?.length
    ? (cards[0]?.subtitle || `từ đầu năm ${METRICS_YEAR}`)
    : sampleNote(scoped, total, { yearFrom: METRICS_YEAR })
  return (
    <>
      <CompoundMetricsGrid
        title={`Đơn giá · ${note}`}
        flash={flash}
        cards={cards}
        activeId={activeId}
        onFilter={onFilter}
        loading={loading}
      />
      <RankExploreModal
        open={explore}
        onClose={() => setExplore(false)}
        title={`Xếp hạng tỉnh YoY · từ đầu năm ${METRICS_YEAR}`}
        rows={scoped}
        rankedRows={provincesYoy}
        nameKey="province"
        valueFn={mscLineValue}
        dateKey="published"
        onPick={(name) => {
          setExplore(false)
          onFilter?.({ province: name }, `province:${name}`)
        }}
      />
    </>
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

export function computeVssCompound(items, total, { onExploreProvinces } = {}) {
  const rows = scopeVssMetricsRows(items)
  const note = sampleNote(rows, total, { years: VSS_METRICS_YEARS })

  const payG = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  let payAll = 0
  const cskcb = new Set()
  const provinceRows = buildProvinceTable(rows)

  for (const r of rows) {
    const pay = vssLineValue(r)
    payAll += pay
    const g = groupBucket(r.nhomthau)
    if (g && payG[g] != null) payG[g] += pay

    const cs = String(r.ma_cskcb || r.ten_cskcb || '').trim()
    if (cs) cskcb.add(cs)
  }

  const highShare = ((payG[1] + payG[2]) / (payAll || 1)) * 100
  const top = provinceRows[0]
  const totalPay = provinceRows.reduce((a, b) => a + b.value, 0)

  let twLike = 0
  let localLike = 0
  for (const r of rows) {
    const name = String(r.ten_cskcb || '').toLowerCase()
    if (/trung ương|tw\b|bạch mai|chợ rẫy|việt đức/.test(name)) twLike += 1
    else localLike += 1
  }
  const tierN = twLike + localLike || 1

  return [
    {
      key: 'total',
      scope: 'fixed',
      title: 'Tổng giá trị trúng thầu',
      mainValue: fmtMoney(payAll),
      unit: 'đ',
      subtitle: note,
      subMetrics: [
        { id: 'rows', label: 'Dòng', count: fmtInt(rows.length), tone: 'neutral', info: true },
        { id: 'n12', label: 'N1+N2', count: `${highShare.toFixed(0)}%`, tone: 'ok', info: true },
      ],
    },
    {
      key: 'groups',
      scope: 'fixed',
      title: 'Dòng tiền theo nhóm',
      mainValue: `${highShare.toFixed(0)}%`,
      unit: 'N1+N2',
      subtitle: note,
      subMetrics: [1, 2, 3, 4, 5].map((n) => ({
        id: `g${n}`,
        label: `N${n}`,
        count: fmtMoney(payG[n]),
        tone: n <= 2 ? 'ok' : n === 4 ? 'warn' : 'neutral',
        patch: { nhomthau: [`${n}`, `N${n}`] },
      })),
    },
    {
      key: 'cskcb',
      scope: 'fixed',
      title: 'Phủ CSKCB',
      mainValue: fmtInt(cskcb.size),
      unit: 'cơ sở',
      subtitle: note,
      subMetrics: [
        { id: 'tw', label: 'TW / Hạng I', count: fmtInt(twLike), tone: 'warn', patch: { _quick: 'cskcb_tw' } },
        { id: 'local', label: 'Tỉnh–Huyện', count: fmtInt(localLike), tone: 'ok', patch: { _quick: 'cskcb_local' } },
      ],
      segments: [
        { key: 't', pct: (twLike / tierN) * 100, color: '#7c3aed' },
        { key: 'l', pct: (localLike / tierN) * 100, color: '#94a3b8' },
      ],
    },
    {
      key: 'region',
      scope: 'fixed',
      title: 'Tỉnh dẫn đầu doanh thu',
      mainValue: top ? (top.name.length > 18 ? `${top.name.slice(0, 16)}…` : top.name) : '—',
      unit: top ? fmtMoney(top.value) : '',
      subtitle: note,
      titleTip: `Tỉnh có tổng thành tiền cao nhất từ đầu năm ${METRICS_YEAR} — mở bảng xếp hạng`,
      subMetrics: [
        { id: 'prov_n', label: 'Số tỉnh', count: fmtInt(provinceRows.length), tone: 'neutral', info: true },
        { id: 'prov_share', label: 'Tỷ trọng', count: top ? `${top.share.toFixed(1)}%` : '—', tone: 'ok', info: true },
        { id: 'prov_total', label: 'Tổng', count: fmtMoney(totalPay), tone: 'ok', info: true },
      ],
      explore: <button type="button" className="province-detail-btn" onClick={() => onExploreProvinces?.()}>Xem tất cả tỉnh →</button>,
    },
  ]
}

export function provinceName(row) {
  const name = String(row.ten_tinh || '').trim()
  const code = String(row.ma_tinh || '').trim()
  return name || (code ? `Tỉnh mã ${code}` : 'Chưa xác định tỉnh')
}

export function buildProvinceTable(rows) {
  const groups = new Map()
  for (const row of rows || []) {
    const code = String(row.ma_tinh || '').trim()
    const name = provinceName(row)
    const key = code || name
    if (!groups.has(key)) groups.set(key, { key, code, name, value: 0, count: 0, facilities: new Set(), groups: [0, 0, 0, 0, 0] })
    const item = groups.get(key)
    if (String(row.ten_tinh || '').trim()) item.name = name
    const value = vssLineValue(row)
    item.value += value
    item.count++
    const facility = row.ma_cskcb || row.ten_cskcb
    if (facility) item.facilities.add(facility)
    const group = groupBucket(row.nhomthau)
    if (group) item.groups[Number(group) - 1] += value
  }
  const total = [...groups.values()].reduce((sum, p) => sum + p.value, 0)
  return [...groups.values()].sort((a, b) => b.value - a.value).map((p) => ({
    ...p, facilities: p.facilities.size, share: total ? p.value / total * 100 : 0,
  }))
}

function ProvinceExploreModal({ open, onClose, rows, rankedRows, total, loading, onPick }) {
  const [query, setQuery] = useState('')
  const ranked = useMemo(
    () => (rankedRows?.length ? rankedRows : buildProvinceTable(rows)),
    [rankedRows, rows],
  )
  const shown = ranked.filter((p) => ingredientKey(`${p.name} ${p.code}`).includes(ingredientKey(query)))
  const visible = query.trim() ? shown : ranked
  const rowCount = rankedRows?.length
    ? ranked.reduce((s, p) => s + (p.count || 0), 0)
    : (rows?.length || 0)
  return <Modal open={open} onClose={onClose} title="Giá trị trúng thầu theo tỉnh"
    subtitle={`Mẫu từ đầu năm ${METRICS_YEAR} · sắp xếp theo doanh thu`}
    width={1120}
    footer={(
      <>
        <span className="muted">{ranked.length} tỉnh</span>
        <div className="spacer" />
        <button type="button" className="btn secondary" onClick={onClose}>Đóng</button>
      </>
    )}
  >
    <div className="province-summary">
      <div><span>Tổng giá trị</span><strong>{fmtVnd(ranked.reduce((sum, p) => sum + p.value, 0))}</strong></div>
      <div><span>Tỉnh / nhóm</span><strong>{fmtInt(ranked.length)}</strong></div>
      <div><span>Dòng trúng thầu</span><strong>{fmtInt(rowCount)}</strong></div>
    </div>
    <div className="province-toolbar">
      <input aria-label="Tìm tỉnh hoặc mã tỉnh" placeholder="Tìm tỉnh hoặc mã tỉnh…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <span>{visible.length} / {ranked.length} tỉnh</span>
    </div>
    {(loading || (!rankedRows?.length && Number(total) > (rows?.length || 0))) && <p className="province-note">{loading ? 'Đang nạp dữ liệu, các giá trị sẽ tiếp tục cập nhật.' : 'Thống kê trên dữ liệu đã nạp; chưa đủ toàn bộ kết quả.'}</p>}
    <div className="rank-table-wrap province-table-wrap">
      <table className="rank-table province-table">
        <thead><tr><th>#</th><th>Tỉnh / TP</th><th>Giá trị trúng thầu</th><th>Tỷ trọng</th><th>CSKCB</th><th>Số dòng</th>{[1, 2, 3, 4, 5].map((n) => <th key={n}>Nhóm {n}</th>)}<th>Tra cứu</th></tr></thead>
        <tbody>{visible.map((p) => <tr key={p.key}>
          <td>{ranked.indexOf(p) + 1}</td><td><strong>{p.name}</strong>{p.code && <small>Mã {p.code}</small>}</td>
          <td className="mono">{fmtVnd(p.value)}</td><td>{p.share.toFixed(1)}%</td><td>{fmtInt(p.facilities)}</td><td>{fmtInt(p.count)}</td>
          {(p.groups || [0, 0, 0, 0, 0]).map((v, i) => <td key={i} className="mono">{fmtMoney(v)}</td>)}
          <td>{(p.code || p.name !== 'Chưa xác định tỉnh') && <button className="btn secondary tiny" onClick={() => onPick(p)}>Lọc tỉnh</button>}</td>
        </tr>)}</tbody>
      </table>
      {!visible.length && <p className="empty">{ranked.length ? 'Không có tỉnh phù hợp.' : 'Chưa có dữ liệu tỉnh.'}</p>}
    </div>
    <p className="province-note">Giá trị trúng thầu = thành tiền hoặc đơn giá × số lượng. Dòng thiếu tên tỉnh được ghi theo mã; thiếu cả mã gom vào “Chưa xác định tỉnh”.</p>
  </Modal>
}

export function VssMetrics({ items, total, cards: cardsProp, provinces, activeId, onFilter, loading }) {
  const [explore, setExplore] = useState(false)
  const scoped = useMemo(() => scopeVssMetricsRows(items), [items])
  const cards = useMemo(() => {
    const base = cardsProp?.length
      ? cardsProp
      : computeVssCompound(items, total, { onExploreProvinces: () => setExplore(true) })
    if (!cardsProp?.length) return base
    return base.map((c) => (c.explore
      ? {
        ...c,
        explore: (
          <button type="button" className="province-detail-btn" onClick={() => setExplore(true)}>
            Xem tất cả tỉnh →
          </button>
        ),
      }
      : c))
  }, [cardsProp, items, total])
  const flash = useFlashKey(`${cardsProp ? 'api' : scoped.length}|${cards[0]?.mainValue}`)
  const note = cardsProp?.length
    ? (cards[0]?.subtitle || `từ đầu năm ${METRICS_YEAR}`)
    : sampleNote(scoped, total, { years: VSS_METRICS_YEARS })
  return (
    <>
      <CompoundMetricsGrid
        title={`BHYT VSS · ${note}`}
        flash={flash}
        cards={cards}
        activeId={activeId}
        onFilter={onFilter}
        loading={loading}
      />
      <ProvinceExploreModal
        open={explore}
        onClose={() => setExplore(false)}
        rows={scoped}
        rankedRows={provinces}
        total={total}
        loading={loading}
        onPick={(province) => {
          setExplore(false)
          onFilter?.({ ma_tinh: province.code || province.name }, `prov:${province.key}`)
        }}
      />
    </>
  )
}

/** Client-side quick filters from metric pills (current loaded page/sample). */
export function applyMetricQuick(rows, quick, kind) {
  if (!quick || !rows?.length) return rows
  const now = Date.now()
  if (kind === 'msc_tenders') {
    return rows.filter((r) => {
      const bp = num(r.bid_price ?? r.bidPrice) ?? 0
      const { stage, isOpen } = mscTenderStage(r, now)
      if (quick === 'open_dxt' || quick === 'open_empty') return stage === 'open'
      if (quick === 'reviewing') return stage === 'review'
      if (quick === 'closing_7d') return stage === 'closing'
      if (quick === 'new_72h') return stage === 'new'
      if (quick === 'open_later') return stage === 'open'
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
      const t = parseDateMs(r.ngayCap)
      const age = t == null ? null : Date.now() - t
      if (quick === 'new_3m') return age != null && age >= 0 && age <= 3 * MONTH_MS
      if (quick === 'new_6m') return age != null && age >= 0 && age <= 6 * MONTH_MS
      if (quick === 'new_12m') return age != null && age >= 0 && age <= 12 * MONTH_MS
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
