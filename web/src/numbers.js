// API decimals and legacy VSS Vietnamese numbers have different separators.
export function numberValue(value, vietnamese = false) {
  if (value == null || value === '' || typeof value === 'boolean') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  let text = String(value).trim().replace(/\s/g, '')
  if (!text) return null
  if (text.includes(',') && text.includes('.')) text = text.lastIndexOf(',') > text.lastIndexOf('.') ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '')
  else if (text.includes(',')) text = vietnamese && /^-?\d{1,3}(,\d{3})+$/.test(text) ? text.replace(/,/g, '') : text.replace(',', '.')
  else if (vietnamese && /^-?\d{1,3}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, '')
  const number = Number(text)
  return Number.isFinite(number) ? number : null
}

export function formatNumber(value) {
  const number = numberValue(value)
  return number == null ? value ?? '' : number.toLocaleString('vi-VN', { maximumFractionDigits: 12 })
}

export function lineValue(price, quantity) {
  const p = numberValue(price), q = numberValue(quantity)
  const total = p == null || q == null ? null : p * q
  return Number.isFinite(total) ? total : null
}
