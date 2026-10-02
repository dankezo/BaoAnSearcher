import { fold } from '../turso.js'
import { scopeTenderNos } from '../scopeMatch.js'

const VSS_SELECT = [
  'fingerprint', 'search', 'hoatchat', 'sodk', 'ten', 'duongdung', 'hamluong', 'donvitinh',
  'soluong', 'gia', 'thanhtien', 'nhomthau', 'nhasx', 'nuocsx', 'ma_tinh', 'ma_cskcb',
  'tungay_hd', 'denngay_hd', 'ten_tinh', 'ten_cskcb', 'loai_thau', 'loai', 'nam', 'congbo', 'updated_at',
].join(', ')

const MSC_PRICES_SELECT = [
  'source_id', 'search', 'name', 'ingredient', 'strength', 'registration', 'unit_price', 'quantity',
  'unit', 'route', 'dosage_form', 'group_name', 'medicine_type', 'manufacturer', 'country', 'buyer', 'province',
  'tender_no', 'published', 'winner', 'source_url', 'collected_at', 'updated_at',
].join(', ')

const MSC_TENDERS_SELECT = [
  'source_id', 'search', 'tender_no', 'name', 'buyer', 'province', 'published', 'close_date',
  'status_label', 'status_code', 'bid_price', 'bid_form', 'source_url', 'collected_at', 'updated_at',
].join(', ')

const FOLD_COL = {
  hoatchat: 'hoatchat_f',
  ten_tinh: 'ten_tinh_f',
  hoat_chat: 'hoat_chat_f',
  ten_thuoc: 'ten_thuoc_f',
  name: 'name_f',
  ingredient: 'ingredient_f',
  province: 'province_f',
}

function words(q) {
  return fold(q || '').trim().split(/\s+/).filter(Boolean)
}

function asList(v) {
  if (Array.isArray(v)) return v.map((x) => String(x ?? '').trim()).filter(Boolean)
  if (v == null || v === '') return []
  return String(v).split(/[|,;]+/).map((s) => s.trim()).filter(Boolean)
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
      out.push(`N${n}`, `n${n}`, n, `Nhóm ${n}`, `nhom ${n}`, `NHOM ${n}`)
    }
  }
  return [...new Set(out)]
}

function textCol(dialect, col) {
  if (dialect === 'tidb' && FOLD_COL[col]) return FOLD_COL[col]
  return col
}

function likeValue(dialect, col, value) {
  const raw = String(value)
  if (dialect === 'tidb' && FOLD_COL[col]) {
    const needle = fold(raw).trim().replace(/\s+/g, ' ')
    // TiDB B-tree indexes cannot accelerate a leading wildcard. Ingredient is
    // the high-volume MSC lookup, so its UI contract is a word/phrase-prefix
    // search. This turns into an IndexRangeScan on idx_msc_prices_ingredient_f.
    if (col === 'ingredient') return `${needle}%`
    return `%${needle}%`
  }
  return `%${raw}%`
}

function likeAny(where, args, col, v, dialect) {
  const target = textCol(dialect, col)
  const vals = col === 'nhomthau' || col === 'group_name' ? expandGroupTokens(v) : asList(v)
  if (!vals.length) return
  if (col === 'nhomthau' || col === 'group_name') {
    const parts = []
    for (const x of vals) {
      if (/^[1-5]$/.test(x)) {
        parts.push(`${target} = ?`)
        args.push(x)
      } else {
        parts.push(`${target} = ? OR ${target} LIKE ?`)
        args.push(x, `${x}%`)
      }
    }
    where.push(`(${parts.join(' OR ')})`)
    return
  }
  if (col === 'loai') {
    if (vals.length === 1) {
      where.push(`${target} = ?`)
      args.push(vals[0])
      return
    }
    where.push(`${target} IN (${vals.map(() => '?').join(',')})`)
    args.push(...vals)
    return
  }
  if (vals.length === 1) {
    where.push(`${target} LIKE ?`)
    args.push(likeValue(dialect, col, vals[0]))
    return
  }
  where.push(`(${vals.map(() => `${target} LIKE ?`).join(' OR ')})`)
  for (const x of vals) args.push(likeValue(dialect, col, x))
}

function eqAny(where, args, col, v, parseIntVal = false) {
  const vals = asList(v)
  if (!vals.length) return
  const parsed = parseIntVal ? vals.map((x) => parseInt(x, 10)).filter((n) => !Number.isNaN(n)) : vals
  if (!parsed.length) return
  if (parsed.length === 1) {
    where.push(`${col} = ?`)
    args.push(parsed[0])
    return
  }
  where.push(`${col} IN (${parsed.map(() => '?').join(',')})`)
  args.push(...parsed)
}

function present(value) {
  return value != null && String(value) !== ''
}

