import { fold } from './turso.js'
import { whereFor } from './db/searchSql.js'
import { groupDigit } from './metricsRollup.js'
import { matchingTenderNos, packageMatchFromLines, publicLines, scopeFor } from './scopeMatch.js'
import { VN_PROVINCES, provinceNameFromCode } from './vnProvinces.js'

const REGION_ORDER = [
  'Tây Bắc',
  'Đông Bắc',
  'Đồng bằng sông Hồng',
  'Bắc Trung Bộ',
  'Nam Trung Bộ',
  'Tây Nguyên',
  'Đông Nam Bộ',
  'Đồng bằng sông Cửu Long',
]
const REGION_CODES = {
  'Tây Bắc': ['11', '12', '14', '17'],
  'Đông Bắc': ['02', '04', '06', '08', '10', '15', '19', '20', '22', '24', '25'],
  'Đồng bằng sông Hồng': ['01', '26', '27', '30', '31', '33', '34', '35', '36', '37'],
  'Bắc Trung Bộ': ['38', '40', '42', '44', '45', '46'],
  'Nam Trung Bộ': ['48', '49', '51', '52', '54', '56', '58', '60'],
  'Tây Nguyên': ['62', '64', '66', '67', '68'],
  'Đông Nam Bộ': ['70', '72', '74', '75', '77', '79'],
  'Đồng bằng sông Cửu Long': ['80', '82', '83', '84', '86', '87', '89', '91', '92', '93', '94', '95', '96'],
}
const REGION_BY_CODE = Object.fromEntries(
  Object.entries(REGION_CODES).flatMap(([name, codes]) => codes.map((code) => [code, name])),
)

function hint(table) {
  return `/*+ READ_FROM_STORAGE(TIFLASH[${table}]) */`
}

function padCode(value) {
  const key = String(value || '').trim()
  if (!key) return ''
  return /^\d+$/.test(key) ? key.padStart(2, '0') : key
}

function regionOf(code) {
  return REGION_BY_CODE[padCode(code)] || ''
}

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export function mapWindow(months, now = new Date()) {
  const span = [3, 6, 12].includes(Number(months)) ? Number(months) : 12
  const index = now.getFullYear() * 12 + now.getMonth() - (span - 1)
  const curFrom = new Date(Math.floor(index / 12), index % 12, 1)
  const prevFrom = new Date(Math.floor((index - 12) / 12), (index - 12) % 12, 1)
  const prevEnd = new Date(now)
  prevEnd.setFullYear(prevEnd.getFullYear() - 1)
  return { months: span, now, curFrom, prevFrom, prevEnd }
}

function ymOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function monthKeys(from, end) {
  const keys = []
  let year = from.getFullYear()
  let month = from.getMonth() + 1
  const last = end.getFullYear() * 12 + end.getMonth() + 1
  while (year * 12 + month <= last) {
    keys.push(`${year}-${String(month).padStart(2, '0')}`)
    month += 1
    if (month === 13) {
      month = 1
      year += 1
    }
  }
  return keys
}

function stampOf(ym) {
  const match = String(ym || '').match(/^(\d{4})-(\d{2})$/)
  if (!match) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, 1)
}

function inSpan(stamp, start, end) {
  return stamp && stamp >= start && stamp <= end
}

function codeSet(filters) {
  const raw = []
  for (const key of ['ma_tinh', 'provinces', 'province']) {
    const value = filters[key]
    if (Array.isArray(value)) raw.push(...value)
    else if (String(value || '').trim()) raw.push(value)
  }
  let codes = new Set(raw.map(padCode).filter((code) => /^\d{2}$/.test(code)))
  const region = String(filters.region || '').trim()
  if (region && REGION_CODES[region]) {
    const allowed = new Set(REGION_CODES[region])
    codes = codes.size ? new Set([...codes].filter((code) => allowed.has(code))) : allowed
  }
  return codes
}

function groupSet(filters) {
  const raw = []
  for (const key of ['nhomthau', 'group']) {
    const value = filters[key]
    if (Array.isArray(value)) raw.push(...value)
    else if (String(value || '').trim()) raw.push(value)
  }
  return new Set(raw.map(groupDigit).filter(Boolean))
}

function blank(code, name) {
  return {
    code,
    name,
    region: regionOf(code),
    value: 0,
    prev: 0,
    lots: 0,
    facilities: 0,
    groups: [0, 0, 0, 0, 0],
    month_values: {},
  }
}

function finalize(bucket, keys) {
  const prev = bucket.prev
  const cur = bucket.value
  const yoy = prev > 0 ? ((cur - prev) / prev) * 100 : (cur > 0 ? null : 0)
  const trend = keys.map((key) => ({ key, value: Number(bucket.month_values[key] || 0) }))
  return {
    code: bucket.code,
    name: bucket.name,
    region: bucket.region,
    value: cur,
    prev,
    yoy,
    lots: bucket.lots,
    facilities: bucket.facilities,
    activeMonths: trend.filter((point) => point.value > 0).length,
    trend,
    groups: bucket.groups.map(Number),
  }
}

function rollup(items, keys, code, name, region) {
  const bucket = blank(code, name)
  bucket.region = region
  for (const item of items) {
    bucket.value += num(item.value)
    bucket.prev += num(item.prev)
    bucket.lots += num(item.lots)
    bucket.facilities += num(item.facilities)
    ;(item.groups || []).forEach((amount, index) => {
      bucket.groups[index] += num(amount)
    })
    for (const point of item.trend || []) {
      bucket.month_values[point.key] = (bucket.month_values[point.key] || 0) + num(point.value)
    }
  }
  const result = finalize(bucket, keys)
  if (items.some((item) => Array.isArray(item.countTrend))) {
    const counts = new Map(keys.map((key) => [key, 0]))
    for (const item of items) for (const point of item.countTrend || []) {
      counts.set(point.key, (counts.get(point.key) || 0) + num(point.value))
    }
    result.countTrend = countPoints(keys, counts)
  }
  return result
}

