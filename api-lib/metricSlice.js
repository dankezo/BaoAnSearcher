import { mapPayload, mapWindow } from './mapPayload.js'
import { groupDigit } from './metricsRollup.js'
import { baoanProducts } from './baoanCatalog.js'
import { fold } from './turso.js'
import { matchRows, publicLines, scopeFor } from './scopeMatch.js'

function hint(table) {
  return `/*+ READ_FROM_STORAGE(TIFLASH[${table}]) */`
}

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function iso(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function mondayKey(raw) {
  const match = String(raw || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return ''
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  const day = date.getDay()
  const delta = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + delta)
  return iso(date)
}

function addDays(key, days) {
  const match = String(key).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return key
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  date.setDate(date.getDate() + days)
  return iso(date)
}

async function rowsOf(query, sql, args) {
  const rs = await query(sql, args)
  return rs?.rows || []
}

export async function vssSlice(query, filters = {}, months = 12) {
  const payload = await mapPayload(query, {
    source: 'vss',
    months,
    dots: false,
    ingredients: false,
    filters: filters || {},
  })
  const provinces = (payload.provinces || [])
    .filter((row) => num(row.value) > 0 || num(row.prev) > 0)
    .map((row) => ({
      code: row.code,
      name: row.name,
      value: num(row.value),
      prev: num(row.prev),
      yoy: row.yoy,
      count: num(row.lots),
      groups: row.groups || [0, 0, 0, 0, 0],
    }))
  const totalValue = provinces.reduce((sum, row) => sum + row.value, 0)
  const base = totalValue || 1
  for (const row of provinces) row.share = (row.value / base) * 100
  provinces.sort((a, b) => b.value - a.value)
  return { section: 'vss', months: payload.months || months, provinces, totalValue }
}

function priceWhere(filters, to) {
  const clauses = ['published IS NOT NULL', 'published <= ?']
  const args = [to]
  const like = [
    ['ingredient_f', filters.ingredient],
    ['name_f', filters.name],
    ['province_f', filters.province],
  ]
  for (const [col, raw] of like) {
    const values = Array.isArray(raw) ? raw : (String(raw || '').trim() ? [raw] : [])
    const needles = values.map((value) => fold(value)).filter(Boolean)
    if (!needles.length) continue
    clauses.push(`(${needles.map(() => `${col} LIKE ?`).join(' OR ')})`)
    args.push(...needles.map((needle) => `%${needle}%`))
  }
  for (const word of fold(filters.q || '').split(/\s+/).filter(Boolean)) {
    clauses.push('(name_f LIKE ? OR ingredient_f LIKE ? OR search LIKE ?)')
    args.push(`%${word}%`, `%${word}%`, `%${word}%`)
  }
  return { clauses, args }
}

export async function mscPriceSlice(query, filters = {}, months = 12) {
  const window = mapWindow(months)
  const to = iso(window.now)
  const where = priceWhere(filters, to)
  const rows = await rowsOf(
    query,
    `SELECT ${hint('msc_prices')}
      COALESCE(province, '') AS province,
      COALESCE(group_name, '') AS group_name,
      DATE_FORMAT(published, '%Y-%m-%d') AS published,
      SUM(COALESCE(unit_price, 0) * COALESCE(quantity, 0)) AS revenue,
      SUM(COALESCE(quantity, 0)) AS qty,
      COUNT(*) AS cnt
    FROM msc_prices
    WHERE ${where.clauses.join(' AND ')}
    GROUP BY province, group_name, DATE_FORMAT(published, '%Y-%m-%d')`,
    where.args,
  )
  const curFrom = iso(window.curFrom)
  const prevFrom = iso(window.prevFrom)
  const prevEnd = iso(window.prevEnd)
  const series = new Map()
  const history = new Map()
  const provinces = new Map()
  const groups = [0, 0, 0, 0, 0]
  let prevRevenue = 0
  let records = 0
  let previousRecords = 0
  let minDate = ''
  let maxDate = ''
  for (const row of rows) {
    const day = String(row.published || '').slice(0, 10)
    if (!day) continue
    records += num(row.cnt)
    if (!minDate || day < minDate) minDate = day
    if (!maxDate || day > maxDate) maxDate = day
    const revenue = num(row.revenue)
    const qty = num(row.qty)
    const week = mondayKey(day)
    if (week && day <= to) {
      const bucket = history.get(week) || { qty: 0, revenue: 0 }
      bucket.qty += qty
      bucket.revenue += revenue
      history.set(week, bucket)
    }
    const current = day >= curFrom && day <= to
    const previous = day >= prevFrom && day <= prevEnd
    if (previous) previousRecords += num(row.cnt)
    if (!current && !previous) continue
    const name = String(row.province || '').trim() || 'Chưa xác định tỉnh'
    const prov = provinces.get(name) || { name, value: 0, prev: 0 }
    if (current) {
      prov.value += revenue
      const month = day.slice(0, 7)
      const point = series.get(month) || { key: month, label: `T${Number(day.slice(5, 7))}`, qty: 0, revenue: 0 }
      point.qty += qty
      point.revenue += revenue
      series.set(month, point)
      const digit = groupDigit(row.group_name)
      if (digit) groups[Number(digit) - 1] += revenue
    } else {
      prov.prev += revenue
      prevRevenue += revenue
    }
    provinces.set(name, prov)
  }
  const filled = [...history.keys()].filter((key) => history.get(key).revenue || history.get(key).qty).sort()
  const trend = []
  if (filled.length) {
    let cursor = filled[0]
    const last = mondayKey(to) || filled[filled.length - 1]
    while (cursor <= last) {
      const bucket = history.get(cursor) || { qty: 0, revenue: 0 }
      const [y, m, d] = cursor.split('-')
      trend.push({
        key: cursor,
        label: `${Number(d)}/${Number(m)}`,
        qty: bucket.qty,
        revenue: bucket.revenue,
        year: y,
      })
      cursor = addDays(cursor, 7)
    }
  }
  const ranked = [...provinces.values()].map((row) => {
    let growth = 0
    if (row.prev > 0) growth = ((row.value - row.prev) / row.prev) * 100
    else if (row.value > 0) growth = null
    return { ...row, growth }
  })
  ranked.sort((a, b) => {
    if (a.growth == null && b.growth == null) return b.value - a.value
    if (a.growth == null) return 1
    if (b.growth == null) return -1
    if (b.growth !== a.growth) return b.growth - a.growth
    return b.value - a.value
  })
  const byValue = [...provinces.values()].sort((a, b) => b.value - a.value)
  const points = [...series.values()].sort((a, b) => a.key.localeCompare(b.key))
  const revNow = points.reduce((sum, point) => sum + point.revenue, 0)
  const qtyNow = points.reduce((sum, point) => sum + point.qty, 0)
  const yoy = prevRevenue > 0 ? ((revNow - prevRevenue) / prevRevenue) * 100 : (revNow > 0 ? null : 0)
  return {
    section: 'msc_prices',
    months: window.months,
    series: trend,
    topGrowth: ranked.slice(0, 3),
    topProvinces: byValue.slice(0, 6).map((row) => ({
      name: row.name,
      value: row.value,
      prev: row.prev,
      growth: row.growth,
    })),
    groups,
    quantity: qtyNow,
    revenue: revNow,
    prevRevenue,
    yoy,
    coverage: {
      from: minDate || null,
      to: maxDate || null,
      records,
      previousRecords,
    },
  }
}

function isOpen(row, today) {
  const code = String(row.status_code || '').trim().toUpperCase()
  if (code) return false
  const close = String(row.close_date || '').slice(0, 10)
  return !close || close >= today
}

export async function mscTenderSlice(query, filters = {}, months = 12) {
  const window = mapWindow(months)
  const from = iso(window.curFrom)
  const today = iso(window.now)
  const rows = await rowsOf(
    query,
    `SELECT ${hint('msc_tenders')}
      tender_no, published, close_date, status_code, bid_price, name, buyer, province, source_url
    FROM msc_tenders
    WHERE published >= ?`,
    [from],
  )
  let openCount = 0
  let openValue = 0
  let reviewCount = 0
  let newCount = 0
  let closingCount = 0
  let exact = 0
  let near = 0
  let cached = 0
  const nowMs = window.now.getTime()
  for (const row of rows) {
    const name = fold(row.name || '')
    const province = fold(row.province || '')
    const buyer = fold(row.buyer || '')
    const tender = fold(row.tender_no || '')
    const needles = [
      ['name', name],
      ['province', province],
      ['buyer', buyer],
      ['tender_no', tender],
    ]
    let drop = false
    for (const [key, blob] of needles) {
      const raw = filters[key]
      const values = Array.isArray(raw) ? raw : (String(raw || '').trim() ? [raw] : [])
      const want = values.map((value) => fold(value)).filter(Boolean)
      if (want.length && !want.some((needle) => blob.includes(needle))) drop = true
    }
    const words = fold(filters.q || '').split(/\s+/).filter(Boolean)
    if (words.some((word) => !`${name} ${province} ${buyer} ${tender}`.includes(word))) drop = true
    if (drop) continue
    const code = String(row.status_code || '').trim().toUpperCase()
    const close = String(row.close_date || '').slice(0, 10)
    const opened = isOpen(row, today)
    if (code === 'DXT' || (!code && close && close < today)) reviewCount += 1
    if (!opened) continue
    openCount += 1
    openValue += num(row.bid_price)
    const published = String(row.published || '').slice(0, 10)
    if (published) {
      const stamp = Date.parse(`${published}T00:00:00`)
      if (Number.isFinite(stamp) && nowMs - stamp >= 0 && nowMs - stamp < 72 * 3600000) newCount += 1
    }
    if (close) {
      const stamp = Date.parse(`${close}T00:00:00`)
      const days = (stamp - nowMs) / 86400000
      if (days >= 0 && days < 7) closingCount += 1
    }
    const scope = scopeFor(row)
    if (scope && ['exact', 'near', 'none'].includes(scope.match)) cached += 1
    if (scope?.match === 'exact') exact += 1
    else if (scope?.match === 'near') near += 1
  }
  return {
    section: 'msc_tenders',
    months: window.months,
    openCount,
    openValue,
    matchExact: exact,
    matchNear: near,
    newCount,
    closingCount,
    reviewCount,
    cached,
    uncached: Math.max(0, openCount - cached),
  }
}

export async function mscMatchReport(query, filters = {}, level = 'all') {
  const window = mapWindow(Number(filters.metricMonths) || 12)
  const from = iso(window.curFrom)
  const today = iso(window.now)
  const rows = await rowsOf(
    query,
    `SELECT ${hint('msc_tenders')}
      tender_no, name, buyer, province, published, close_date, status_code, source_url
    FROM msc_tenders
    WHERE published >= ?`,
    [from],
  )
  const open = []
  for (const row of rows) {
    if (!isOpen(row, today)) continue
    const scope = scopeFor(row)
    if (!scope || (scope.match !== 'exact' && scope.match !== 'near')) continue
    row.baoan_match = scope.match
    row.scope_lines = publicLines(scope.lots || [], baoanProducts())
    open.push(row)
  }
  return { rows: matchRows(open, level) }
}

export async function slicePayload(query, body = {}) {
  const section = String(body.section || '')
  const filters = body.filters && typeof body.filters === 'object' ? body.filters : {}
  const months = Number(body.months) || 12
  if (section === 'vss') return vssSlice(query, filters, months)
  if (section === 'msc_prices') return mscPriceSlice(query, filters, months)
  if (section === 'msc_tenders') return mscTenderSlice(query, filters, months)
  if (section === 'msc_match') return mscMatchReport(query, filters, body.level || 'all')
  return { section, error: 'Không có chỉ số cho mục này' }
}