/**
 * Keyset for ORDER BY date DESC, id ASC.
 * Turso/SQLite/Postgres put NULLs first on DESC. TiDB puts them last.
 * A cursor with a null date falls back to OFFSET (caller checks `used`).
 */
function keysetDescAsc(dateCol, idCol, cursor, dialect, args) {
  if (!cursor || !present(cursor[dateCol]) || !present(cursor[idCol])) return ''
  const date = cursor[dateCol]
  const id = cursor[idCol]
  args.push(date, date, id)
  if (dialect === 'tidb') {
    return `((${dateCol} < ? OR (${dateCol} = ? AND ${idCol} > ?) OR ${dateCol} IS NULL))`
  }
  return `((${dateCol} IS NOT NULL AND (${dateCol} < ? OR (${dateCol} = ? AND ${idCol} > ?))))`
}

function specFor(kind) {
  const tenders = kind === 'tenders' || kind === 'msc_tenders'
  if (kind === 'dav') {
    return {
      table: 'dav_drugs',
      select: '*',
      date: 'ngay_cap',
      id: 'id',
      order: 'ngay_cap DESC, ngay_gia_han DESC, id',
    }
  }
  if (kind === 'msc_prices' || kind === 'msc_tenders' || kind === 'prices' || kind === 'tenders') {
    return {
      table: tenders ? 'msc_tenders' : 'msc_prices',
      select: tenders ? MSC_TENDERS_SELECT : MSC_PRICES_SELECT,
      date: 'published',
      id: 'source_id',
      order: 'published DESC, source_id',
    }
  }
  return {
    table: 'vss_bids',
    select: VSS_SELECT,
    date: 'tungay_hd',
    id: 'fingerprint',
    order: 'tungay_hd DESC, fingerprint',
  }
}

function whereFor(kind, filters, dialect) {
  const f = filters || {}
  const indexed = []
  // Keep predicates in insertion order, exactly like their bound arguments.
  // SQL optimizers choose indexes independently of the textual AND order.
  const rest = indexed
  const args = []
  if (kind === 'dav') {
    const rawTags = f.tags ?? f.selectedTags
    if (rawTags != null && !asList(rawTags).length) return { empty: true, where: '0=1', args: [] }
    if (rawTags != null) {
      const tags = asList(rawTags)
      indexed.push(`tag_id IN (${tags.map(() => '?').join(',')})`)
      args.push(...tags)
    }
    for (const w of words(f.q)) {
      rest.push('search LIKE ?')
      args.push(`%${w}%`)
    }
    likeAny(rest, args, 'ten_thuoc', f.tenThuoc, dialect)
    likeAny(rest, args, 'so_dang_ky', f.soDangKy, dialect)
    likeAny(rest, args, 'hoat_chat', f.hoatChat, dialect)
    likeAny(rest, args, 'dang_bao_che', f.dangBaoChe, dialect)
    likeAny(rest, args, 'cty_san_xuat', f.sanXuat, dialect)
    likeAny(rest, args, 'cty_dang_ky', f.dangKy, dialect)
    likeAny(rest, args, 'nuoc_san_xuat', f.nuocSanXuat, dialect)
  } else if (kind === 'msc_prices' || kind === 'msc_tenders' || kind === 'prices' || kind === 'tenders') {
    const tenders = kind === 'msc_tenders' || kind === 'tenders'
    if (tenders && dialect === 'tidb') {
      const quick = String(f.metricQuick || '')
      const months = [3, 6, 12].includes(Number(f.metricMonths)) ? Number(f.metricMonths) : 12
      const open = `((status_code IS NULL OR status_code = '') AND (close_date IS NULL OR close_date >= CURDATE()))`
      if (quick) indexed.push(`(published IS NULL OR published >= DATE_SUB(CURDATE(), INTERVAL ${months} MONTH))`)
      if (quick === 'open_all' || quick === 'open_dxt' || quick === 'open_empty' || quick === 'open_later') indexed.push(open)
      else if (quick === 'reviewing') indexed.push(`(status_code = 'DXT' OR ((status_code IS NULL OR status_code = '') AND close_date IS NOT NULL AND close_date < CURDATE()))`)
      else if (quick === 'new_72h') {
        indexed.push(open)
        indexed.push('published >= DATE_SUB(NOW(), INTERVAL 3 DAY)')
      } else if (quick === 'closing_7d') {
        indexed.push(open)
        indexed.push('close_date IS NOT NULL AND close_date >= CURDATE() AND close_date < DATE_ADD(CURDATE(), INTERVAL 7 DAY)')
      }
      const scoped = scopeTenderNos(f)
      if (scoped) {
        if (!scoped.length) return { empty: true, where: '0=1', args: [] }
        indexed.push(`tender_no IN (${scoped.map(() => '?').join(',')})`)
        args.push(...scoped)
        if (quick === 'match_exact' || quick === 'match_near') indexed.push(open)
      }
    }
    for (const w of words(f.q)) {
      rest.push('search LIKE ?')
      args.push(`%${w}%`)
    }
    const cols = (tenders
      ? [
        ['name', f.name], ['province', f.province], ['tender_no', f.tender_no], ['buyer', f.buyer],
      ]
      : [
        ['name', f.name], ['ingredient', f.ingredient], ['registration', f.registration], ['route', f.route], ['dosage_form', f.dosage_form],
        ['manufacturer', f.manufacturer], ['province', f.province], ['tender_no', f.tender_no],
        ['buyer', f.buyer], ['winner', f.winner], ['group_name', f.group_name],
        ['medicine_type', f.medicine_type], ['country', f.country],
      ])
    for (const [col, value] of cols) likeAny(rest, args, col, value, dialect)
    const publishedFrom = f.publishedFrom || f.tuNgay || null
    if (publishedFrom) {
      indexed.push('(published IS NULL OR published >= ?)')
      args.push(String(publishedFrom).slice(0, 10))
    }
  } else {
    eqAny(indexed, args, 'loai', f.loai)
    eqAny(indexed, args, 'nam', f.nam, true)
    likeAny(indexed, args, 'ma_tinh', f.ma_tinh, dialect)
    likeAny(indexed, args, 'nhomthau', f.nhomthau, dialect)
    for (const w of words(f.q)) {
      rest.push('search LIKE ?')
      args.push(`%${w}%`)
    }
    likeAny(rest, args, 'hoatchat', f.hoatchat, dialect)
    likeAny(rest, args, 'sodk', f.sodk, dialect)
    likeAny(rest, args, 'loai_thau', f.loai_thau, dialect)
    likeAny(rest, args, 'duongdung', f.duongdung, dialect)
    likeAny(rest, args, 'ten_tinh', f.ten_tinh, dialect)
    likeAny(rest, args, 'nuocsx', f.nuocsx, dialect)
    if (f.tuNgay) {
      indexed.push('(tungay_hd IS NULL OR tungay_hd >= ?)')
      args.push(String(f.tuNgay).slice(0, 10))
    }
    if (f.denNgay) {
      indexed.push('(tungay_hd IS NULL OR tungay_hd <= ?)')
      args.push(String(f.denNgay).slice(0, 10))
    }
  }
  const parts = indexed
  return { empty: false, where: parts.length ? parts.join(' AND ') : '1=1', args }
}