export function countPoints(keys, counts) {
  let previous = null
  return keys.map((key) => {
    const count = counts.get(key)
    const value = count instanceof Set ? count.size : num(count)
    const point = { key, value, delta: previous === null ? null : value - previous }
    previous = value
    return point
  })
}

export function shapeMapRows(rows, filters, window, facilityCounts = new Map()) {
  const keys = monthKeys(window.curFrom, window.now)
  const codes = codeSet(filters)
  const regionName = String(filters.region || '').trim()
  const groups = groupSet(filters)
  const buckets = new Map()
  for (const [code, name] of Object.entries(VN_PROVINCES)) {
    if (codes.size && !codes.has(code)) continue
    if (regionName && regionOf(code) !== regionName) continue
    buckets.set(code, blank(code, name))
  }
  for (const row of rows || []) {
    const stamp = stampOf(row.ym)
    const current = inSpan(stamp, window.curFrom, window.now)
    const previous = inSpan(stamp, window.prevFrom, window.prevEnd)
    if (!current && !previous) continue
    const code = padCode(row.ma_tinh)
    if (!buckets.has(code)) continue
    const digit = groupDigit(row.nhomthau)
    if (groups.size && !groups.has(digit)) continue
    const bucket = buckets.get(code)
    const pay = num(row.sum_thanhtien ?? row.pay)
    const lots = num(row.cnt)
    if (current) {
      bucket.value += pay
      bucket.lots += lots
      if (digit) bucket.groups[Number(digit) - 1] += pay
      if (stamp) {
        const key = ymOf(stamp)
        bucket.month_values[key] = (bucket.month_values[key] || 0) + pay
      }
    } else {
      bucket.prev += pay
    }
  }
  for (const [code, count] of facilityCounts) {
    const bucket = buckets.get(padCode(code))
    if (bucket) bucket.facilities = count
  }
  const provinces = [...buckets.values()].map((bucket) => finalize(bucket, keys))
  provinces.sort((a, b) => b.value - a.value)
  const regions = REGION_ORDER
    .filter((name) => !regionName || name === regionName)
    .map((name) => rollup(provinces.filter((row) => row.region === name), keys, name, name, name))
  const summary = rollup(provinces, keys, '', 'Bộ lọc hiện tại', regionName)
  return { months: window.months, summary, provinces, regions }
}

async function rowsOf(query, sql, args) {
  const rs = await query(sql, args)
  return rs?.rows || []
}

function isoDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function vssWhere(filters, from, to) {
  const shared = whereFor('vss', filters, 'tidb')
  const clauses = [shared.where, 'tungay_hd >= ?', 'tungay_hd < DATE_ADD(?, INTERVAL 1 DAY)']
  const args = [...shared.args, isoDate(from), isoDate(to)]
  const groups = groupSet(filters)
  if (groups.size) {
    clauses.push(`(${[...groups].map(() => 'nhomthau LIKE ?').join(' OR ')})`)
    args.push(...[...groups].map((group) => `%${group}%`))
  }
  const codes = codeSet(filters)
  if (codes.size) {
    const slots = [...codes].flatMap((code) => [code, String(Number(code))])
    clauses.push(`COALESCE(ma_tinh, '') IN (${slots.map(() => '?').join(',')})`)
    args.push(...slots)
  }
  return { clauses, args }
}

export async function mapPayload(query, body = {}) {
  const requested = String(body.source || '').toLowerCase()
  // Keep the historical `msc` contract for tender maps.  Price maps are a
  // separate source because their amount is quantity × winning unit price,
  // not a tender's announced package value.
  const source = requested === 'msc_prices' ? 'msc_prices' : (requested === 'msc' || requested === 'msc_tenders' ? 'msc' : 'vss')
  const filters = body.filters && typeof body.filters === 'object' ? body.filters : {}
  const window = mapWindow(body.months)
  const withDots = body.dots !== false
  const withIngredients = body.ingredients !== false
  if (source === 'msc') return mscPayload(query, filters, window, withDots)
  if (source === 'msc_prices') return mscPricePayload(query, filters, window, withDots, withIngredients)
  return vssPayload(query, filters, window, withDots, withIngredients)
}

