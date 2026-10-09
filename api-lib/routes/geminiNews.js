import { requireUser, json, readJson } from '../auth.js'
import { analyzeNews, NEWS_MODEL, NEWS_PROMPT_VERSION } from '../../lib/regulatory/onDemand.js'
import { createHash, randomUUID } from 'node:crypto'
import { supabaseAsUser, supabaseAsServiceRole } from '../supabaseClient.js'
import { createFetcher } from '../../lib/regulatory/crawler.js'
import { extractArticle } from '../../lib/regulatory/parser.js'
import { checked } from '../../lib/regulatory/store.js'
import { baoanCatalogItems } from '../baoanCatalog.js'

export async function storedNewsAnalysis({ userDb, writer, body, analyze = analyzeNews, apiKey, model = NEWS_MODEL }) {
  const deadline = Date.now() + 50_000
  const id = String(body.id || '').trim()
  if (!id || id.length > 100) throw Object.assign(new Error('Thiếu ID bài báo.'), { status: 400 })
  // Read the document through staff RLS before using the server writer.
  const docs = checked(await userDb.from('regulatory_documents').select('id,title,content,summary,source_url,source_id,published_at,content_hash').eq('id', id).limit(1))
  const doc = docs[0]
  if (!doc) throw Object.assign(new Error('Không tìm thấy bài hoặc bạn không có quyền đọc.'), { status: 404 })
  if (!doc.content && analyze === analyzeNews) {
    try {
      const html = await createFetcher(writer, fetch, Date.now() + 8000)(doc.source_url)
      const article = extractArticle(html, doc.source_url, { id: doc.source_id, url: doc.source_url }, doc.title)
      if (article?.content) {
        doc.content = article.content
        checked(await writer.from('regulatory_documents').update({ content: article.content }).eq('id', id))
      }
    } catch { /* URL Context can still read the original; fallback must state gaps. */ }
  }
  const input = { full_text_available: Boolean(doc.content), title: doc.title, content: doc.content || doc.summary, source_url: doc.source_url, publish_date: doc.published_at, catalog: baoanCatalogItems() }
  const hash = createHash('sha256').update(JSON.stringify({ ...input, content_hash: doc.content_hash, preferred_model: model })).digest('hex')
  const read = async () => checked(await userDb.from('regulatory_news_analyses').select('*').eq('document_id', id).limit(1))[0]
  const cached = await read()
  const valid = row => row?.result && row.input_hash === hash && Boolean(row.model) && row.prompt_version === NEWS_PROMPT_VERSION
  const response = row => ({ ...row.result, analyzed_at: row.analyzed_at, cached: true })
  if (body.wait_after) {
    if (valid(cached) && Date.parse(cached.analyzed_at) >= Date.parse(body.wait_after)) return response(cached)
    if (Date.parse(cached?.lease_until) > Date.now()) return { pending: true, retry_after: 3 }
    throw Object.assign(new Error('Phiên phân tích chưa hoàn tất. Bạn có thể thử cập nhật lại.'), { status: 502 })
  }
  if (!body.refresh && valid(cached)) return response(cached)
  const token = randomUUID()
  const claimed = checked(await writer.rpc('claim_news_analysis', { p_document_id: id, p_token: token }))
  if (!claimed) return { pending: true, retry_after: 3, ...(valid(cached) ? { previous: response(cached) } : {}) }
  try {
    // A concurrent request may have finished between our first read and claim.
    const latest = await read()
    if (!body.refresh && valid(latest)) return response(latest)
    const result = await analyze(input, { apiKey, model, deadline, groqApiKey: process.env.GROQ_API_KEY, openrouterApiKey: process.env.OPENROUTER_API_KEY })
    const analyzed_at = new Date().toISOString()
    const saved = checked(await writer.from('regulatory_news_analyses').update({ result, input_hash: hash, model: result.model || model, prompt_version: NEWS_PROMPT_VERSION, analyzed_at }).eq('document_id', id).eq('lease_token', token).select('document_id'))
    if (!saved.length) throw Object.assign(new Error('Phiên phân tích đã hết hạn; vui lòng tải lại.'), { status: 409 })
    return { ...result, analyzed_at, cached: false }
  } finally {
    // Preserve successful JSON when a refresh fails. Only release our own lease.
    await writer.from('regulatory_news_analyses').update({ lease_until: null, lease_token: null }).eq('document_id', id).eq('lease_token', token)
  }
}

export default async function handler(req, res) {
  try {
    const { accessToken } = await requireUser(req)
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return json(res, 405, { error: 'Method not allowed' })
    }
    const result = await storedNewsAnalysis({ userDb: supabaseAsUser(accessToken), writer: supabaseAsServiceRole(), body: await readJson(req), apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_NEWS_MODEL || NEWS_MODEL })
    return json(res, result.pending ? 202 : 200, result)
  } catch (e) {
    const status = e.status || 500
    return json(res, status, { error: status === 500 ? 'Chưa phân tích được tin. Vui lòng thử lại.' : e.message })
  }
}
