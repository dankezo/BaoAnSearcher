import robotsParser from 'robots-parser'
import { randomUUID } from 'node:crypto'
import { safeUrl } from './domain.js'
import { extractLinks, extractArticle, hasOfficialNewsListing } from './parser.js'
import { checked } from './store.js'

const UA = 'BaoAnRegulatoryBot/1.0 (+https://app.baoanpharma.com)'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const now = () => new Date().toISOString()
export async function saveCrawled(db, row) {
  return checked(await db.rpc('regulatory_ingest', { p_row: row }))
}

export function createFetcher(db, fetchImpl = fetch, deadline = Infinity) {
  let lastRequest = 0
  const robots = new Map()
  let minDelay = 2500
  async function raw(url, headers = {}) {
    safeUrl(url, true)
    const delay = Math.max(0, minDelay - (Date.now() - lastRequest))
    if (Date.now() + delay + 1000 > deadline) throw new Error('Hết thời gian lượt thu thập; tiếp tục ở lượt sau.')
    if (delay) await sleep(delay)
    lastRequest = Date.now()
    let response
    try { response = await fetchImpl(url, { redirect: 'manual', headers: { 'User-Agent': UA, Accept: 'text/html,application/rss+xml,application/xml,text/plain', ...headers }, signal: AbortSignal.timeout(Math.max(1, Math.min(18000, deadline - Date.now()))) }) }
    catch (e) { throw new Error(`Kết nối nguồn thất bại: ${e.cause?.code || e.name}.`) }
    if (response.status >= 300 && response.status < 400 && response.status !== 304) {
      const next = safeUrl(new URL(response.headers.get('location'), url).href, true)
      if (new URL(next).hostname !== new URL(url).hostname) throw new Error('Nguồn chuyển sang tên miền khác; cần quản trị đối chiếu URL.')
      throw new Error(`Nguồn chuyển hướng; cập nhật URL nguồn thành ${next}`)
    }
    if (Number(response.headers.get('content-length') || 0) > 2_000_000) { await response.body?.cancel(); throw new Error('Trang vượt giới hạn 2 MB.') }
    let text = '', size = 0
    const reader = response.body?.getReader(), decoder = new TextDecoder()
    if (reader) {
      try { while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > 2_000_000) { await reader.cancel(); throw new Error('Trang vượt giới hạn 2 MB.') } text += decoder.decode(chunk.value, { stream: true }) } text += decoder.decode() }
      finally { reader.releaseLock() }
    }
    return { response, text }
  }
  return async url => {
    const origin = new URL(safeUrl(url, true)).origin
    if (!robots.has(origin)) {
      const robotUrl = `${origin}/robots.txt`
      const { response, text } = await raw(robotUrl)
      if (!response.ok && response.status !== 404) throw new Error(`Không kiểm tra được robots.txt (HTTP ${response.status}); tạm dừng nguồn.`)
      const policy = robotsParser(robotUrl, response.status === 404 ? '' : text)
      if (response.ok && /<html/i.test(text)) throw new Error('robots.txt trả về HTML; cần kiểm tra nguồn.')
      robots.set(origin, policy)
      minDelay = Math.max(2500, (Number(policy.getCrawlDelay(UA)) || 0) * 1000)
      if (minDelay > 60000) throw new Error('Crawl-delay lớn hơn ngân sách lượt chạy; cần lịch riêng.')
    }
    if (robots.get(origin).isAllowed(url, UA) === false) throw new Error('robots.txt không cho phép thu thập đường dẫn này.')
    const cached = checked(await db.from('regulatory_http_cache').select('*').eq('url', url).maybeSingle())
    if (cached && Date.now() - Date.parse(cached.checked_at) < 6 * 3600000) return cached.body
    const headers = {}
    if (cached?.etag) headers['If-None-Match'] = cached.etag
    if (cached?.modified) headers['If-Modified-Since'] = cached.modified
    const { response, text } = await raw(url, headers)
    if (response.status === 304 && cached) {
      checked(await db.from('regulatory_http_cache').update({ checked_at: now() }).eq('url', url)); return cached.body
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}; giữ dữ liệu cũ và thử lại ở lượt sau.`)
    if (!/text|xml|html/i.test(response.headers.get('content-type') || '')) throw new Error('Nguồn không trả về HTML/RSS.')
    checked(await db.from('regulatory_http_cache').upsert({ url, body: text, etag: response.headers.get('etag'), modified: response.headers.get('last-modified'), checked_at: now() }))
    return text
  }
}

export async function crawlSource(db, source, options = {}) {
  const started = now(), id = randomUUID()
  const last = Date.parse(source.last_attempt || '')
  if (!options.force && Number.isFinite(last) && Date.now() - last < source.interval_hours * 3600000) return { source: source.id, state: 'skipped', previous_error: !!source.last_error, message: 'Chưa đến lịch nguồn.' }
  // Shared database lease prevents parallel CLI / daily processes from hitting the same source.
  const lease = checked(await db.rpc('regulatory_claim', { p_id: source.id, p_force: !!options.force }))
  if (!lease) return { source: source.id, state: 'skipped', message: 'Nguồn đang được thu thập hoặc chưa đến lịch.' }
  checked(await db.from('regulatory_runs').insert({ id, source_id: source.id, started_at: started, state: 'running' }))
  let count = 0, errors = [], state = 'ok', emptyListing = false
  try {
    const get = options.get || createFetcher(db, fetch, options.deadline || Infinity)
    const listing = await get(source.url)
    const links = extractLinks(listing, source)
    emptyListing = !links.length && hasOfficialNewsListing(listing, source)
    if (!links.length && !emptyListing) throw new Error('Không tìm thấy bài phù hợp; cần kiểm tra bộ lọc hoặc cấu trúc trang.')
    for (const item of links.slice(0, options.limit || 15)) {
      if (Date.now() > (options.deadline || Infinity)) { errors.push('Hết thời gian lượt thu thập; giữ phần đã lấy.'); break }
      try {
        const row = extractArticle(await get(item.url), item.url, source, item.title)
        if (!row) continue
        if (!row.published_at && item.published_at) row.published_at = item.published_at
        await saveCrawled(db, row); count++
      } catch (e) { errors.push(e.message); if (/HTTP (403|429)|robots/.test(e.message)) break }
    }
    if (errors.length) state = count ? 'partial' : 'error'
    if (!count && !errors.length && !emptyListing) { state = 'error'; errors.push('Không trích được bài phù hợp; dữ liệu cũ được giữ nguyên.') }
  } catch (e) { state = 'error'; errors.push(e.message) }
  finally {
    const message = errors.slice(0, 3).join(' | ').slice(0, 1200)
    checked(await db.from('regulatory_runs').update({ finished_at: now(), state, item_count: count, message }).eq('id', id))
    checked(await db.from('regulatory_sources').update({ lease_until: null, last_error: message || null, ...(['ok','partial'].includes(state) ? { last_success: now() } : {}) }).eq('id', source.id))
  }
  return { source: source.id, state, count, errors }
}