async function vssPayload(query, filters, window, withDots, withIngredients) {
  const fromYm = ymOf(window.prevFrom)
  const toYm = ymOf(window.now)
  const needle = fold(filters.hoatchat || '').trim()
  const words = fold(filters.q || '').trim()
  let moneyRows = []
  const factKeys = ['hoatchat', 'q', 'sodk', 'loai_thau', 'duongdung', 'nuocsx', 'ten_tinh', 'tuNgay', 'denNgay', 'nam']
  const needsFacts = factKeys.some(key => Array.isArray(filters[key]) ? filters[key].length : String(filters[key] || '').trim())
  if (!needsFacts && (!filters.loai || filters.loai === 'Tân dược')) {
    moneyRows = await rowsOf(
      query,
      `SELECT ma_tinh, nhomthau, ym, SUM(sum_thanhtien) AS sum_thanhtien, SUM(cnt) AS cnt
FROM agg_vss_monthly
WHERE loai = ? AND ym >= ? AND ym <= ?
GROUP BY ma_tinh, nhomthau, ym`,
      ['Tân dược', fromYm, toYm],
    )
  } else {
    const where = vssWhere(filters, window.prevFrom, window.now)
    moneyRows = await rowsOf(
      query,
      `SELECT ${hint('vss_bids')}
  COALESCE(ma_tinh, '') AS ma_tinh,
  COALESCE(nhomthau, '') AS nhomthau,
  DATE_FORMAT(tungay_hd, '%Y-%m') AS ym,
  SUM(COALESCE(thanhtien, 0)) AS sum_thanhtien,
  COUNT(*) AS cnt
FROM vss_bids
WHERE ${where.clauses.join(' AND ')}
GROUP BY ma_tinh, nhomthau, DATE_FORMAT(tungay_hd, '%Y-%m')`,
      where.args,
    )
  }
  const span = vssWhere({ ...filters, hoatchat: filters.hoatchat, q: filters.q }, window.curFrom, window.now)
  let facilities = []
  try {
    facilities = await rowsOf(
      query,
      `SELECT ${hint('vss_bids')}
  COALESCE(ma_tinh, '') AS ma_tinh,
  COUNT(DISTINCT NULLIF(TRIM(ma_cskcb), '')) AS facilities
FROM vss_bids
WHERE ${span.clauses.join(' AND ')}
GROUP BY ma_tinh`,
      span.args,
    )
  } catch {
    facilities = []
  }
  const counts = new Map(facilities.map((row) => [row.ma_tinh, num(row.facilities)]))
  const shaped = shapeMapRows(moneyRows, filters, window, counts)
  let dots = []
  if (withDots) {
    try {
      const raw = await rowsOf(
        query,
        `SELECT ${hint('vss_bids')}
  COALESCE(ma_tinh, '') AS ma_tinh,
  COALESCE(ma_cskcb, '') AS ma_cskcb,
  MAX(ten_cskcb) AS name,
  SUM(COALESCE(thanhtien, 0)) AS value,
  COUNT(*) AS lots
FROM vss_bids
WHERE ${span.clauses.join(' AND ')}
GROUP BY ma_tinh, ma_cskcb
ORDER BY value DESC
LIMIT 120`,
        span.args,
      )
      dots = raw.map((row) => {
        const code = padCode(row.ma_tinh)
        const name = String(row.name || row.ma_cskcb || '').trim()
        return {
          id: `${code}:${row.ma_cskcb || name}`,
          kind: 'facility',
          ingredients: [],
          name,
          buyer: name,
          province: provinceNameFromCode(code) || code,
          provinceCode: code,
          region: regionOf(code),
          district: '',
          precision: 'province',
          placeNote: '',
          value: num(row.value),
          lots: num(row.lots),
          status: '',
          statusLabel: 'Cơ sở y tế',
        }
      }).filter((dot) => dot.name)
    } catch {
      dots = []
    }
  }
  let ingredients = []
  let ingredientAreas = {}
  if (withIngredients) {
    try {
      const raw = await rowsOf(
        query,
        `SELECT ${hint('vss_bids')}
  COALESCE(hoatchat, '') AS name,
  SUM(COALESCE(thanhtien, 0)) AS value,
  SUM(COALESCE(soluong, 0)) AS quantity
FROM vss_bids
WHERE ${span.clauses.join(' AND ')} AND hoatchat <> ''
GROUP BY hoatchat
ORDER BY value DESC
LIMIT 60`,
        span.args,
      )
      ingredients = raw.map((row) => ({
        name: String(row.name || '').trim(),
        value: num(row.value),
        quantity: num(row.quantity),
        baoanHits: [],
      })).filter((row) => row.name)
    } catch {
      ingredients = []
    }
    ingredientAreas = await vssIngredientAreas(query, span)
  }
  let areaDots = {}
  if (withDots) {
    const areaRows = await vssAreaFacilities(query, span)
    const seen = new Set(dots.map((dot) => dot.id))
    for (const row of areaRows) {
      const dot = facilityDot(row)
      if (!dot) continue
      if (!seen.has(dot.id)) {
        seen.add(dot.id)
        dots.push(dot)
      }
      const kept = dots.find((item) => item.id === dot.id)
      if (kept) {
        const list = areaDots[kept.provinceCode] || []
        if (list.length < 20) {
          list.push(kept)
          areaDots[kept.provinceCode] = list
        }
      }
    }
    for (const list of Object.values(areaDots)) list.sort((a, b) => b.value - a.value)
    const nationalIds = new Set(dots.slice(0, 120).map((dot) => dot.id))
    dots = dots.filter((dot) => nationalIds.has(dot.id))
  }
  return {
    source: 'vss',
    months: shaped.months,
    summary: shaped.summary,
    provinces: shaped.provinces,
    regions: shaped.regions,
    dots,
    areaDots,
    dotTotal: dots.length,
    truncated: false,
    ingredients,
    ingredientAreas,
    ingredientTitle: 'Hoạt chất trúng thầu',
    ingredientNote: 'Giá trị là thành tiền trúng thầu 12 tháng gần nhất trên TiDB.',
    ingredientValueLabel: 'Giá trị',
    ingredientQtyLabel: 'Số lượng',
    packages: [],
    packageAreas: {},
    packageTotal: 0,
    trendLabel: '',
  }
}

