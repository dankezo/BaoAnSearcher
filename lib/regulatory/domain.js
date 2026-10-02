export const categories = ['Đấu thầu', 'BE', 'BHYT', 'Khác']
export const statuses = { unknown: 'Chưa xác minh', active: 'Còn hiệu lực', expired: 'Hết hiệu lực', replaced: 'Bị thay thế', draft: 'Dự thảo', partial: 'Hết hiệu lực một phần' }
export const fold = s => String(s ?? '').toLowerCase().replace(/đ/g, 'd').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
export function searchText(row) { return fold([row.code, row.title, row.summary, row.category, row.review_note].join(' ')).replace(/[^a-z0-9]+/g, ' ').trim() }
export function queryWords(q) {
  return searchText({ title: String(q || '').slice(0, 200).replace(/\bTT\s*(?=\d)/gi, '').replace(/\bBHYT\b/gi, 'bảo hiểm y tế').replace(/\bBE\b/gi, 'tương đương sinh học') }).split(/\s+/).filter(Boolean).slice(0, 18)
}
export function isNew(row, now = Date.now()) {
  const raw = row.published_at || row.issued_at
  if (!raw) return false
  const stamp = Date.parse(raw.length === 10 ? `${raw}T00:00:00+07:00` : raw)
  return Number.isFinite(stamp) && stamp <= now && now - stamp < 30 * 86400000
}
export function safeUrl(value, crawl = false) {
  let url
  try { url = new URL(String(value)) } catch { throw Object.assign(new Error('URL không hợp lệ.'), { status: 400 }) }
  const allowed = ['moh.gov.vn', 'dav.gov.vn', 'thuvienphapluat.vn', 'baochinhphu.vn']
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
    (crawl && !allowed.some(h => url.hostname === h || url.hostname === `www.${h}`))) {
    throw Object.assign(new Error('Nguồn crawl phải dùng HTTPS và thuộc Bộ Y tế, DAV, Báo Chính phủ hoặc Thư viện Pháp luật.'), { status: 400 })
  }
  url.hash = ''; return url.href
}
export function validDate(value) {
  if (!value) return null
  const s = String(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0, 10) !== s) throw Object.assign(new Error('Ngày phải theo YYYY-MM-DD.'), { status: 400 })
  return s
}
export function validateDocument(body) {
  const out = {}
  for (const [key, max] of Object.entries({ title: 600, code: 100, summary: 1200, review_note: 2000 })) out[key] = String(body[key] || '').trim().slice(0, max)
  if (!out.title) throw Object.assign(new Error('Cần tên văn bản.'), { status: 400 })
  out.category = categories.includes(body.category) ? body.category : 'Khác'
  out.source_url = safeUrl(body.source_url)
  out.pdf_url = body.pdf_url ? safeUrl(body.pdf_url) : ''
  out.review_source = body.review_source ? safeUrl(body.review_source) : ''
  for (const k of ['issued_at', 'published_at', 'effective_at', 'expires_at', 'reviewed_at']) out[k] = validDate(body[k])
  out.legal_status = Object.hasOwn(statuses, body.legal_status) ? body.legal_status : 'unknown'
  if (out.legal_status !== 'unknown' && (!out.reviewed_at || !out.review_source || !out.review_note)) throw Object.assign(new Error('Cần ngày đối chiếu, nguồn căn cứ và ghi chú khi xác nhận hiệu lực.'), { status: 400 })
  if (out.reviewed_at && out.reviewed_at > new Date().toISOString().slice(0, 10)) throw Object.assign(new Error('Ngày đối chiếu không được ở tương lai.'), { status: 400 })
  out.search_text = searchText(out)
  return out
}
