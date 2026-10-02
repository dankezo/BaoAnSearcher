import { randomUUID } from 'node:crypto'
import { queryWords, safeUrl, validateDocument } from './domain.js'
export const isAdmin = user => String(user?.email || '').toLowerCase() === 'admin@baoanpharma.com'
export function checked(result) {
  if (result.error) throw Object.assign(new Error(result.error.message), { status: result.error.code === '23505' ? 409 : result.error.code === '42501' ? 403 : 500 })
  return result.data
}
export async function listDocuments(db, params) {
  return checked(await db.rpc('regulatory_search', { p_words: queryWords(params.q), p_category: params.category || '', p_status: params.status || '', p_news: params.view === 'news', p_unread: params.unread === '1', p_page: Math.max(0, Math.min(10000, Number(params.page) || 0)) | 0 }))
}
export async function relatedDocuments(db, id) {
  const relations = checked(await db.from('regulatory_relations').select('relation,reason,related_id').eq('document_id', id).limit(6))
  if (relations.length) {
    const docs = checked(await db.from('regulatory_documents').select('*').in('id', relations.map(r => r.related_id)))
    return relations.flatMap(r => docs.filter(d => d.id === r.related_id).map(d => ({ ...d, ...r })))
  }
  const rows = checked(await db.from('regulatory_documents').select('category').eq('id', id).limit(1))
  if (!rows.length) return []
  return checked(await db.from('regulatory_documents').select('*').eq('category', rows[0].category).neq('id', id).order('issued_at', { ascending: false, nullsFirst: false }).limit(4)).map(d => ({ ...d, relation: 'related', reason: 'Cùng chủ đề; không có nghĩa là văn bản sửa đổi hoặc thay thế.' }))
}
export async function markRead(db, userId, id, read) {
  checked(read ? await db.from('regulatory_reads').upsert({ user_id: userId, document_id: id, read_at: new Date().toISOString() }, { onConflict: 'user_id,document_id' }) : await db.from('regulatory_reads').delete().eq('user_id', userId).eq('document_id', id))
}
export async function sourceStatus(db) {
  const [a, b] = await Promise.all([db.from('regulatory_sources').select('*').order('name'), db.from('regulatory_runs').select('*').order('started_at', { ascending: false }).limit(15)])
  return { items: checked(a), runs: checked(b) }
}
export async function saveEntity(db, user, entity, body) {
  if (!isAdmin(user)) throw Object.assign(new Error('Chỉ tài khoản quản trị được sửa nguồn và văn bản.'), { status: 403 })
  if (!['document', 'source'].includes(entity)) throw Object.assign(new Error('Loại dữ liệu không hợp lệ.'), { status: 400 })
  const id = body.id ? String(body.id).slice(0, 100) : randomUUID()
  let row
  if (entity === 'document') row = { ...validateDocument(body), origin: 'manual', updated_at: new Date().toISOString() }
  else {
    const name = String(body.name || '').trim().slice(0, 200)
    if (!name) throw Object.assign(new Error('Cần tên nguồn.'), { status: 400 })
    const url = safeUrl(body.url, true)
    row = { name, url, kind: body.kind === 'rss' ? 'rss' : 'html', enabled: !!body.enabled, official: /^(www\.)?((moh|dav)\.gov\.vn|baochinhphu\.vn)$/.test(new URL(url).hostname), interval_hours: Math.round(Math.max(6, Math.min(168, Number(body.interval_hours) || 24))), keywords: String(body.keywords || '').slice(0, 1000) }
  }
  const table = entity === 'document' ? 'regulatory_documents' : 'regulatory_sources'
  const result = body.id ? await db.from(table).update({ ...row, version: Number(body.version) + 1 }).eq('id', id).eq('version', Number(body.version)).select('id,version') : await db.from(table).insert({ ...row, id }).select('id,version')
  const rows = checked(result)
  if (!rows.length) throw Object.assign(new Error('Dữ liệu đã thay đổi. Tải lại trước khi lưu.'), { status: 409 })
  return rows[0]
}
