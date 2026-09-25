/** Decision metrics panels for DAV / MSC / VSS (3 stats + chart). */
import { useMemo } from 'react'
import { TAG_CAM } from './tagConfig'
import { matchToken, tokenizeIngredients } from './tt20'

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

function monthsLeft(iso) {
  if (!iso) return null
  const t = Date.parse(String(iso).slice(0, 19))
  if (!Number.isFinite(t)) return null
  return (t - Date.now()) / (30.4375 * 24 * 3600 * 1000)
}

function sdkOrigin(sdk) {
  const s = String(sdk || '').trim().toUpperCase()
  if (s.startsWith('GC')) return 'gc'
  if (s.startsWith('VD')) return 'vd'
  if (s.startsWith('VN')) return 'vn'
  return 'other'
}

function routeBucket(duong) {
  const s = String(duong || '').toLowerCase()
  if (/tiêm|truyền|inject|iv\b|im\b/.test(s)) return 'inject'
  if (/uống|oral|viên|nang|gói|sirô|siro|hỗn dịch uống/.test(s)) return 'oral'
  return 'other'
}

function buyerTier(buyer) {
  const s = String(buyer || '').toLowerCase()
  if (/bộ y tế|trung ương|tw\b|trung uong/.test(s)) return 'tw'
  if (/sở y tế|so y te|đấu thầu tập trung|dau thau tap trung/.test(s)) return 'so'
  return 'bv'
}

/** Parse BHYT co-pay % from TT20 note; default 100% if listed without %; 0 if not in catalog. */
export function parseBhytRate(ghiChu, inCatalog) {
  if (!inCatalog) return 0
  const note = String(ghiChu || '')
  const m = note.match(/thanh toán\s*(\d+)\s*%/i) || note.match(/(\d+)\s*%/)
  if (m) return Math.min(100, Math.max(0, parseInt(m[1], 10)))
  return 100
}

