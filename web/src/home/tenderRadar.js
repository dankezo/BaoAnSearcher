import { resolveBidStatusFromRow } from '../bidStatus.js'

const DAY = 86400000

export function parseDateMs(raw) {
  if (raw == null || raw === '') return null
  const s = String(raw).trim()
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) {
    const t = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime()
    return Number.isFinite(t) ? t : null
  }
  const t = Date.parse(s.replace(' ', 'T').slice(0, 19))
  return Number.isFinite(t) ? t : null
}

export function classifyTender(row, now = Date.now()) {
  const bid = resolveBidStatusFromRow(row, now)
  const close = parseDateMs(row?.close_date)
  const pub = parseDateMs(row?.published)
  const isOpen = bid.key === 'open'
  const match = row?.baoan_match === 'exact' || row?.baoan_match === 'near'
  const fresh = pub != null && now - pub >= 0 && now - pub < 7 * DAY
  const closing = isOpen && close != null && close >= now && close - now < 7 * DAY
  return { isOpen, match, fresh, closing, close, pub, bid }
}

export function countdownLabel(close, now = Date.now()) {
  if (close == null) return 'Chưa có hạn đóng'
  const ms = close - now
  if (ms < 0) return 'Đã đóng thầu'
  const days = Math.floor(ms / DAY)
  const hours = Math.floor((ms % DAY) / 3600000)
  if (days >= 1) return `Còn ${days} ngày ${hours} giờ`
  const mins = Math.floor((ms % 3600000) / 60000)
  return `Còn ${hours} giờ ${mins} phút`
}

export function moneyLabel(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return 'Chưa có giá kế hoạch'
  if (n >= 1e9) return `${(n / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tỷ`
  return `${Math.round(n).toLocaleString('vi-VN')} đ`
}

export function techGroup(row) {
  const groups = [...new Set((row?.scope_lines || []).map(line => line.group).filter(Boolean))]
  if (groups.length) return groups.slice(0, 3).join(' · ')
  return row?.bid_form || 'Chưa có nhóm kỹ thuật'
}

export function mergeTenders(openItems = [], recentItems = []) {
  const map = new Map()
  for (const row of [...openItems, ...recentItems]) {
    const key = String(row?.tender_no || row?.notify_id || row?.name || '')
    if (!key || map.has(key)) continue
    map.set(key, row)
  }
  return [...map.values()]
}

function tenderKey(row) {
  return String(row?.tender_no || row?.notify_id || row?.name || '')
}

export function radarView(openItems = [], recentItems = [], mode, now = Date.now()) {
  const open = openItems.filter(row => classifyTender(row, now).isOpen)
  const matched = open.filter(row => classifyTender(row, now).match)
  const fresh = []
  const seenFresh = new Set()
  for (const row of [...recentItems, ...openItems]) {
    const key = tenderKey(row)
    if (!key || seenFresh.has(key)) continue
    seenFresh.add(key)
    if (classifyTender(row, now).fresh) fresh.push(row)
  }
  const merged = mergeTenders(openItems, recentItems)
  const closing = merged
    .filter(row => classifyTender(row, now).closing)
    .sort((a, b) => (parseDateMs(a.close_date) ?? Number.POSITIVE_INFINITY) - (parseDateMs(b.close_date) ?? Number.POSITIVE_INFINITY))
  const list = mode === 'match' ? matched : mode === 'fresh' ? fresh : mode === 'closing' ? closing : mode === 'open' ? open : []
  return {
    counts: { open: open.length, match: matched.length, fresh: fresh.length, closing: closing.length },
    list,
    fresh,
    closing,
    loaded: merged.length,
    publishedKnown: merged.some(row => parseDateMs(row?.published) != null),
    closeKnown: merged.some(row => parseDateMs(row?.close_date) != null),
  }
}
