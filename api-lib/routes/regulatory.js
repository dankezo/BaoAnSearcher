import { requireUser, json } from '../auth.js'
import { createClient } from '@supabase/supabase-js'
import { isAdmin, listDocuments, relatedDocuments, markRead, saveEntity, sourceStatus } from '../../lib/regulatory/store.js'
import { brief } from '../../lib/regulatory/brief.js'

async function bodyJson(req) {
  if (req.body && typeof req.body === 'object') {
    if (JSON.stringify(req.body).length > 24000) throw Object.assign(new Error('Nội dung quá lớn.'), { status: 413 })
    return req.body
  }
  let text = ''
  for await (const chunk of req) { text += chunk; if (text.length > 24000) throw Object.assign(new Error('Nội dung quá lớn.'), { status: 413 }) }
  try { return JSON.parse(text || '{}') } catch { throw Object.assign(new Error('JSON không hợp lệ.'), { status: 400 }) }
}
export default async function handler(req, res) {
  try {
    const { user, accessToken } = await requireUser(req)
    const db = createClient(process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
      process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${accessToken}` } }, auth: { persistSession: false, autoRefreshToken: false } })
    if (req.method === 'GET') {
      const params = Object.fromEntries(new URL(req.url, 'https://app.baoanpharma.com').searchParams)
      if (params.view === 'brief') return json(res, 200, { ...await brief(db), canEdit: isAdmin(user) })
      if (params.view === 'sources') {
        return json(res, 200, { ...await sourceStatus(db), canEdit: isAdmin(user) })
      }
      if (params.related) return json(res, 200, { items: await relatedDocuments(db, params.related) })
      return json(res, 200, { ...await listDocuments(db, params, user.id), canEdit: isAdmin(user) })
    }
    if (req.method === 'POST') {
      const body = await bodyJson(req)
      if (body.action === 'read') {
        if (typeof body.read !== 'boolean' || typeof body.id !== 'string') return json(res, 400, { error: 'Thiếu mã văn bản hoặc trạng thái đọc.' })
        await markRead(db, user.id, body.id, body.read)
        return json(res, 200, { ok: true })
      }
      return json(res, 200, await saveEntity(db, user, body.entity, body.data || {}))
    }
    res.setHeader('Allow', 'GET, POST'); return json(res, 405, { error: 'Method not allowed' })
  } catch (e) {
    console.error('regulatory', e.status || 500, e.message)
    return json(res, e.status || 500, { error: e.status ? e.message : 'Chưa tải được dữ liệu pháp luật. Vui lòng thử lại.' })
  }
}
