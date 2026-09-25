/** MSC tender bid-status codes to display label + tone. */
import { createElement } from 'react'

export const BID_STATUS_MAP = {
  CNTTT: {
    code: 'CNTTT',
    label: 'Có nhà thầu trúng thầu',
    tone: 'success',
    key: 'won',
  },
  DXT: {
    code: 'DXT',
    label: 'Đang xét thầu',
    tone: 'warning',
    key: 'review',
  },
  DHTBMT: {
    code: 'DHTBMT',
    label: 'Đã hủy TBMT',
    tone: 'danger',
    key: 'cancelled',
  },
}

const OPEN = {
  code: 'OPEN',
  label: 'Đang mời thầu',
  tone: 'info',
  key: 'open',
  rowClass: 'bid-open',
}

const OTHER = {
  code: '',
  label: 'Không trúng thầu / Khác',
  tone: 'neutral',
  key: 'other',
  rowClass: '',
}

function parseCloseMs(closeTime) {
  if (closeTime == null || closeTime === '') return null
  if (typeof closeTime === 'number' && Number.isFinite(closeTime)) return closeTime
  const s = String(closeTime).trim()
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) {
    const t = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime()
    return Number.isFinite(t) ? t : null
  }
  const t = Date.parse(s.replace(' ', 'T').slice(0, 19))
  return Number.isFinite(t) ? t : null
}

/**
 * Resolve MSC tender status for UI.
 * Prefer status_code (status_label often empty in Turso).
 * Empty + past close -> treat as DXT; empty + future/unknown close -> OPEN.
 */
export function resolveBidStatus(rawStatus, closeTime, now = Date.now()) {
  const code = String(rawStatus ?? '').trim().toUpperCase()
  if (code && BID_STATUS_MAP[code]) {
    return { ...BID_STATUS_MAP[code], rowClass: '', inferred: false }
  }
  if (!code) {
    const close = parseCloseMs(closeTime)
    if (close != null && close < now) {
      return { ...BID_STATUS_MAP.DXT, rowClass: '', inferred: true }
    }
    return { ...OPEN, inferred: close == null }
  }
  return { ...OTHER, code, inferred: false }
}

/** Resolve from a tender row (status_code first). */
export function resolveBidStatusFromRow(row, now = Date.now()) {
  const code = String(row?.status_code ?? '').trim()
  if (code) return resolveBidStatus(code, row?.close_date, now)
  const label = String(row?.status_label ?? '').trim()
  if (label && BID_STATUS_MAP[label.toUpperCase()]) {
    return resolveBidStatus(label, row?.close_date, now)
  }
  return resolveBidStatus('', row?.close_date, now)
}

export function StatusBadge({ status, closeTime, row, className = '' }) {
  const resolved = row
    ? resolveBidStatusFromRow(row)
    : resolveBidStatus(status, closeTime)
  const cls = ('status-badge tone-' + resolved.tone + (className ? ' ' + className : '')).trim()
  return createElement(
    'span',
    {
      className: cls,
      title: resolved.code && resolved.code !== 'OPEN' ? resolved.code : undefined,
      'data-code': resolved.code || undefined,
    },
    createElement('span', { className: 'status-dot', 'aria-hidden': true }),
    resolved.label,
  )
}
