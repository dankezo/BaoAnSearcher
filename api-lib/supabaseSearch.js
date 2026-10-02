import { supabaseAsUser } from './supabaseClient.js'
import { fold } from './turso.js'

const VSS_SELECT = [
  'fingerprint', 'search', 'hoatchat', 'sodk', 'ten', 'duongdung', 'hamluong', 'donvitinh',
  'soluong', 'gia', 'thanhtien', 'nhomthau', 'nhasx', 'nuocsx', 'ma_tinh', 'ma_cskcb',
  'tungay_hd', 'denngay_hd', 'ten_tinh', 'ten_cskcb', 'loai_thau', 'loai', 'nam', 'congbo', 'updated_at',
].join(',')

const MSC_PRICES_SELECT = [
  'source_id', 'search', 'name', 'ingredient', 'strength', 'registration', 'unit_price', 'quantity',
  'unit', 'route', 'dosage_form', 'group_name', 'medicine_type', 'manufacturer', 'country', 'buyer', 'province',
  'tender_no', 'published', 'winner', 'source_url', 'collected_at', 'updated_at',
].join(',')

const MSC_TENDERS_SELECT = [
  'source_id', 'search', 'tender_no', 'name', 'buyer', 'province', 'published', 'close_date',
  'status_label', 'status_code', 'bid_price', 'bid_form', 'source_url', 'collected_at', 'updated_at',
].join(',')

function asList(v) {
  if (Array.isArray(v)) return v.map((x) => String(x ?? '').trim()).filter(Boolean)
  if (v == null || v === '') return []
  return String(v).split(/[|,;]+/).map((s) => s.trim()).filter(Boolean)
}

function plain(v) {
  return String(v).replace(/[%_,*()]/g, '')
}

function expandGroupTokens(v) {
  const out = []
  for (const raw of asList(v)) {
    const s = String(raw).trim()
    if (!s) continue
    out.push(s)
    const m = s.match(/^(?:n|nhom|nhóm)\s*([1-5])$/i) || s.match(/^([1-5])$/)
    if (m) {
      const n = m[1]
      out.push(`N${n}`, `n${n}`, n, `Nhóm ${n}`, `nhom ${n}`)
    }
  }
  return [...new Set(out)]
}

function applyLike(query, col, v) {
  const vals = asList(v).map(plain).filter(Boolean)
  if (!vals.length) return query
  if (vals.length === 1) return query.ilike(col, `%${vals[0]}%`)
  return query.or(vals.map((x) => `${col}.ilike.*${x}*`).join(','))
}

function applyGroup(query, col, v) {
  const vals = expandGroupTokens(v).map(plain).filter(Boolean)
  if (!vals.length) return query
  const parts = []
  for (const x of vals) {
    if (/^[1-5]$/.test(x)) parts.push(`${col}.eq.${x}`)
    else parts.push(`${col}.eq.${x}`, `${col}.like.${x}*`)
  }
  return query.or(parts.join(','))
}

function applyEq(query, col, v, asInt = false) {
  const vals = asList(v)
  const parsed = asInt ? vals.map((x) => parseInt(x, 10)).filter((n) => !Number.isNaN(n)) : vals
  if (!parsed.length) return query
  if (parsed.length === 1) return query.eq(col, parsed[0])
  return query.in(col, parsed)
}

async function runQuery(accessToken, table, select, build, page, size, orders, cursor = null, countOnly = false) {
  const sb = supabaseAsUser(accessToken)
  let query = sb.from(table).select(countOnly ? '*' : select, countOnly ? { count: 'exact', head: true } : undefined)
  const built = build(query)
  if (built?.empty) return countOnly ? { total: 0 } : { total: null, page, size, hasMore: false, items: [], nextCursor: null }
  query = built
  if (countOnly) {
    const { count, error } = await query
    if (error) {
      const err = new Error('Supabase chưa đếm được kết quả.')
      err.status = 502
      throw err
    }
    return { total: count ?? 0 }
  }
  const seek = keysetFilters(orders, cursor)
  if (seek) query = seek(query)
  for (const [column, ascending] of orders) query = query.order(column, { ascending })
  const from = seek ? 0 : page * size
  const { data, error } = await query.range(from, from + size)
  if (error) {
    const err = new Error('Supabase chưa trả được trang tìm kiếm.')
    err.status = 502
    throw err
  }
  const rows = data || []
  const hasMore = rows.length > size
  const items = hasMore ? rows.slice(0, size) : rows
  return { total: null, page, size, hasMore, items, nextCursor: cursorFrom(orders, items[items.length - 1]) }
}

function cursorFrom(orders, row) {
  if (!row) return null
  const cursor = {}
  for (const [column] of orders) {
    const value = row[column]
    if (value == null || value === '') return null
    cursor[column] = value
  }
  return cursor
}

function quoteFilter(value) {
  return `"${String(value).replace(/"/g, '""')}"`
}

function keysetFilters(orders, cursor) {
  if (!cursor) return null
  const [dateCol, dateAsc] = orders[0]
  const [idCol] = orders[orders.length - 1]
  const date = cursor[dateCol]
  const id = cursor[idCol]
  if (date == null || date === '' || id == null || id === '' || dateAsc) return null
  const day = quoteFilter(date)
  const rowId = quoteFilter(id)
  return (query) => query.or(
    `and(${dateCol}.not.is.null,${dateCol}.lt.${day}),and(${dateCol}.eq.${day},${idCol}.gt.${rowId})`,
  )
}

export async function countSupabase(accessToken, kind, filters) {
  const page = await searchSupabase(accessToken, kind, filters, 0, 1, null, true)
  return page.total ?? 0
}

