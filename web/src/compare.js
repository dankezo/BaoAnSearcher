const KEY = 'baoan.compare'

export function requestCompare(detail) {
  const payload = { ...detail, at: Date.now() }
  try { sessionStorage.setItem(KEY, JSON.stringify(payload)) } catch { /* Storage may be blocked. */ }
  window.dispatchEvent(new CustomEvent('baoan-compare', { detail: payload }))
}

export function focusBaoAn(detail) {
  window.dispatchEvent(new CustomEvent('baoan-focus', { detail: { ...detail, at: Date.now() } }))
}

export function readCompare() {
  try { return JSON.parse(sessionStorage.getItem(KEY) || 'null') } catch { return null }
}