function mscPriceWhere(filters, from, to) {
  const clauses = ['published IS NOT NULL', 'published >= ?', 'published <= ?']
  const args = [isoDate(from), isoDate(to)]
  const ingredient = fold(filters.hoatchat || filters.ingredient || '').trim()
  if (ingredient) {
    clauses.push('ingredient_f LIKE ?')
    args.push(`%${ingredient}%`)
  }
  const groups = groupSet(filters)
  if (groups.size) {
    clauses.push(`(${[...groups].map(() => 'group_name LIKE ?').join(' OR ')})`)
    args.push(...[...groups].map((group) => `%${group}%`))
  }
  for (const word of fold(filters.q || '').trim().split(/\s+/).filter(Boolean)) {
    clauses.push('(buyer LIKE ? OR search LIKE ?)')
    args.push(`%${word}%`, `%${word}%`)
  }
  return { clauses, args, filtered: Boolean(ingredient || groups.size || String(filters.q || '').trim()) }
}

function priceMapRow(row) {
  const place = resolveProvince(row.province)
  return {
    ma_tinh: place.code,
    nhomthau: row.group_name,
    ym: row.ym,
    sum_thanhtien: num(row.revenue),
    cnt: num(row.cnt),
  }
}

/**
 * Province heatmap for winning MSC prices.  The unfiltered map reads the
 * tiny ingestion-time rollup; only explicit text filters use a bounded
 * TiFlash aggregation of the fact table.
 */
async function mscPricePayload(query, filters, window, withDots, withIngredients) {
  const all = mscPriceWhere(filters, window.prevFrom, window.now)
  const fromYm = ymOf(window.prevFrom)
  const toYm = ymOf(window.now)
  let monthly = []
  if (!all.filtered) {
    try {
      monthly = await rowsOf(
        query,
        `SELECT ym, province, group_name, revenue, quantity, cnt
           FROM agg_msc_price_monthly
          WHERE ym >= ? AND ym <= ?`,
        [fromYm, toYm],
      )
    } catch {
      monthly = []
    }
  }
  if (!monthly.length) {
    monthly = await rowsOf(
      query,
      `SELECT ${hint('msc_prices')}
        DATE_FORMAT(published, '%Y-%m') AS ym,
        COALESCE(province, '') AS province,
        COALESCE(group_name, '') AS group_name,
        SUM(COALESCE(unit_price, 0) * COALESCE(quantity, 0)) AS revenue,
        SUM(COALESCE(quantity, 0)) AS quantity,
        COUNT(*) AS cnt
      FROM msc_prices
      WHERE ${all.clauses.join(' AND ')}
      GROUP BY DATE_FORMAT(published, '%Y-%m'), COALESCE(province, ''), COALESCE(group_name, '')`,
      all.args,
    )
  }
  const shaped = shapeMapRows(monthly.map(priceMapRow), filters, window)
  const current = mscPriceWhere(filters, window.curFrom, window.now)
  const allowedCodes = codeSet(filters)
  let buyers = []
  if (withDots) {
    try {
      // Resolve province aliases before taking the scoped top 120.
      const raw = await rowsOf(
        query,
        `SELECT ${hint('msc_prices')}
          COALESCE(buyer, '') AS buyer,
          COALESCE(province, '') AS province,
          SUM(COALESCE(unit_price, 0) * COALESCE(quantity, 0)) AS value,
          COUNT(*) AS lots
        FROM msc_prices
        WHERE ${current.clauses.join(' AND ')} AND COALESCE(buyer, '') <> ''
        GROUP BY COALESCE(buyer, ''), COALESCE(province, '')
        ORDER BY value DESC
        ${allowedCodes.size ? '' : 'LIMIT 120'}`,
        current.args,
      )
      buyers = raw.map((row) => {
        const place = resolveProvince(row.province)
        const buyer = String(row.buyer || '').trim()
        return {
          id: `msc-price:${place.code}:${buyer}`,
          kind: 'price_buyer',
          name: buyer,
          buyer,
          province: place.label,
          provinceCode: place.code,
          region: regionOf(place.code),
          district: '',
          precision: 'province',
          placeNote: 'Mức tỉnh, tổng giá trị = đơn giá × số lượng trúng thầu.',
          value: num(row.value),
          lots: num(row.lots),
          ingredients: [],
        }
      }).filter((row) => row.name && row.provinceCode && (!allowedCodes.size || allowedCodes.has(row.provinceCode))).slice(0, 120)
    } catch {
      buyers = []
    }
  }
  const packageAreas = {}
  for (const buyer of buyers) {
    const list = packageAreas[buyer.provinceCode] || []
    list.push(buyer)
    packageAreas[buyer.provinceCode] = list
  }
  for (const list of Object.values(packageAreas)) list.sort((a, b) => b.value - a.value)

  let ingredients = []
  let ingredientAreas = {}
  if (withIngredients) {
    try {
      const raw = await rowsOf(
        query,
        `SELECT ${hint('msc_prices')}
          COALESCE(ingredient, '') AS name,
          COALESCE(province, '') AS province,
          SUM(COALESCE(unit_price, 0) * COALESCE(quantity, 0)) AS value,
          SUM(COALESCE(quantity, 0)) AS quantity
        FROM msc_prices
        WHERE ${current.clauses.join(' AND ')} AND COALESCE(ingredient, '') <> ''
        GROUP BY COALESCE(ingredient, ''), COALESCE(province, '')`,
        current.args,
      )
      const national = new Map()
      const byArea = {}
      for (const row of raw) {
        const name = String(row.name || '').trim()
        if (!name) continue
        const item = { name, value: num(row.value), quantity: num(row.quantity), baoanHits: [] }
        const key = fold(name)
        const sum = national.get(key) || { ...item, value: 0, quantity: 0 }
        sum.value += item.value
        sum.quantity += item.quantity
        national.set(key, sum)
        const place = resolveProvince(row.province)
        if (!place.code) continue
        const list = byArea[place.code] || []
        list.push(item)
        byArea[place.code] = list
      }
      ingredients = [...national.values()].sort((a, b) => b.value - a.value).slice(0, 60)
      const regional = {}
      for (const [code, list] of Object.entries(byArea)) {
        ingredientAreas[code] = list.sort((a, b) => b.value - a.value).slice(0, 40)
        const region = regionOf(code)
        if (region) (regional[region] ||= []).push(...list)
      }
      for (const [region, list] of Object.entries(regional)) {
        const merged = new Map()
        for (const item of list) {
          const key = fold(item.name)
          const sum = merged.get(key) || { ...item, value: 0, quantity: 0 }
          sum.value += item.value
          sum.quantity += item.quantity
          merged.set(key, sum)
        }
        ingredientAreas[region] = [...merged.values()].sort((a, b) => b.value - a.value).slice(0, 40)
      }
    } catch {
      ingredients = []
      ingredientAreas = {}
    }
  }
  return {
    source: 'msc_prices',
    months: shaped.months,
    summary: shaped.summary,
    provinces: shaped.provinces,
    regions: shaped.regions,
    dots: [],
    areaDots: {},
    dotTotal: buyers.length,
    truncated: false,
    ingredients,
    ingredientAreas,
    ingredientTitle: 'Hoạt chất theo đơn giá',
    ingredientNote: 'Giá trị = đơn giá trúng thầu × số lượng, trong 12 tháng gần nhất.',
    ingredientValueLabel: 'Giá trị',
    ingredientQtyLabel: 'Số lượng',
    packages: buyers,
    packageAreas,
    packageTotal: buyers.length,
    trendLabel: 'Giá trị đơn giá mỗi tháng',
  }
}

