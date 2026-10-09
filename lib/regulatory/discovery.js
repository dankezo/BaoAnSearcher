import { safeUrl } from './domain.js'
import { relevant } from './parser.js'

const TOTAL_BUDGET_MS = 20_000
const PROVIDER_BUDGET_MS = 12_000
const MAX_RESULTS = 6
const fold = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase()

function recentDate(value, now) {
  if (!value) return true
  const stamp = Date.parse(value)
  return Number.isFinite(stamp) && stamp <= now && now - stamp <= 30 * 86400000
}

function normalizeResults(results, source, now) {
  const hostname = new URL(source.url).hostname
  const seen = new Set()
  return results.flatMap(item => {
    const title = String(item?.title || '').replace(/\s+/g, ' ').trim().slice(0, 600)
    const rawUrl = item?.url || item?.link
    const published = item?.publishedDate || item?.published_date || item?.published_at || item?.date || ''
    if (!title || !rawUrl || !recentDate(published, now) || !relevant(title, source.keywords)) return []
    try {
      const url = safeUrl(rawUrl, true)
      if (new URL(url).hostname !== hostname || /\.pdf(?:$|\?)/i.test(new URL(url).pathname) || seen.has(url)) return []
      seen.add(url)
      return [{ title, url, published_at: published ? new Date(published).toISOString().slice(0, 10) : null }]
    } catch { return [] }
  }).slice(0, MAX_RESULTS)
}

function queryFor(source) {
  const host = new URL(source.url).hostname
  const keywords = String(source.keywords || 'đấu thầu thuốc,BHYT,tương đương sinh học').split(',').map(value=>value.trim()).filter(Boolean).slice(0,8)
  return { host, query: `site:${host} (${keywords.map(value=>`"${value.replace(/"/g,'')}"`).join(' OR ')})`.trim() }
}

async function request(fetchImpl, url, init, deadline) {
  const timeout = Math.min(PROVIDER_BUDGET_MS, deadline - Date.now())
  if (timeout <= 0) throw new Error('Discovery time budget exhausted.')
  const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeout) })
  if (!response.ok) throw new Error(`Discovery provider returned HTTP ${response.status}.`)
  return response.json()
}

async function exa(source, options) {
  const { host, query } = queryFor(source)
  const date = new Date(options.now - 30 * 86400000).toISOString()
  const data = await request(options.fetchImpl, 'https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': options.exaApiKey },
    body: JSON.stringify({ query, includeDomains: [host], startPublishedDate: date, numResults: MAX_RESULTS }),
  }, options.deadline)
  return data.results || []
}

async function jina(source, options) {
  const { query } = queryFor(source)
  const url = `https://s.jina.ai/${encodeURIComponent(query)}`
  const data = await request(options.fetchImpl, url, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${options.jinaApiKey}` },
  }, options.deadline)
  return data.data || data.results || []
}

export async function discoverLinks(source, {
  exaApiKey = process.env.EXA_API_KEY,
  jinaApiKey = process.env.JINA_API_KEY,
  fetchImpl = fetch,
  deadline = Date.now() + TOTAL_BUDGET_MS,
  now = Date.now(),
} = {}) {
  const stopAt = Math.min(deadline, Date.now() + TOTAL_BUDGET_MS)
  let attempted = false, errors = []
  for (const [provider, key, search] of [
    ['exa', exaApiKey, exa],
    ['jina', jinaApiKey, jina],
  ]) {
    if (!key || Date.now() >= stopAt) continue
    attempted = true
    try {
      const results = await search(source, { fetchImpl, [provider === 'exa' ? 'exaApiKey' : 'jinaApiKey']: key, deadline: stopAt, now })
      const links = normalizeResults(results, source, now)
      if (links.length) return { links, provider, attempted, message: '' }
      errors.push(`${provider}: no matching articles`)
    } catch {
      errors.push(`${provider}: request failed`)
    }
  }
  return { links: [], provider: '', attempted, message: errors.join('; ') }
}
