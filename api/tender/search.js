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

/** string | string[] | "a|b" → trimmed non-empty list */
function asList(v) {
  if (Array.isArray(v)) return v.map((x) => String(x ?? '').trim()).filter(Boolean)
  if (v == null || v === '') return []
  return String(v).split(/[|,;]+/).map((s) => s.trim()).filter(Boolean)
}

/** Expand N3 / 3 / Nhóm 3 → variants so multi-select does not false-match. */
function expandGroupTokens(v) {
  const out = []
  for (const raw of asList(v)) {
    const s = String(raw).trim()
    if (!s) continue
    out.push(s)
    const m = s.match(/^(?:n|nhom|nhóm)\s*([1-5])$/i) || s.match(/^([1-5])$/)
    if (m) {
      const n = m[1]
      out.push(`N${n}`, `n${n}`, n, `Nhóm ${n}`, `nhom ${n}`, `NHOM ${n}`)
    }
  }
  return [...new Set(out)]
}

function likeAny(where, args, col, v) {
  const vals = col === 'nhomthau' || col === 'group_name' ? expandGroupTokens(v) : asList(v)
  if (!vals.length) return
  // Prefer prefix/exact-ish for group codes (avoid LIKE '%3%' matching N13 / N30)
  if (col === 'nhomthau' || col === 'group_name') {
    const parts = []
    for (const x of vals) {
      if (/^[1-5]$/.test(x)) {
        // bare digit: exact only (LIKE '3%' would false-match)
        parts.push(`${col} = ?`)
        args.push(x)
      } else {
        parts.push(`${col} = ? OR ${col} LIKE ?`)
        args.push(x, `${x}%`)
      }
    }
    where.push(`(${parts.join(' OR ')})`)
    return
  }
  if (vals.length === 1) {
    where.push(`${col} LIKE ?`)
    args.push(`%${vals[0]}%`)
    return
  }
  where.push(`(${vals.map(() => `${col} LIKE ?`).join(' OR ')})`)
  for (const x of vals) args.push(`%${x}%`)
}

function eqAny(where, args, col, v, parseIntVal = false) {
  const vals = asList(v)
  if (!vals.length) return
  const parsed = parseIntVal
    ? vals.map((x) => parseInt(x, 10)).filter((n) => !Number.isNaN(n))
    : vals
  if (!parsed.length) return
  if (parsed.length === 1) {
    where.push(`${col} = ?`)
    args.push(parsed[0])
    return
  }
  where.push(`${col} IN (${parsed.map(() => '?').join(',')})`)
  args.push(...parsed)
}

async function searchVss(db, filters, page, size) {
  const f = filters || {}
  const where = ['1=1']
  const args = []

  for (const w of words(f.q)) {
    where.push('search LIKE ?')
    args.push(`%${w}%`)
  }
  likeAny(where, args, 'hoatchat', f.hoatchat)
  likeAny(where, args, 'sodk', f.sodk)
  likeAny(where, args, 'loai', f.loai)
  likeAny(where, args, 'nhomthau', f.nhomthau)
  likeAny(where, args, 'loai_thau', f.loai_thau)
  likeAny(where, args, 'duongdung', f.duongdung)
  likeAny(where, args, 'ma_tinh', f.ma_tinh)
  likeAny(where, args, 'nuocsx', f.nuocsx)
  eqAny(where, args, 'nam', f.nam, true)
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
  likeAny(where, args, 'ten_thuoc', f.tenThuoc)
  likeAny(where, args, 'so_dang_ky', f.soDangKy)
  likeAny(where, args, 'hoat_chat', f.hoatChat)
  likeAny(where, args, 'dang_bao_che', f.dangBaoChe)
  likeAny(where, args, 'cty_san_xuat', f.sanXuat)
  likeAny(where, args, 'cty_dang_ky', f.dangKy)
  likeAny(where, args, 'nuoc_san_xuat', f.nuocSanXuat)
  const rawTags = f.tags ?? f.selectedTags
  if (rawTags != null) {
    const tags = asList(rawTags)
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
    sql: `SELECT * FROM dav_drugs WHERE ${wsql} ORDER BY ngay_cap DESC, ngay_gia_han DESC, id LIMIT ? OFFSET ?`,
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
  const cols = [
    ['name', f.name],
    ['ingredient', f.ingredient],
    ['registration', f.registration],
    ['manufacturer', f.manufacturer],
    ['province', f.province],
    ['tender_no', f.tender_no],
    ['buyer', f.buyer],
    ['winner', f.winner],
    ['group_name', f.group_name],
    ['medicine_type', f.medicine_type],
  ]
  for (const [col, v] of cols) likeAny(where, args, col, v)

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
    // Full mode may request large pages; hard-cap keeps Turso responses bounded.
    const size = Math.min(2000, Math.max(1, parseInt(body.size, 10) || 100))
    const db = getTurso()
    let payload
    if (kind === 'dav') payload = await searchDav(db, body.filters, page, size)
    else if (kind === 'msc_prices' || kind === 'msc_tenders' || kind === 'prices' || kind === 'tenders') {
      payload = await searchMsc(db, kind, body.filters, page, size)
    } else payload = await searchVss(db, body.filters, page, size)
    payload = { ...payload, items: mapTursoItems(payload.items) }
    return json(res, 200, payload)
  } catch (e) {
    const status = e.status || 500
    return json(res, status, { error: e.message || String(e) })
  }
}