/** Load ingredients only for the selected VSS facility or MSC-price buyer. */
export async function mapFacilityIngredients(query, body = {}) {
  const dotId = String(body.dotId || '')
  const source = String(body.source || 'vss').toLowerCase()
  const filters = body.filters && typeof body.filters === 'object' ? body.filters : {}
  const window = mapWindow(body.months)
  if (source === 'msc_prices') {
    const parts = dotId.split(':')
    const code = padCode(body.provinceCode || parts[1] || '')
    const buyer = String(body.buyer || parts.slice(2).join(':')).trim()
    if (!buyer || !code) return { dotId, ingredients: [], months: window.months }
    const where = mscPriceWhere(filters, window.curFrom, window.now)
    where.clauses.push("COALESCE(buyer, '') = ?")
    where.args.push(buyer)
    const raw = await rowsOf(
      query,
      `SELECT ${hint('msc_prices')}
         COALESCE(province, '') AS province,
         COALESCE(ingredient, '') AS name,
         SUM(COALESCE(unit_price, 0) * COALESCE(quantity, 0)) AS value,
         SUM(COALESCE(quantity, 0)) AS quantity
       FROM msc_prices
       WHERE ${where.clauses.join(' AND ')} AND COALESCE(ingredient, '') <> ''
       GROUP BY COALESCE(province, ''), COALESCE(ingredient, '')`,
      where.args,
    )
    const ingredients = raw.filter((row) => resolveProvince(row.province).code === code)
      .map((row) => ({ name: String(row.name || '').trim(), value: num(row.value), quantity: num(row.quantity), baoanHits: [] }))
      .filter((row) => row.name).sort((a, b) => b.value - a.value).slice(0, 15)
    return { dotId, ingredients, months: window.months }
  }
  const [rawCode, ...facilityParts] = dotId.split(':')
  const code = padCode(body.provinceCode || rawCode)
  const facility = String(body.facilityCode || facilityParts.join(':')).trim()
  if (!facility || !/^\d{2}$/.test(code)) return { dotId, ingredients: [], months: window.months }
  const where = vssWhere(filters, window.curFrom, window.now)
  where.clauses.push("COALESCE(ma_tinh, '') IN (?, ?)", "COALESCE(ma_cskcb, '') = ?")
  where.args.push(code, String(Number(code)), facility)
  const raw = await rowsOf(
    query,
    `SELECT ${hint('vss_bids')}
       COALESCE(hoatchat, '') AS name,
       SUM(COALESCE(thanhtien, 0)) AS value,
       SUM(COALESCE(soluong, 0)) AS quantity
     FROM vss_bids
     WHERE ${where.clauses.join(' AND ')} AND COALESCE(hoatchat, '') <> ''
     GROUP BY COALESCE(hoatchat, '')
     ORDER BY value DESC
     LIMIT 15`,
    where.args,
  )
  return {
    dotId,
    ingredients: raw.map((row) => ({ name: String(row.name || '').trim(), value: num(row.value), quantity: num(row.quantity), baoanHits: [] }))
      .filter((row) => row.name),
    months: window.months,
  }
}

function facilityDot(row) {
  const code = padCode(row.ma_tinh || row.code)
  const fac = String(row.ma_cskcb || row.fac || '').trim()
  const name = String(row.name || fac).trim()
  if (!name) return null
  return {
    id: `${code}:${fac || name}`,
    kind: 'facility',
    ingredients: [],
    name,
    buyer: name,
    province: provinceNameFromCode(code) || code,
    provinceCode: code,
    region: regionOf(code),
    district: '',
    precision: 'province',
    placeNote: 'Mức tỉnh. Hồ sơ chỉ có tỉnh, chưa có tọa độ.',
    value: num(row.value),
    lots: num(row.lots),
    status: '',
    statusLabel: 'Cơ sở y tế',
  }
}

