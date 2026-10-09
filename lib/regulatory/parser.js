import { load } from 'cheerio'
import { createHash } from 'node:crypto'
import { fold, safeUrl, searchText } from './domain.js'

export const hash = s => createHash('sha256').update(s).digest('hex')
const clean = s => String(s || '').replace(/\s+/g, ' ').trim()
export function hasOfficialNewsListing(body, source) {
  if (new URL(source.url).hostname !== 'baochinhphu.vn') return false
  const $ = load(body)
  return $('a[href]').filter((_,a)=>/-\d{15,}\.htm$/.test($(a).attr('href')||'')).length >= 3
}
export function categoryOf(text) {
  const s = fold(text)
  if (/tuong duong sinh hoc|\bbe\b/.test(s)) return 'BE'
  if (/dau thau|trung thau|mua sam|nhom thuoc|lua chon nha thau|ho so moi thau|thoa thuan khung|dam phan gia/.test(s)) return 'Đấu thầu'
  if (/bhyt|bao hiem y te|thanh toan.*thuoc/.test(s)) return 'BHYT'
  return 'Khác'
}
export function relevant(text, keywords = '') {
  const s = fold(String(text).replace(/\bthuộc\b/gi, ' '))
  if (/\bthuoc\b|\bduoc pham\b|luat duoc|nganh duoc|kinh doanh duoc|cong nghiep duoc|bao hiem y te|luat dau thau|dau thau|trung thau|lua chon nha thau|mua sam tap trung|ho so moi thau|thoa thuan khung/.test(s) && !/thuoc la|thuoc dien|thuoc nhom/.test(s)) return true
  return /tuong duong sinh hoc|biet duoc goc|qd.qld|thu hoi.*thuoc|thuoc.*thu hoi|dau thau.*thuoc|thuoc.*dau thau|bhyt.*thuoc|thuoc.*bhyt|thong tu.*(byt|bo y te)|quyet dinh.*(thuoc|duoc)/.test(s) || keywords.split(',').filter(Boolean).some(k => fold(k).split(/\s+/).every(w => s.includes(w)))
}
export function codeOf(title) {
  const match = title.match(/\b\d{1,5}\s*\/\s*(?:(?:20\d{2})\s*\/\s*)?(?:TT(?:LT)?|QĐ|QD|QH|NĐ|ND)[\wĐđ\d\/-]*(?:\s*-\s*[A-ZĐ]{2,8})?/u)
  return match ? match[0].replace(/\s/g, '') : ''
}
export function dateOf(raw) {
  const text = clean(raw)
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})(?=T|\b)/)
  const vi = text.match(/\b(\d{1,2})[\/.](\d{1,2})[\/.](20\d{2})\b/)
  const parts = iso ? [iso[1], iso[2], iso[3]] : vi ? [vi[3], vi[2].padStart(2, '0'), vi[1].padStart(2, '0')] : null
  if (!parts) {
    // RFC 822 dates used by RSS. Do not guess arbitrary free-text dates.
    if (/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s|^\d{1,2}\s[A-Z][a-z]{2}\s\d{4}/.test(text)) {
      const stamp = Date.parse(text)
      if (Number.isFinite(stamp)) return new Date(stamp).toISOString().slice(0, 10)
    }
    return null
  }
  const value = parts.join('-'), stamp = Date.parse(value)
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value ? value : null
}
export function extractLinks(body, source) {
  const $ = load(body, source.kind === 'rss' ? { xml: true } : undefined)
  const candidates = []
  if (source.kind === 'rss') $('item, entry').each((_, el) => {
    const title = clean($(el).find('title').first().text())
    const link = $(el).find('link').first()
    candidates.push({ title, url: link.attr('href') || link.text(), published_at: dateOf($(el).find('pubDate, published, updated').first().text()) })
  })
  else $('a[href]').each((_, el) => { candidates.push({ title: clean($(el).text() || $(el).attr('title')), url: $(el).attr('href') }) })
  const seen = new Set()
  return candidates.flatMap(item => {
    try {
      const url = safeUrl(new URL(item.url, source.url).href, true)
      if (new URL(url).hostname !== new URL(source.url).hostname || !relevant(item.title, source.keywords) || item.title.length < 25 || /\.(pdf|docx?|xlsx?)(\?|$)/i.test(url) || seen.has(url) || url === source.url) return []
      seen.add(url); return [{ ...item, url }]
    } catch { return [] }
  }).slice(0, 15)
}
export function extractArticle(body, url, source, fallbackTitle = '', fetchedAt = new Date().toISOString()) {
  const $ = load(body)
  const title = clean($('meta[property="og:title"]').attr('content') || $('h1').first().text() || fallbackTitle).slice(0, 600)
  if (!title || !relevant(title, source.keywords)) return null
  const intro = clean($('.detail-sapo').text() || $('.description p').first().text() || $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || $('article p').first().text())
  const bodyExcerpt = clean($('.detail-content p, article p').slice(0, 6).map((_,e)=>$(e).text()).get().join(' '))
  const summary = clean(intro + (bodyExcerpt && !intro.includes(bodyExcerpt) ? ' ' + bodyExcerpt : '')).slice(0, 1200)
  const published = $('meta[property="article:published_time"]').attr('content') || $('meta[name="pubdate"]').attr('content') || $('time').first().attr('datetime') || $('.date, .news-date, .time, .ngay-dang').first().text()
  // Do not infer issue or legal-effect dates from a news publication date.
  const articleText = clean($('article, .news-detail, .detail-content, .description').text()).slice(0, 100_000)
  const ownCode = codeOf(title)
  const escapedCode = ownCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const issued = articleText.match(/ngày ban hành\s*[:：]?\s*(\d{1,2}[\/.]\d{1,2}[\/.]20\d{2})/i)
    || (ownCode ? articleText.match(new RegExp(escapedCode + '\\s+ngày\\s+(\\d{1,2}[/.]\\d{1,2}[/.]20\\d{2})', 'i')) : null)
  let pdf = ''
  $('a[href]').each((_, a) => {
    if (!pdf && /\.pdf(?:\?|$)/i.test($(a).attr('href'))) {
      try { pdf = safeUrl(new URL($(a).attr('href'), url).href) } catch { /* skip invalid source links */ }
    }
  })
  const row = { id: hash(url), title, code: codeOf(title), category: categoryOf(title), summary: summary || 'Chưa trích được tóm tắt. Mở nguồn để đọc nội dung.', content: articleText, source_id: source.id, source_url: url, pdf_url: pdf, issued_at: issued ? dateOf(issued[1]) : null, published_at: dateOf(published), effective_at: null, legal_status: /du thao|de xuat|lay y kien/.test(fold(title+' '+intro)) ? 'draft' : 'unknown', reviewed_at: null, review_source: '', review_note: 'Thu thập tự động; chưa được chuyên viên đối chiếu hiệu lực.', fetched_at: fetchedAt, content_hash: hash(title + summary + articleText + published), origin: 'crawl', updated_at: fetchedAt }
  row.search_text = searchText(row)
  return row
}
