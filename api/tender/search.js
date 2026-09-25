/**
 * POST /api/tender/search
 * Body: { kind: 'vss'|'dav'|'msc_prices'|'msc_tenders', filters, page, size }
 * Auth: Bearer <supabase access_token>
 */
import { requireUser, json, readJson } from '../lib/auth.js'
import { getTurso, fold } from '../lib/turso.js'
import { mapTursoItems } from '../lib/mapRow.js'

function words(q) {
  return fold(q || '').trim().split(/\s+/).filter(Boolean)
}

async function searchVss(db, filters, page, size) {
  const f = filters || {}
  const where = ['1=1']
  const args = []

  for (const w of words(f.q)) {
    where.push('search LIKE ?')
    args.push(`%${w}%`)
  }
  const like = (col, v) => {
    if (v == null || String(v).trim() === '') return
    where.push(`${col} LIKE ?`)
    args.push(`%${String(v).trim()}%`)
  }
  like('hoatchat', f.hoatchat)
  like('sodk', f.sodk)
  like('loai', f.loai)
  like('nhomthau', f.nhomthau)
  like('loai_thau', f.loai_thau)
  like('duongdung', f.duongdung)
  like('ma_tinh', f.ma_tinh)
  like('nuocsx', f.nuocsx)
  if (f.nam != null && String(f.nam).trim() !== '') {
    const n = parseInt(String(f.nam).trim(), 10)
    if (!Number.isNaN(n)) {
      where.push('nam = ?')
      args.push(n)
    }
  }
  if (f.tuNgay) {
    where.push('(tungay_hd IS NULL OR tungay_hd >= ?)')
    args.push(String(f.tuNgay))
  }
  if (f.denNgay) {
    where.push('(tungay_hd IS NULL OR tungay_hd <= ?)')
    args.push(String(f.denNgay))
  }

  const wsql = where.join(' AND ')
  const countRs = await db.execute({
    sql: `SELECT COUNT(*) AS c FROM vss_bids WHERE ${wsql}`,
    args,
  })
  const total = Number(countRs.rows[0]?.c || 0)
  const offset = Math.max(0, page) * size
  const dataRs = await db.execute({
    sql: `SELECT * FROM vss_bids WHERE ${wsql} ORDER BY tungay_hd DESC, fingerprint LIMIT ? OFFSET ?`,
    args: [...args, size, offset],
  })
  return { total, page, size, items: dataRs.rows }
}

async function searchDav(db, filters, page, size) {
  const f = filters || {}
  const where = ['1=1']
  const args = []
  for (const w of words(f.q)) {
    where.push('search LIKE ?')
    args.push(`%${w}%`)
  }
  const like = (col, v) => {
    if (!v || !String(v).trim()) return
    where.push(`${col} LIKE ?`)
    args.push(`%${String(v).trim()}%`)
  }
  like('ten_thuoc', f.tenThuoc)
  like('so_dang_ky', f.soDangKy)
  like('hoat_chat', f.hoatChat)
  like('dang_bao_che', f.dangBaoChe)
  like('cty_san_xuat', f.sanXuat)
  like('cty_dang_ky', f.dangKy)
  like('nuoc_san_xuat', f.nuocSanXuat)
  const rawTags = f.tags ?? f.selectedTags
  if (rawTags != null) {
    const tags = (Array.isArray(rawTags) ? rawTags : String(rawTags).split(','))
      .map((t) => String(t).trim())
      .filter(Boolean)
    if (tags.length === 0) {
      return { total: 0, page, size, items: [] }
    }
    where.push(`tag_id IN (${tags.map(() => '?').join(',')})`)
    args.push(...tags)
  }
  const wsql = where.join(' AND ')
  const countRs = await db.execute({
    sql: `SELECT COUNT(*) AS c FROM dav_drugs WHERE ${wsql}`,
    args,
  })
  const total = Number(countRs.rows[0]?.c || 0)
  const offset = Math.max(0, page) * size
  const dataRs = await db.execute({
    sql: `SELECT * FROM dav_drugs WHERE ${wsql} ORDER BY ngay_gia_han DESC, id LIMIT ? OFFSET ?`,
    args: [...args, size, offset],
  })
  return { total, page, size, items: dataRs.rows }
}

async function searchMsc(db, kind, filters, page, size) {
  const table = kind === 'tenders' || kind === 'msc_tenders' ? 'msc_tenders' : 'msc_prices'
  const f = filters || {}
  const where = ['1=1']
  const args = []
  for (const w of words(f.q)) {
    where.push('search LIKE ?')
    args.push(`%${w}%`)
  }
  const wsql = where.join(' AND ')
  const countRs = await db.execute({
    sql: `SELECT COUNT(*) AS c FROM ${table} WHERE ${wsql}`,
    args,
  })
  const total = Number(countRs.rows[0]?.c || 0)
  const offset = Math.max(0, page) * size
  const dataRs = await db.execute({
    sql: `SELECT * FROM ${table} WHERE ${wsql} ORDER BY published DESC, source_id LIMIT ? OFFSET ?`,
    args: [...args, size, offset],
  })
  return { total, page, size, items: dataRs.rows }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' })
  }
  try {
    await requireUser(req)
    const body = await readJson(req)
    const kind = String(body.kind || 'vss').toLowerCase()
    const page = Math.max(0, parseInt(body.page, 10) || 0)
    const size = Math.min(200, Math.max(1, parseInt(body.size, 10) || 100))
    const db = getTurso()
    let payload
    if (kind === 'dav') payload = await searchDav(db, body.filters, page, size)
    else if (kind === 'msc' || kind === 'msc_prices' || kind === 'prices') {
      payload = await searchMsc(db, 'prices', body.filters, page, size)
    } else if (kind === 'msc_tenders' || kind === 'tenders') {
      payload = await searchMsc(db, 'tenders', body.filters, page, size)
    } else {
      payload = await searchVss(db, body.filters, page, size)
    }
    payload = { ...payload, items: mapTursoItems(payload.items) }
    return json(res, 200, payload)
  } catch (e) {
    const status = e.status || 500
    return json(res, status, { error: e.message || String(e) })
  }
}