async function vssAreaFacilities(query, where) {
  try {
    return await rowsOf(
      query,
      `SELECT fac, name, code AS ma_tinh, value, lots FROM (
  SELECT ${hint('vss_bids')}
    COALESCE(ma_cskcb, '') AS fac,
    MAX(ten_cskcb) AS name,
    COALESCE(ma_tinh, '') AS code,
    SUM(COALESCE(thanhtien, 0)) AS value,
    COUNT(*) AS lots,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(ma_tinh, '')
      ORDER BY SUM(COALESCE(thanhtien, 0)) DESC
    ) AS rn
  FROM vss_bids
  WHERE ${where.clauses.join(' AND ')}
  GROUP BY COALESCE(ma_tinh, ''), COALESCE(ma_cskcb, '')
) ranked WHERE rn <= 20`,
      where.args,
    )
  } catch {
    return []
  }
}

async function vssIngredientAreas(query, where) {
  try {
    const raw = await rowsOf(
      query,
      `SELECT code, name, value, quantity FROM (
  SELECT ${hint('vss_bids')}
    COALESCE(ma_tinh, '') AS code,
    COALESCE(hoatchat, '') AS name,
    SUM(COALESCE(thanhtien, 0)) AS value,
    SUM(COALESCE(soluong, 0)) AS quantity,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(ma_tinh, '')
      ORDER BY SUM(COALESCE(thanhtien, 0)) DESC
    ) AS rn
  FROM vss_bids
  WHERE ${where.clauses.join(' AND ')} AND hoatchat <> ''
  GROUP BY COALESCE(ma_tinh, ''), COALESCE(hoatchat, '')
) ranked WHERE rn <= 40`,
      where.args,
    )
    const areas = {}
    const byRegion = {}
    for (const row of raw) {
      const code = padCode(row.code)
      const item = {
        name: String(row.name || '').trim(),
        value: num(row.value),
        quantity: num(row.quantity),
        baoanHits: [],
      }
      if (!item.name || !code) continue
      const list = areas[code] || []
      list.push(item)
      areas[code] = list
      const region = regionOf(code)
      if (region) {
        const bucket = byRegion[region] || []
        bucket.push(item)
        byRegion[region] = bucket
      }
    }
    for (const [region, rows] of Object.entries(byRegion)) {
      const merged = new Map()
      for (const item of rows) {
        const key = fold(item.name)
        const slot = merged.get(key) || { name: item.name, value: 0, quantity: 0, baoanHits: [] }
        slot.value += item.value
        slot.quantity += item.quantity
        merged.set(key, slot)
      }
      areas[region] = [...merged.values()].sort((a, b) => b.value - a.value).slice(0, 40)
    }
    return areas
  } catch {
    return {}
  }
}

const PACKAGE_STATUS = {
  open: 'Đang mời thầu',
  review: 'Đang xét kết quả',
  closed: 'Vừa đóng thầu',
}
const DROPPED_STATUS = new Set(['DHTBMT', 'DHT', 'DHKQLCNT', 'KCNTTT', 'VHH'])