export async function searchSupabase(accessToken, kind, filters, page, size, cursor = null, countOnly = false) {
  const f = filters || {}
  const words = fold(f.q || '').trim().split(/\s+/).filter(Boolean).map(plain)
  if (kind === 'dav') {
    return runQuery(accessToken, 'dav_drugs', '*', (query) => {
      const rawTags = f.tags ?? f.selectedTags
      if (rawTags != null && !asList(rawTags).length) return { empty: true }
      for (const w of words) query = query.ilike('search', `%${w}%`)
      query = applyLike(query, 'ten_thuoc', f.tenThuoc)
      query = applyLike(query, 'so_dang_ky', f.soDangKy)
      query = applyLike(query, 'hoat_chat', f.hoatChat)
      query = applyLike(query, 'dang_bao_che', f.dangBaoChe)
      query = applyLike(query, 'cty_san_xuat', f.sanXuat)
      query = applyLike(query, 'cty_dang_ky', f.dangKy)
      query = applyLike(query, 'nuoc_san_xuat', f.nuocSanXuat)
      if (rawTags != null) query = query.in('tag_id', asList(rawTags))
      return query
    }, page, size, [['ngay_cap', false], ['ngay_gia_han', false], ['id', true]], cursor, countOnly)
  }
  if (kind === 'msc_prices' || kind === 'msc_tenders' || kind === 'prices' || kind === 'tenders') {
    const tenders = kind === 'msc_tenders' || kind === 'tenders'
    const table = tenders ? 'msc_tenders' : 'msc_prices'
    return runQuery(accessToken, table, tenders ? MSC_TENDERS_SELECT : MSC_PRICES_SELECT, (query) => {
      for (const w of words) query = query.ilike('search', `%${w}%`)
      const cols = [
        ['name', f.name], ['ingredient', f.ingredient], ['registration', f.registration], ['route', f.route], ['dosage_form', f.dosage_form],
        ['manufacturer', f.manufacturer], ['province', f.province], ['tender_no', f.tender_no],
        ['buyer', f.buyer], ['winner', f.winner], ['medicine_type', f.medicine_type],
        ['country', f.country],
      ]
      for (const [col, value] of cols) query = applyLike(query, col, value)
      query = applyGroup(query, 'group_name', f.group_name)
      const publishedFrom = f.publishedFrom || f.tuNgay || null
      if (publishedFrom) {
        const day = String(publishedFrom).slice(0, 10)
        query = query.or(`published.is.null,published.gte.${day}`)
      }
      return query
    }, page, size, [['published', false], ['source_id', true]], cursor, countOnly)
  }
  return runQuery(accessToken, 'vss_bids', VSS_SELECT, (query) => {
    for (const w of words) query = query.ilike('search', `%${w}%`)
    query = applyLike(query, 'hoatchat', f.hoatchat)
    query = applyLike(query, 'sodk', f.sodk)
    query = applyEq(query, 'loai', f.loai)
    query = applyGroup(query, 'nhomthau', f.nhomthau)
    query = applyLike(query, 'loai_thau', f.loai_thau)
    query = applyLike(query, 'duongdung', f.duongdung)
    query = applyLike(query, 'ma_tinh', f.ma_tinh)
    query = applyLike(query, 'ten_tinh', f.ten_tinh)
    query = applyLike(query, 'nuocsx', f.nuocsx)
    query = applyEq(query, 'nam', f.nam, true)
    if (f.tuNgay) query = query.or(`tungay_hd.is.null,tungay_hd.gte.${String(f.tuNgay).slice(0, 10)}`)
    if (f.denNgay) query = query.or(`tungay_hd.is.null,tungay_hd.lte.${String(f.denNgay).slice(0, 10)}`)
    return query
  }, page, size, [['tungay_hd', false], ['fingerprint', true]], cursor, countOnly)
}

export const SUGGEST_FIELDS = {
  vss: {
    table: 'vss_bids',
    columns: {
      hoatchat: 'hoatchat',
      sodk: 'sodk',
      duongdung: 'duongdung',
      nuocsx: 'nuocsx',
      loai_thau: 'loai_thau',
      ten: 'ten',
    },
  },
  dav: {
    table: 'dav_drugs',
    columns: {
      tenThuoc: 'ten_thuoc',
      soDangKy: 'so_dang_ky',
      hoatChat: 'hoat_chat',
      dangBaoChe: 'dang_bao_che',
      sanXuat: 'cty_san_xuat',
      dangKy: 'cty_dang_ky',
      nuocSanXuat: 'nuoc_san_xuat',
      drugGroup: 'drug_group',
      q: 'ten_thuoc',
    },
  },
  msc_prices: {
    table: 'msc_prices',
    columns: {
      name: 'name',
      ingredient: 'ingredient',
      registration: 'registration',
      manufacturer: 'manufacturer',
      winner: 'winner',
      buyer: 'buyer',
      country: 'country',
      medicine_type: 'medicine_type',
      tender_no: 'tender_no',
    },
  },
  msc_tenders: {
    table: 'msc_tenders',
    columns: {
      name: 'name',
      buyer: 'buyer',
      tender_no: 'tender_no',
    },
  },
}

export async function suggestSupabase(accessToken, section, field, q) {
  const spec = SUGGEST_FIELDS[section]
  const column = spec?.columns?.[field]
  const needle = String(q || '').replace(/[%_,]/g, '').trim()
  if (!spec || !column || needle.length < 2) return []
  const sb = supabaseAsUser(accessToken)
  const { data, error } = await sb.from(spec.table).select(column).ilike(column, `%${needle}%`).limit(40)
  if (error) return []
  const seen = new Set()
  const out = []
  for (const row of data || []) {
    const text = String(row[column] ?? '').trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push(text)
    if (out.length >= 8) break
  }
  return out
}