export function DonutChart({ slices, size = 112 }) {
  const total = slices.reduce((s, x) => s + (x.value || 0), 0) || 1
  const r = 40
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <div className="donut-wrap">
      <svg width={size} height={size} viewBox="0 0 100 100" className="donut-svg" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--line)" strokeWidth="12" />
        {slices.map((sl) => {
          const len = (sl.value / total) * c
          const el = (
            <circle
              key={sl.key}
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
        <text x="50" y="52" textAnchor="middle" className="donut-center">{fmtInt(total === 1 && slices.every((s) => !s.value) ? 0 : slices.reduce((a, s) => a + s.value, 0))}</text>
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

export function MiniBars({ bars }) {
  const max = Math.max(1, ...bars.map((b) => b.value || 0))
  return (
    <div className="mini-bars" role="img" aria-label="So sánh giá theo nhóm">
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

export function MetricsPanel({ title, stats, chart, chartTitle }) {
  return (
    <aside className="filters-stats insight-panel" aria-label={title || 'Chỉ số quyết định'}>
      {title && <div className="insight-title">{title}</div>}
      <div className="insight-stats">
        {stats.map((s) => (
          <StatCard key={s.key} {...s} />
        ))}
      </div>
      <div className="stats-card insight-chart">
        {chartTitle && <div className="stats-kicker">{chartTitle}</div>}
        {chart}
      </div>
    </aside>
  )
}

/* ---- DAV ---- */
export function computeDavMetrics(items, totalHint) {
  const rows = items || []
  const n = totalHint != null ? totalHint : rows.length
  const densityTone = n <= 2 ? 'ok' : n <= 5 ? 'warn' : 'danger'
  const densityBadge = n <= 2
    ? { text: 'Ô vàng', tone: 'ok' }
    : n <= 5
      ? { text: 'Cân nhắc', tone: 'warn' }
      : { text: 'Đại dương đỏ', tone: 'danger' }

  const dm93Hit = rows.some((r) => r.tagId === TAG_CAM || r.dm93 === 'match')
  const euDomestic = rows.filter((r) => {
    const nuoc = String(r.nuocSanXuat || '').toLowerCase()
    const tieu = String(r.tieuChuan || '').toUpperCase()
    return (nuoc.includes('việt') || nuoc.includes('viet')) && /EU|GMP/.test(tieu)
  }).length
  const banned = dm93Hit || euDomestic >= 3

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

  const origin = { vd: 0, vn: 0, gc: 0, other: 0 }
  for (const r of rows) origin[sdkOrigin(r.soDangKy)] += 1

  return {
    stats: [
      {
        key: 'density',
        kicker: 'Mật độ SĐK · ô kỹ thuật',
        value: `${fmtInt(n)} SĐK`,
        badge: densityBadge,
        tone: densityTone,
        sub: 'Theo bộ lọc hiện tại',
      },
      {
        key: 'dm93',
        kicker: 'Bẫy Danh mục 93',
        value: banned ? 'Cấm hàng ngoại' : 'Tự do nhập khẩu',
        badge: banned
          ? { text: '⛔ DM93', tone: 'danger' }
          : { text: '🛡️ OK', tone: 'ok' },
        tone: banned ? 'danger' : 'ok',
        sub: banned ? '≥3 CS EU-GMP nội / khớp DM93' : 'Chưa đủ điều kiện cấm nhập',
      },
      {
        key: 'cycle',
        kicker: 'An toàn chu kỳ thầu 36 tháng',
        value: `${safePct}%`,
        badge: cycle3 > 0 ? { text: `${fmtInt(cycle3)} SĐK · 3 năm`, tone: 'warn' } : null,
        tone: safePct >= 50 ? 'ok' : 'warn',
        sub: 'Hạn >18 tháng & cấp ~5 năm',
      },
    ],
    slices: [
      { key: 'vd', label: 'Nội địa (VD)', value: origin.vd, color: '#0d9488' },
      { key: 'vn', label: 'Nhập khẩu (VN)', value: origin.vn, color: '#2563eb' },
      { key: 'gc', label: 'Gia công (GC)', value: origin.gc, color: '#d97706' },
      ...(origin.other ? [{ key: 'other', label: 'Khác', value: origin.other, color: '#94a3b8' }] : []),
    ],
  }
}

export function DavMetrics({ items, total }) {
  const m = useMemo(() => computeDavMetrics(items, total), [items, total])
  const sampleNote = (items?.length || 0) < (total || 0)
    ? ` · mẫu ${fmtInt(items.length)}/${fmtInt(total)}`
    : ''
  const stats = m.stats.map((s, i) => (
    i === 0 ? s : { ...s, sub: `${s.sub || ''}${sampleNote}` }
  ))
  return (
    <MetricsPanel
      title="Rào cản gia nhập"
      stats={stats}
      chartTitle={`Cơ cấu nguồn gốc SĐK${sampleNote}`}
      chart={<DonutChart slices={m.slices} />}
    />
  )
}

/* ---- MSC prices ---- */
export function computeMscPriceMetrics(items) {
  const rows = items || []
  let volume = 0
  let value = 0
  const byWinner = new Map()
  const byGroup = { g2: [], g4: [], plan: [] }

  for (const r of rows) {
    const qty = num(r.quantity) ?? 0
    const price = num(r.unit_price ?? r.unitPrice) ?? 0
    volume += qty
    value += qty * price
    const w = String(r.winner || '').trim() || '—'
    byWinner.set(w, (byWinner.get(w) || 0) + (qty * price || 1))
    const g = String(r.group_name ?? r.groupName ?? '').toLowerCase()
    if (/nhóm\s*2|\bn2\b|group\s*2|^2$/.test(g)) byGroup.g2.push(price)
    if (/nhóm\s*4|\bn4\b|group\s*4|^4$/.test(g)) byGroup.g4.push(price)
    const plan = num(r.plan_price ?? r.planPrice ?? r.gia_ke_hoach)
    if (plan != null) byGroup.plan.push(plan)
  }

  let topName = '—'
  let topShare = 0
  let sumW = 0
  for (const v of byWinner.values()) sumW += v
  for (const [name, v] of byWinner) {
    const share = sumW ? v / sumW : 0
    if (share > topShare) { topShare = share; topName = name }
  }

  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null)
  const planAvg = avg(byGroup.plan)
  const winPrices = rows.map((r) => num(r.unit_price ?? r.unitPrice)).filter((x) => x != null)
  const winAvg = avg(winPrices)
  let discount = null
  if (planAvg != null && winAvg != null && planAvg > 0) {
    discount = ((planAvg - winAvg) / planAvg) * 100
  } else if (winPrices.length >= 2) {
    const mx = Math.max(...winPrices)
    const mn = Math.min(...winPrices)
    discount = mx > 0 ? ((mx - mn) / mx) * 100 : null
  }
  const discTone = discount == null ? '' : discount < 5 ? 'ok' : discount > 15 ? 'danger' : 'warn'

  return {
    stats: [
      {
        key: 'vol',
        kicker: 'Dung lượng tiêu thụ (KQLCNT)',
        value: fmtInt(volume),
        sub: `≈ ${fmtMoney(value)} VNĐ · ${fmtInt(rows.length)} dòng`,
      },
      {
        key: 'disc',
        kicker: planAvg != null ? 'Biên độ giảm giá (KH → trúng)' : 'Biên độ giá trong kết quả',
        value: discount == null ? '—' : `${discount.toFixed(1)}%`,
        badge: discount == null ? null : discount < 5
          ? { text: 'Giữ giá', tone: 'ok' }
          : discount > 15
            ? { text: 'Phá giá', tone: 'danger' }
            : { text: 'Cạnh tranh', tone: 'warn' },
        tone: discTone,
        sub: planAvg != null ? 'So giá kế hoạch vs trúng TB' : 'Thiếu giá KH — dùng (max−min)/max',
      },
      {
        key: 'top',
        kicker: 'Đơn vị dẫn đầu thị phần',
        value: topName.length > 28 ? `${topName.slice(0, 26)}…` : topName,
        badge: { text: `${Math.round(topShare * 100)}%`, tone: topShare >= 0.5 ? 'warn' : 'ok' },
        sub: 'Theo giá trị trúng trong kết quả lọc',
      },
    ],
    bars: [
      { key: 'plan', label: 'Giá KH', value: planAvg || 0, display: planAvg != null ? fmtInt(planAvg) : '—', color: '#64748b' },
      { key: 'g2', label: 'Nhóm 2', value: avg(byGroup.g2) || 0, display: avg(byGroup.g2) != null ? fmtInt(avg(byGroup.g2)) : '—', color: '#2563eb' },
      { key: 'g4', label: 'Nhóm 4', value: avg(byGroup.g4) || 0, display: avg(byGroup.g4) != null ? fmtInt(avg(byGroup.g4)) : '—', color: '#0d9488' },
    ],
  }
}

export function MscPriceMetrics({ items }) {
  const m = useMemo(() => computeMscPriceMetrics(items), [items])
  return (
    <MetricsPanel
      title="Định giá · P&L"
      stats={m.stats}
      chartTitle="Giá KH vs Nhóm 2 · 4"
      chart={<MiniBars bars={m.bars} />}
    />
  )
}

/* ---- MSC tenders ---- */
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
  return (
    <MetricsPanel
      title="Săn thầu · dòng tiền"
      stats={m.stats}
      chartTitle="Cấp mời thầu"
      chart={<DonutChart slices={m.slices} />}
    />
  )
}

/* ---- VSS (via TT20) ---- */
export function computeVssMetrics(items, tt20Index) {
  const rows = items || []
  const routes = { oral: 0, inject: 0, other: 0 }
  for (const r of rows) routes[routeBucket(r.duongdung)] += 1

  let entry = null
  if (tt20Index) {
    for (const r of rows) {
      const segs = tokenizeIngredients(r.hoatchat).filter((s) => !s.sep && String(s.text || '').trim())
      for (const s of segs) {
        const g = matchToken(tt20Index, s.text)
        if (g?.entries?.length) {
          entry = g.entries[0]
          break
        }
      }
      if (entry) break
    }
  }

  const inCatalog = !!entry
  const rate = parseBhytRate(entry?.ghiChu, inCatalog)
  const grades = {
    db: !!String(entry?.hangDB_I || '').trim(),
    ii: !!String(entry?.hangII || '').trim(),
    iii: !!String(entry?.hangIII_IV || '').trim(),
    tram: !!String(entry?.tramYT || '').trim(),
  }
  const fullCover = grades.db && grades.ii && grades.iii && grades.tram
  const note = String(entry?.ghiChu || '').trim()
  const restricted = note.length > 0

  return {
    stats: [
      {
        key: 'rate',
        kicker: 'Tỷ lệ chi trả BHYT (TT20)',
        value: inCatalog ? `${rate}%` : '0%',
        badge: !inCatalog
          ? { text: 'Tự chi trả', tone: 'danger' }
          : rate >= 100
            ? { text: 'Ưu tiên kê', tone: 'ok' }
            : { text: 'Đồng chi trả', tone: 'warn' },
        tone: !inCatalog ? 'danger' : rate >= 100 ? 'ok' : 'warn',
        sub: inCatalog ? 'Theo ghi chú TT 20/2022' : 'Không thấy trong danh mục TT20',
      },
      {
        key: 'grade',
        kicker: 'Phủ tuyến KCB',
        value: fullCover ? 'Phủ toàn tuyến' : inCatalog ? 'Hạn chế tuyến' : '—',
        badge: fullCover
          ? { text: 'ĐB → Hạng IV', tone: 'ok' }
          : inCatalog
            ? { text: 'Chỉ tuyến cao', tone: 'danger' }
            : null,
        tone: fullCover ? 'ok' : 'danger',
        sub: inCatalog
          ? `ĐB/I ${grades.db ? '✓' : '—'} · II ${grades.ii ? '✓' : '—'} · III/IV ${grades.iii ? '✓' : '—'} · Trạm ${grades.tram ? '✓' : '—'}`
          : 'Cần khớp hoạt chất TT20',
      },
      {
        key: 'rx',
        kicker: 'Rào cản chỉ định lâm sàng',
        value: !inCatalog ? '—' : restricted ? 'Siết điều kiện' : 'Kê đơn tự do',
        badge: !inCatalog ? null : restricted
          ? { text: '⚠️ Ghi chú', tone: 'warn' }
          : { text: '🟢 Tự do', tone: 'ok' },
        tone: restricted ? 'warn' : 'ok',
        sub: restricted ? 'Có điều kiện thanh toán / hội chẩn' : 'Cột ghi chú trống',
      },
    ],
    slices: [
      { key: 'oral', label: 'Đường uống', value: routes.oral, color: '#0d9488' },
      { key: 'inject', label: 'Tiêm / truyền', value: routes.inject, color: '#2563eb' },
      { key: 'other', label: 'Ngoài / khác', value: routes.other, color: '#d97706' },
    ],
  }
}

export function VssMetrics({ items, tt20Index }) {
  const m = useMemo(() => computeVssMetrics(items, tt20Index), [items, tt20Index])
  return (
    <MetricsPanel
      title="Thanh toán BHYT"
      stats={m.stats}
      chartTitle="Cơ cấu đường dùng"
      chart={<DonutChart slices={m.slices} />}
    />
  )
}