function dayStamp(raw) {
  const match = String(raw || '').match(/(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)
}

function wantedStatus(raw) {
  const token = fold(raw)
  if (!token) return ''
  if (token === 'open' || token === 'opening' || token.includes('moi thau') || token.includes('lua chon nha thau')) return 'open'
  if (token === 'review' || token === 'dxt' || token.startsWith('dang xet')) return 'review'
  if (token === 'closed' || token === 'cnttt' || token.includes('vua dong')) return 'closed'
  return token
}

function classifyPackage(code, closeRaw, now, windowStart) {
  const status = String(code || '').trim().toUpperCase()
  const close = dayStamp(closeRaw)
  if (DROPPED_STATUS.has(status)) return null
  if (status === 'OPEN') return 'open'
  if (status === 'DXT' || (!status && close && close < now)) {
    if (close && close < windowStart) return null
    return 'review'
  }
  if (status === 'CNTTT') {
    if (!close || close < windowStart || close > now) return null
    return 'closed'
  }
  if (!status && (!close || close >= now)) return 'open'
  return null
}

function normPlace(text) {
  let token = fold(text).replace(/[-.]/g, ' ').split(/\s+/).filter(Boolean).join(' ')
  for (const prefix of ['tinh ', 'thanh pho ', 'tp ']) {
    if (token.startsWith(prefix)) token = token.slice(prefix.length).trim()
  }
  return token
}

const PROVINCE_BY_NAME = new Map(Object.entries(VN_PROVINCES).map(([code, name]) => [normPlace(name), code]))
for (const [name, code] of [
  ['tp ho chi minh', '79'], ['tphcm', '79'], ['hcm', '79'], ['sai gon', '79'],
  ['hue', '46'], ['ba ria vung tau', '77'], ['dac lak', '66'], ['daklak', '66'], ['dac nong', '67'],
]) PROVINCE_BY_NAME.set(name, code)

function resolveProvince(name) {
  const code = PROVINCE_BY_NAME.get(normPlace(name)) || ''
  if (code) return { code, label: VN_PROVINCES[code] || name }
  return { code: '', label: String(name || '').trim() }
}

function addScopeMatch(slot, line) {
  const level = line?.match === 'exact' || line?.match === 'near' ? line.match : ''
  if (!level) return

  // One ingredient can occur on several tender lines.  An exact result wins,
  // so the cards shown on the Map cannot downgrade a confirmed match.
  if (level === 'exact' && slot.match !== 'exact') {
    slot.match = 'exact'
    slot.status = line.status || ''
    slot.matchedCriteria = line.matchedCriteria || null
    slot.legalBasis = line.legalBasis || ''
    slot.baoanHits = []
  } else if (!slot.match) {
    slot.match = level
    slot.status = line.status || ''
    slot.matchedCriteria = line.matchedCriteria || null
    slot.legalBasis = line.legalBasis || ''
  }

  if (slot.match !== level) return
  for (const hit of line.hits || []) {
    const reg = String(hit.reg || '')
    const key = reg || `${hit.brand || ''}|${hit.strength || ''}|${hit.form || ''}`
    if (!key || slot.baoanHits.some((card) => card.key === key)) continue
    slot.baoanHits.push({
      key,
      brand: hit.brand || '',
      strength: hit.strength || '',
      form: hit.form || '',
      reg,
    })
  }
}

export function rankScopeLines(lines, limit = 60) {
  const buckets = new Map()
  for (const line of lines || []) {
    const name = String(line.name || '').trim()
    if (!name) continue
    const key = fold(name)
    const slot = buckets.get(key) || {
      name,
      value: 0,
      quantity: 0,
      match: '',
      status: '',
      matchedCriteria: null,
      legalBasis: '',
      baoanHits: [],
    }
    const qty = num(line.qty)
    const price = num(line.price)
    slot.value += price && qty ? price * qty : price
    slot.quantity += qty
    addScopeMatch(slot, line)
    buckets.set(key, slot)
  }
  return [...buckets.values()].sort((a, b) => b.value - a.value || b.quantity - a.quantity).slice(0, limit)
}

async function mscPayload(query, filters, window, withDots) {
  const needle = fold(filters.hoatchat || filters.ingredient || '').trim()
  const groups = groupSet(filters)
  const statusNeed = wantedStatus(filters.status)
  const buyerQuery = fold(filters.q || '').trim()
  const allowedCodes = codeSet(filters)
  const regionName = String(filters.region || '').trim()
  const from = isoDate(window.curFrom)
  const to = isoDate(window.now)
  let allowed = matchingTenderNos({ needle, groups })
  if (needle || groups.size) {
    const clauses = ['published >= ?', 'published <= ?']
    const args = [from, to]
    if (needle) {
      clauses.push('ingredient_f LIKE ?')
      args.push(`%${needle}%`)
    }
    if (groups.size) {
      clauses.push(`(${[...groups].map(() => 'group_name LIKE ?').join(' OR ')})`)
      args.push(...[...groups].map((group) => `%${group}%`))
    }
    try {
      const priced = await rowsOf(
        query,
        `SELECT ${hint('msc_prices')} DISTINCT tender_no
FROM msc_prices
WHERE ${clauses.join(' AND ')} AND tender_no <> ''`,
        args,
      )
      const next = allowed || new Set()
      for (const row of priced) if (row.tender_no) next.add(String(row.tender_no))
      allowed = next
    } catch {
      allowed = allowed || new Set()
    }
  }
  let tenders = []
  try {
    tenders = await rowsOf(
      query,
      `SELECT ${hint('msc_tenders')}
  source_id, tender_no, name, buyer, province, published, close_date, open_date, status_code, bid_price, bid_form, source_url
FROM msc_tenders`,
      [],
    )
  } catch {
    throw new Error('Chưa tải được dữ liệu và ngày mở thầu từ nguồn MSC. Vui lòng thử lại.')
  }
  const grouped = { open: [], review: [], closed: [] }
  const keys = monthKeys(window.curFrom, window.now)
  const byCode = new Map()
  const packageIds = new Set()
  const openings = new Map()
  for (const [code, name] of Object.entries(VN_PROVINCES)) {
    if (allowedCodes.size && !allowedCodes.has(code)) continue
    if (regionName && regionOf(code) !== regionName) continue
    byCode.set(code, { value: 0, lots: 0, buyers: new Set(), months: {}, packageIds: new Set(), packageMonths: new Map(keys.map((key) => [key, new Set()])) })
  }
  for (const row of tenders) {
    const kind = classifyPackage(row.status_code, row.close_date, window.now, window.curFrom)
    const tenderNo = String(row.tender_no || '').trim()
    const name = String(row.name || '').trim()
    const buyer = String(row.buyer || '').trim()
    const blob = fold(`${name} ${buyer}`)
    if (allowed && tenderNo && !allowed.has(tenderNo) && !(needle && blob.includes(needle))) continue
    if (allowed && !tenderNo && !(needle && blob.includes(needle))) continue
    if (buyerQuery && !fold(`${buyer} ${name}`).includes(buyerQuery)) continue
    const place = resolveProvince(row.province)
    if (!place.code && !allowedCodes.size && !regionName) {
      const packageId = tenderNo || String(row.source_id || '').trim()
      if (packageId) openings.set(packageId, { code: '', date: dayStamp(row.open_date) })
    }
    if (!place.code || !byCode.has(place.code)) continue
    const slot = byCode.get(place.code)
    const packageId = tenderNo || String(row.source_id || '').trim()
    if (packageId) openings.set(packageId, { code: place.code, date: dayStamp(row.open_date) })
    if (!kind || (statusNeed && kind !== statusNeed)) continue
    if (packageId && slot.packageIds.has(packageId)) continue
    const scope = scopeFor({ tender_no: tenderNo, source_id: row.source_id, source_url: row.source_url })
    const scopeLines = scope ? publicLines(scope.lots || []) : []
    const level = packageMatchFromLines(scopeLines)
    const value = num(row.bid_price)
    slot.value += value
    if (packageId) packageIds.add(packageId)
    if (packageId && !slot.packageIds.has(packageId)) {
      slot.packageIds.add(packageId)
      slot.lots += 1
    }
    if (buyer) slot.buyers.add(fold(buyer))
    const published = dayStamp(row.published)
    if (published && inSpan(published, window.curFrom, window.now)) {
      const key = ymOf(published)
      slot.months[key] = (slot.months[key] || 0) + value
    }
    grouped[kind].push({
      id: String(row.source_id || tenderNo || buyer),
      kind: 'package',
      name,
      buyer,
      province: place.label,
      provinceCode: place.code,
      region: regionOf(place.code),
      district: '',
      precision: 'province',
      placeNote: 'Mức tỉnh. Hồ sơ chỉ có tỉnh, chưa có tọa độ.',
      value,
      lots: scopeLines.length,
      status: kind,
      statusLabel: PACKAGE_STATUS[kind],
      tenderNo,
      closeDate: row.close_date || '',
      published: row.published || '',
      bidForm: row.bid_form || '',
      sourceUrl: row.source_url || '',
      baoanMatch: level,
      baoan_match: level,
      scopeLines,
      ingredients: scopeLines.map((line) => ({
        name: line.name,
        strength: line.strength,
        form: line.form,
        group: line.group,
        value: num(line.price) && num(line.qty) ? num(line.price) * num(line.qty) : num(line.price),
        quantity: num(line.qty),
        match: line.match,
        status: line.status || '',
        matchedCriteria: line.matchedCriteria || null,
        legalBasis: line.legalBasis || '',
        baoanHits: line.match === 'exact' || line.match === 'near' ? (line.hits || []).map((hit) => ({
          brand: hit.brand || '',
          strength: hit.strength || '',
          form: hit.form || '',
          reg: hit.reg || '',
        })) : [],
      })),
    })
  }
  for (const [packageId, opening] of openings) {
    const slot = byCode.get(opening.code)
    const key = opening.date ? ymOf(opening.date) : ''
    if (slot?.packageMonths.has(key)) slot.packageMonths.get(key).add(packageId)
  }
  const made = [...grouped.open, ...grouped.review, ...grouped.closed]
  const packageAreas = {}
  for (const dot of made) {
    const list = packageAreas[dot.provinceCode] || []
    list.push(dot)
    packageAreas[dot.provinceCode] = list
  }
  for (const list of Object.values(packageAreas)) {
    list.sort((a, b) => b.value - a.value)
    list.splice(40)
  }
  const packages = [...made].sort((a, b) => b.value - a.value).slice(0, 120)
  const provinces = [...byCode.entries()].map(([code, slot]) => {
    const trend = keys.map((key) => ({ key, value: num(slot.months[key]) }))
    const countTrend = countPoints(keys, slot.packageMonths)
    return {
      code,
      name: VN_PROVINCES[code] || code,
      region: regionOf(code),
      value: slot.value,
      prev: 0,
      yoy: slot.value > 0 ? null : 0,
      lots: slot.lots,
      facilities: slot.buyers.size,
      activeMonths: trend.filter((point) => point.value > 0).length,
      trend,
      countTrend,
      groups: [0, 0, 0, 0, 0],
    }
  }).sort((a, b) => b.value - a.value)
  const regions = REGION_ORDER
    .filter((name) => !regionName || name === regionName)
    .map((name) => rollup(provinces.filter((row) => row.region === name), keys, name, name, name))
  const summary = rollup(provinces, keys, '', 'Bộ lọc hiện tại', regionName)
  const openingCounts = new Map(summary.countTrend.map(point => [point.key, point.value]))
  for (const opening of openings.values()) {
    const key = opening.date ? ymOf(opening.date) : ''
    if (!opening.code && openingCounts.has(key)) openingCounts.set(key, openingCounts.get(key) + 1)
  }
  summary.countTrend = countPoints(keys, openingCounts)
  const ingredientPairs = []
  const rawByCode = {}
  const rawByRegion = {}
  for (const dot of made) {
    const lines = dot.scopeLines || []
    ingredientPairs.push(...lines)
    const list = rawByCode[dot.provinceCode] || []
    list.push(...lines)
    rawByCode[dot.provinceCode] = list
    const region = regionOf(dot.provinceCode)
    if (region) {
      const bucket = rawByRegion[region] || []
      bucket.push(...lines)
      rawByRegion[region] = bucket
    }
  }
  const ingredientAreas = {}
  for (const [code, lines] of Object.entries(rawByCode)) ingredientAreas[code] = rankScopeLines(lines, 40)
  for (const [region, lines] of Object.entries(rawByRegion)) ingredientAreas[region] = rankScopeLines(lines, 40)
  return {
    source: 'msc',
    months: window.months,
    summary,
    provinces,
    regions,
    dots: withDots ? [] : [],
    areaDots: {},
    dotTotal: made.length,
    truncated: made.length > packages.length,
    ingredients: rankScopeLines(ingredientPairs, 60),
    ingredientAreas,
    ingredientTitle: 'Hoạt chất trong gói thầu',
    ingredientNote: 'Giá trị là giá dự toán phần trong phạm vi gói đã cào. Gói chưa có hồ sơ không tách được hoạt chất.',
    ingredientValueLabel: 'Giá phần',
    ingredientQtyLabel: 'Số lượng',
    packages,
    packageAreas,
    packageTotal: packageIds.size,
    currentPackageCount: packageIds.size,
    trendMetric: 'packages',
    trendLabel: 'Số gói theo tháng',
  }
}