export function buildSearchSql({ kind = 'vss', filters, page = 0, size = 100, cursor = null, dialect = 'turso' } = {}) {
  const spec = specFor(kind)
  const built = whereFor(kind, filters, dialect)
  if (built.empty) return { empty: true, spec }
  const args = [...built.args]
  const seek = []
  const clause = keysetDescAsc(spec.date, spec.id, cursor, dialect, seek)
  const where = clause ? `${built.where} AND ${clause}` : built.where
  const limit = Math.min(2001, Math.max(1, Math.trunc(size) + 1))
  const isMsc = kind === 'msc_prices' || kind === 'msc_tenders' || kind === 'prices' || kind === 'tenders'
  const usesIngredientIndex = dialect === 'tidb'
    && spec.table === 'msc_prices'
    && asList(filters?.ingredient).length > 0
  const indexHint = usesIngredientIndex ? `/*+ USE_INDEX(msc_prices, idx_msc_prices_ingredient_f) */ ` : ''
  const offset = Math.max(0, Math.trunc(page)) * Math.max(1, Math.trunc(size))
  // MSC contains the 560k-row fact table. Never use OFFSET there: every
  // page after the first must carry the opaque next cursor from the previous
  // response. LIMIT + 1 supplies hasMore without COUNT(*).
  const pageSql = isMsc ? `LIMIT ${limit}` : (clause ? `LIMIT ${limit}` : `LIMIT ${limit} OFFSET ${offset}`)
  return {
    empty: false,
    spec,
    sql: `SELECT ${indexHint}${spec.select} FROM ${spec.table} WHERE ${where} ORDER BY ${spec.order} ${pageSql}`,
    args: [...args, ...seek],
    countSql: `SELECT COUNT(*) AS total FROM ${spec.table} WHERE ${built.where}`,
    countArgs: args,
    keyset: Boolean(clause),
  }
}

export function cursorOf(kind, row) {
  if (!row) return null
  const spec = specFor(kind)
  const date = row[spec.date]
  const id = row[spec.id]
  if (date == null || date === '' || id == null || id === '') return null
  return { [spec.date]: date, [spec.id]: id }
}
