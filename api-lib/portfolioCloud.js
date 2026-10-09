import { baoanProducts } from './baoanCatalog.js'
import { fold } from './turso.js'

function hint(table) {
  return `/*+ READ_FROM_STORAGE(TIFLASH[${table}]) */`
}

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function day(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, '0')
    const d = String(value.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  const match = String(value || '').match(/(\d{4})-(\d{2})-(\d{2})/)
  if (match) return `${match[1]}-${match[2]}-${match[3]}`
  const vn = String(value || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  return vn ? `${vn[3]}-${vn[2].padStart(2, '0')}-${vn[1].padStart(2, '0')}` : ''
}

function awardWindow() {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
  const [year, month, date] = today.split('-').map(Number)
  const start = new Date(Date.UTC(year - 1, month - 1, date))
  if (start.getUTCMonth() !== month - 1) start.setUTCDate(0)
  return { from: start.toISOString().slice(0, 10), to: today }
}

function awardIdentity(item) {
  return [sdkKey(item.registration), groupNumber(item.group), fold(item.unit), item.price ?? '', item.quantity ?? '',
    fold(item.buyer), fold(item.province), day(item.date), String(item.tenderNo || '').trim()].join('|')
}

function dedupeAwards(items) {
  const ordered = [...items].sort((a, b) => Number(b.source === 'MSC') - Number(a.source === 'MSC'))
  const mscIds = new Set(ordered.filter(item => item.source === 'MSC').map(awardIdentity))
  const seen = new Set()
  return ordered.filter(item => {
    const identity = awardIdentity(item)
    if (item.source === 'VSS' && mscIds.has(identity)) return false
    const key = `${identity}|${String(item.tenderNo || '').trim()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function awards12m(rows) {
  const { from, to } = awardWindow()
  const items = dedupeAwards(rows).filter(item => item.date && item.date >= from && item.date <= to)
  const totals = new Map()
  const packages = new Set()
  let revenue = 0
  for (const item of items) {
    if (item.price != null && item.quantity != null) revenue += item.price * item.quantity
    if (item.unit && item.quantity != null) {
      const key = fold(item.unit)
      const slot = totals.get(key) || { unit: item.unit, quantity: 0 }
      slot.quantity += item.quantity
      totals.set(key, slot)
    }
    if (item.tenderNo) packages.add(`tender:${item.tenderNo}`)
  }
  return { revenue, quantityTotals: [...totals.values()], packages: packages.size, records: items.length, from, to }
}

function yearOf(value) {
  const match = day(value).match(/^(\d{4})/) || String(value || '').match(/((?:19|20)\d{2})/)
  return match ? match[1] : ''
}

function monthsLeft(value) {
  const iso = day(value)
  if (!iso) return null
  const end = Date.parse(`${iso}T00:00:00`)
  if (!Number.isFinite(end)) return null
  return (end - Date.now()) / (30.4375 * 86400000)
}

function sdkKey(value) {
  return fold(value).replace(/[^a-z0-9]/g, '')
}

function cellKey(inn, strength, form) {
  return `${fold(inn)}|${fold(strength).replace(/\s+/g, '')}|${fold(form)}`
}

function tokensOf(inn) {
  return [...new Set(fold(inn).split(/[^a-z0-9]+/).filter((word) => word.length >= 5))].slice(0, 4)
}

function isBaoAn(...names) {
  return names.some((name) => fold(name).includes('bao an'))
}

function groupNumber(value) {
  const text = fold(value)
  return text.match(/n\s*([1-5])\b/)?.[1] || text.match(/\b([1-5])\b/)?.[1] || ''
}

function normalizedStrength(value) {
  return fold(value).replace(/,/g, '.').replace(/\s+/g, '').replace(/microgam|µg|μg/g, 'mcg')
}

function comparable(a, b) {
  return a?.price > 0 && b?.price > 0
    && Boolean(a.ingredient && fold(a.ingredient) === fold(b.ingredient))
    && Boolean(a.strength && normalizedStrength(a.strength) === normalizedStrength(b.strength))
    && Boolean(a.dosageForm && fold(a.dosageForm) === fold(b.dosageForm))
    && Boolean(groupNumber(a.group) && groupNumber(a.group) === groupNumber(b.group))
    && Boolean(a.unit && fold(a.unit) === fold(b.unit))
}

export function compareAwards(ownHistory, rivalHistory) {
  const pairs = ownHistory.flatMap((own) => rivalHistory
    .filter((rival) => comparable(own, rival))
    .map((rival) => ({ own, rival })))
  if (!pairs.length) {
    const hasPrices = [...ownHistory, ...rivalHistory].some((item) => item.price > 0)
    return { priceDeltaPct: null, comparisonNote: hasPrices
      ? 'Chưa có cặp giá trúng thầu cùng hoạt chất, hàm lượng, dạng bào chế, nhóm và đơn vị để so sánh'
      : 'Chưa có giá trúng thầu hợp lệ để so sánh' }
  }
  const { own, rival } = pairs.sort((a, b) => {
    const aMin = [a.own.date, a.rival.date].sort()[0]
    const bMin = [b.own.date, b.rival.date].sort()[0]
    return bMin.localeCompare(aMin) || [b.own.date, b.rival.date].sort().at(-1).localeCompare([a.own.date, a.rival.date].sort().at(-1))
  })[0]
  return {
    priceDeltaPct: (rival.price / own.price - 1) * 100,
    comparisonNote: `So sánh ${own.ingredient} · ${own.strength} · ${own.dosageForm} · ${own.group} · ${own.unit} (${own.date}: ${own.price} VNĐ / ${rival.date}: ${rival.price} VNĐ)`,
    comparisonOwnAward: own,
    comparisonAward: rival,
  }
}

export function mscProfileUrl(value) {
  try {
    const url = new URL(String(value || ''))
    return url.protocol === 'https:' && url.hostname === 'muasamcong.mpi.gov.vn' && Boolean(url.searchParams.get('id'))
      ? url.toString()
      : ''
  } catch {
    return ''
  }
}

async function rowsOf(query, sql, args) {
  const rs = await query(sql, args)
  return rs?.rows || []
}

function summarize(history) {
  const priced = history.filter((item) => item.price > 0)
  const latest = priced[0] || null
  const source = history.some((item) => item.source === 'MSC') ? 'MSC' : 'VSS'
  const quantities = history.filter((item) => item.source === source && item.quantity != null)
  const units = new Set(quantities.map((item) => fold(item.unit)))
  const quantity = quantities.length && units.size === 1 && !units.has('')
    ? quantities.reduce((sum, item) => sum + item.quantity, 0)
    : null
  const totals = new Map()
  for (const item of history) {
    if (item.quantity == null || !item.unit) continue
    const key = `${item.source}|${fold(item.unit)}`
    const slot = totals.get(key) || { source: item.source, unit: item.unit, quantity: 0 }
    slot.quantity += item.quantity
    totals.set(key, slot)
  }
  return {
    latestAward: latest,
    mscPrice: latest ? latest.price : null,
    mscUnit: latest ? latest.unit : '',
    mscGroup: latest ? latest.group : '',
    awardCount: history.length,
    totalQuantity: quantity,
    quantityUnit: quantity != null ? quantities[0].unit : '',
    quantityTotals: [...totals.values()],
  }
}

function awardFromMsc(row) {
  return {
    source: 'MSC',
    tenderNo: row.tender_no || '',
    decision: '',
    date: day(row.published),
    dateKind: 'Ngày công bố',
    name: row.name || '',
    registration: row.registration || '',
    ingredient: row.ingredient || '',
    strength: row.strength || '',
    dosageForm: row.dosage_form || '',
    group: row.group_name || '',
    manufacturer: row.manufacturer || '',
    buyer: row.buyer || '',
    province: row.province || '',
    winner: row.winner || '',
    unit: row.unit || '',
    price: num(row.unit_price) || null,
    quantity: row.quantity == null ? null : num(row.quantity),
    sourceUrl: mscProfileUrl(row.source_url),
  }
}

function awardFromVss(row) {
  return {
    source: 'VSS',
    tenderNo: row.goithau || row.tender_no || '',
    decision: '',
    date: day(row.tungay_hd) || day(row.tungay_hd_raw) || day(row.congbo),
    dateKind: row.tungay_hd || row.tungay_hd_raw ? 'Bắt đầu hợp đồng' : 'Ngày công bố',
    name: row.ten || '',
    registration: row.sodk || '',
    ingredient: row.hoatchat || '',
    strength: row.hamluong || '',
    dosageForm: '',
    group: row.nhomthau || '',
    manufacturer: row.nhasx || '',
    buyer: row.ten_cskcb || '',
    province: row.ten_tinh || '',
    winner: '',
    unit: row.donvitinh || '',
    price: num(row.gia) || null,
    quantity: row.soluong == null ? null : num(row.soluong),
    sourceUrl: '',
  }
}

let memory = { at: 0, payload: null }

export async function buildPortfolio(query, productId = null, registration = null) {
  if (!memory.payload || Date.now() - memory.at > 10 * 60 * 1000) {
    memory.payload = await assemble(query)
    memory.at = Date.now()
  }
  const cached = memory.payload
  const extra = cached.heatmaps.__portfolio || {}
  if (registration != null && productId != null) {
    const detail = cached.heatmaps[productId] || { histories: {} }
    const items = detail.histories?.[registration] || []
    return { items, registration, productId }
  }
  const payload = {
    kpis: kpis(cached.rows, extra.awardRows || []),
    rows: cached.rows,
    awardRows: extra.awardRows || [],
    newRegistrations: extra.newRegistrations || [],
    meta: { backend: 'tidb', preparedFor: 'tidb' },
  }
  if (productId == null) {
    payload.details = Object.fromEntries(Object.entries(cached.heatmaps).filter(([key]) => key !== '__portfolio'))
    return payload
  }
  const detail = cached.heatmaps[productId] || { provinces: [], facilities: [], histories: {} }
  return {
    ...payload,
    selectedId: productId,
    provinces: detail.provinces || [],
    facilities: detail.facilities || [],
  }
}

function kpis(rows, awardRows = []) {
  const total = rows.length || 1
  const years = rows.map((row) => Number(yearOf(row.expDate))).filter((year) => year >= 1990)
  const plants = new Map()
  for (const row of rows) {
    const key = fold(row.manufacturer || '') || 'chua ro'
    const slot = plants.get(key) || { name: row.manufacturer || 'Chưa rõ xưởng', count: 0 }
    slot.count += 1
    if ((row.manufacturer || '').length > slot.name.length) slot.name = row.manufacturer
    plants.set(key, slot)
  }
  const ranked = [...plants.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  const top = ranked[0] || { name: 'Chưa rõ xưởng', count: 0 }
  const live = rows.filter((row) => row.liveSdk).length
  const green = rows.filter((row) => row.cycleGreen).length
  const won = rows.filter((row) => row.wonBid).length
  return {
    scale: { sku: rows.length, categories: new Set(rows.map((row) => row.category).filter(Boolean)).size, liveSdk: live, liveSdkPct: live / total },
    cycle: {
      green,
      greenPct: green / total,
      expiryFrom: years.length ? Math.min(...years) : null,
      expiryTo: years.length ? Math.max(...years) : null,
      ready36: rows.filter((row) => (row.monthsLeft || 0) >= 36).length,
    },
    golden: { count: rows.filter((row) => (row.competitorCount || 0) <= 2).length },
    bids: { won, total: rows.length, waiting: rows.length - won },
    cmo: {
      top: top.name,
      topCount: top.count,
      topPct: top.count / total,
      shares: ranked.map((item) => ({ name: item.name, count: item.count, pct: item.count / total })),
    },
    awards12m: awards12m(awardRows),
  }
}

async function assemble(query) {
  const catalog = baoanProducts()
  const regs = [...new Set(catalog.map((item) => item.reg_number).filter(Boolean))]
  const tokenSet = new Set()
  for (const item of catalog) tokensOf(item.inn).forEach((token) => tokenSet.add(token))
  const tokens = [...tokenSet].slice(0, 24)
  const davOwn = regs.length
    ? await rowsOf(query, `SELECT ${hint('dav_drugs')} so_dang_ky, so_dang_ky_cu, ten_thuoc, hoat_chat, ham_luong, dang_bao_che, dong_goi, ngay_cap, ngay_het_han, cty_san_xuat, cty_dang_ky, so_quyet_dinh, con_hieu_luc FROM dav_drugs WHERE so_dang_ky IN (${regs.map(() => '?').join(',')})`, regs)
    : []
  const davCells = tokens.length
    ? await rowsOf(query, `SELECT ${hint('dav_drugs')} so_dang_ky, so_dang_ky_cu, ten_thuoc, hoat_chat, ham_luong, dang_bao_che, ngay_cap, ngay_het_han, cty_san_xuat, cty_dang_ky, so_quyet_dinh, con_hieu_luc FROM dav_drugs WHERE con_hieu_luc = 1 AND (${tokens.map(() => 'hoat_chat_f LIKE ?').join(' OR ')})`, tokens.map((token) => `%${token}%`))
    : []
  const bySdk = new Map()
  for (const row of davOwn) for (const reg of [row.so_dang_ky, row.so_dang_ky_cu]) if (reg) bySdk.set(sdkKey(reg), row)
  const cells = new Map()
  for (const row of davCells) {
    if (!row.con_hieu_luc || !row.so_dang_ky) continue
    const key = cellKey(row.hoat_chat, row.ham_luong, row.dang_bao_che)
    if (!cells.has(key)) cells.set(key, new Map())
    cells.get(key).set(row.so_dang_ky, row)
  }
  const catalogRegs = new Set(regs.map(sdkKey))
  const awardRegs = new Set(regs)
  for (const item of catalog) {
    const dav = bySdk.get(sdkKey(item.reg_number || ''))
    const key = cellKey(dav?.hoat_chat || item.inn || '', dav?.ham_luong || item.strength || '', dav?.dang_bao_che || item.dosage_form || '')
    for (const info of cells.get(key)?.values() || []) awardRegs.add(info.so_dang_ky)
  }
  const aliases = new Map()
  for (const row of [...davOwn, ...davCells]) {
    if (!row.so_dang_ky_cu) continue
    const keys = [sdkKey(row.so_dang_ky), sdkKey(row.so_dang_ky_cu)].filter(Boolean)
    for (const key of keys) aliases.set(key, keys)
    if (awardRegs.has(row.so_dang_ky)) awardRegs.add(row.so_dang_ky_cu)
  }
  const awardRegistrations = [...awardRegs].filter(Boolean)
  const msc = awardRegistrations.length
    ? await rowsOf(query, `SELECT ${hint('msc_prices')} registration, name, ingredient, strength, dosage_form, unit_price, quantity, unit, group_name, manufacturer, buyer, province, tender_no, published, winner, source_url FROM msc_prices WHERE registration IN (${awardRegistrations.map(() => '?').join(',')})`, awardRegistrations)
    : []
  const vss = awardRegistrations.length
    ? await rowsOf(query, `SELECT ${hint('vss_bids')} sodk, ten, hoatchat, hamluong, gia, soluong, donvitinh, nhomthau, nhasx, ten_cskcb, ten_tinh, ma_tinh, thanhtien, tungay_hd, tungay_hd_raw, congbo, nam FROM vss_bids WHERE sodk IN (${awardRegistrations.map(() => '?').join(',')})`, awardRegistrations)
    : []
  const tenderNumbers = [...new Set(msc.filter(row => !mscProfileUrl(row.source_url)).map(row => row.tender_no).filter(Boolean))]
  const profiles = tenderNumbers.length
    ? await rowsOf(query, `SELECT ${hint('msc_tenders')} tender_no, source_url FROM msc_tenders WHERE tender_no IN (${tenderNumbers.map(() => '?').join(',')})`, tenderNumbers)
    : []
  const profileByTender = new Map()
  for (const row of profiles) {
    const url = mscProfileUrl(row.source_url)
    if (url) profileByTender.set(row.tender_no, url)
  }
  const history = new Map()
  for (const row of msc) {
    const primary = sdkKey(row.registration)
    for (const key of aliases.get(primary) || [primary]) {
      if (!history.has(key)) history.set(key, [])
      history.get(key).push(awardFromMsc({ ...row, source_url: mscProfileUrl(row.source_url) || profileByTender.get(row.tender_no) || '' }))
    }
  }
  for (const row of vss) {
    const primary = sdkKey(row.sodk)
    for (const key of aliases.get(primary) || [primary]) {
      if (!history.has(key)) history.set(key, [])
      history.get(key).push(awardFromVss(row))
    }
  }
  for (const list of history.values()) {
    list.sort((a, b) => String(b.date).localeCompare(String(a.date)))
  }
  const heatRows = tokens.length
    ? await rowsOf(query, `SELECT ${hint('vss_bids')} hoatchat, ma_tinh, ten_tinh, ten_cskcb, SUM(COALESCE(thanhtien, 0)) AS value FROM vss_bids WHERE nam >= 2025 AND (${tokens.map(() => 'hoatchat_f LIKE ?').join(' OR ')}) GROUP BY hoatchat, ma_tinh, ten_tinh, ten_cskcb`, tokens.map((token) => `%${token}%`))
    : []
  const rows = []
  const heatmaps = {}
  const awardRows = []
  const newRegistrations = new Map()
  const awardRange = awardWindow()
  for (const item of catalog) {
    const dav = bySdk.get(sdkKey(item.reg_number || ''))
    const inn = dav?.hoat_chat || item.inn || ''
    const strength = dav?.ham_luong || item.strength || ''
    const dosage = dav?.dang_bao_che || item.dosage_form || ''
    const own = dav?.so_dang_ky || item.reg_number || ''
    const key = cellKey(dav?.hoat_chat || inn, dav?.ham_luong || item.strength || '', dav?.dang_bao_che || item.dosage_form || '')
    const rivals = []
    for (const [sdk, info] of cells.get(key) || []) {
      if (sdkKey(sdk) === sdkKey(own) || catalogRegs.has(sdkKey(sdk))) continue
      if (isBaoAn(info.cty_san_xuat, info.cty_dang_ky)) continue
      rivals.push({
        regNumber: info.so_dang_ky,
        name: info.ten_thuoc || '',
        manufacturer: info.cty_san_xuat || '',
        inn: info.hoat_chat || inn,
        strength: info.ham_luong || '',
        dosageForm: info.dang_bao_che || '',
        ctyDangKy: info.cty_dang_ky || '',
        soQuyetDinh: info.so_quyet_dinh || '',
        grantYear: yearOf(info.ngay_cap),
        expDate: day(info.ngay_het_han),
      })
    }
    const left = monthsLeft(dav?.ngay_het_han || item.exp_date)
    const live = Boolean(Number(dav?.con_hieu_luc))
    const tag = !live ? 'TAG_XAM_LICH_SU' : (left != null && left >= 18 ? 'TAG_XANH_LA' : 'TAG_VANG_XAC_MINH')
    const ownHistory = history.get(sdkKey(own)) || []
    awardRows.push(...dedupeAwards(ownHistory).map(award => ({ ...award, productId: item.id, brandName: item.brand_name || '' })))
    const row = {
      id: item.id,
      brandName: item.brand_name || '',
      regNumber: own,
      inn,
      strength,
      dosageForm: dosage,
      route: item.route || '',
      packing: dav?.dong_goi || item.packing || '',
      category: item.category || '',
      therapyClass: item.therapy_class || '',
      beCandidate: Boolean(item.be_candidate),
      manufacturer: dav?.cty_san_xuat || item.manufacturer || '',
      expDate: day(dav?.ngay_het_han || item.exp_date),
      grantYear: yearOf(dav?.ngay_cap),
      soQuyetDinh: dav?.so_quyet_dinh || '',
      ctyDangKy: dav?.cty_dang_ky || '',
      tag,
      webUrl: item.web_url || '',
      strategyNote: item.strategy_note || '',
      competitorCount: rivals.length,
      competitors: rivals.map((rival) => {
        const rivalHistory = history.get(sdkKey(rival.regNumber)) || []
        return { ...rival, ...summarize(rivalHistory), ...compareAwards(ownHistory, rivalHistory) }
      }),
      statusColor: rivals.length <= 2 ? 'GREEN' : rivals.length <= 4 ? 'YELLOW' : 'RED',
      wonBid: ownHistory.length > 0,
      dm93: false,
      isNicheGold: rivals.length <= 2,
      cycleGreen: tag === 'TAG_XANH_LA',
      monthsLeft: left == null ? null : Math.round(left * 10) / 10,
      liveSdk: live,
      recommendation: rivals.length <= 2 ? 'Toa do Vang' : 'Theo doi thi truong',
      ...summarize(ownHistory),
    }
    const innTokens = tokensOf(inn)
    const market = heatRows.filter((bid) => innTokens.some((token) => fold(bid.hoatchat).includes(token)))
    const provinces = new Map()
    const facilities = new Map()
    for (const bid of market) {
      const code = String(bid.ma_tinh || '').padStart(2, '0')
      const prov = provinces.get(code) || { maTinh: code, tenTinh: bid.ten_tinh || '', value: 0 }
      prov.value += num(bid.value)
      provinces.set(code, prov)
      const fac = bid.ten_cskcb || ''
      if (fac) {
        const slot = facilities.get(fac) || { name: fac, province: bid.ten_tinh || '', value: 0 }
        slot.value += num(bid.value)
        facilities.set(fac, slot)
      }
    }
    const histories = { [own]: ownHistory }
    for (const rival of rivals) histories[rival.regNumber] = history.get(sdkKey(rival.regNumber)) || []
    heatmaps[item.id] = {
      provinces: [...provinces.values()].sort((a, b) => b.value - a.value),
      facilities: [...facilities.values()].sort((a, b) => b.value - a.value).slice(0, 12),
      histories,
    }
    const ownGroups = new Set(ownHistory.map(award => groupNumber(award.group)).filter(Boolean).map(group => `N${group}`))
    for (const [rivalSdk, info] of cells.get(key) || []) {
      const rivalKey = sdkKey(rivalSdk)
      const grantDate = day(info.ngay_cap)
      if (!rivalKey || catalogRegs.has(rivalKey) || !grantDate || grantDate < awardRange.from || grantDate > awardRange.to
          || isBaoAn(info.cty_san_xuat, info.cty_dang_ky)) continue
      const rivalHistory = history.get(rivalKey) || []
      const rivalGroups = new Set(rivalHistory.map(award => groupNumber(award.group)).filter(Boolean).map(group => `N${group}`))
      const matchedGroups = [...ownGroups].filter(group => rivalGroups.has(group)).sort()
      if (ownGroups.size && rivalGroups.size && !matchedGroups.length) continue
      const slot = newRegistrations.get(rivalKey) || {
        regNumber: rivalSdk, name: info.ten_thuoc || '', inn: info.hoat_chat || inn,
        strength: info.ham_luong || strength, dosageForm: info.dang_bao_che || dosage,
        grantDate, ctyDangKy: info.cty_dang_ky || '', groups: new Set(), groupKnown: false, matches: new Map(),
      }
      matchedGroups.forEach(group => slot.groups.add(group))
      slot.groupKnown = slot.groups.size > 0
      slot.matches.set(item.id, {
        id: item.id, brandName: item.brand_name || '', inn, strength, dosageForm: dosage, groups: [...ownGroups].sort(),
      })
      newRegistrations.set(rivalKey, slot)
    }
    rows.push(row)
  }
  heatmaps.__portfolio = {
    awardRows,
    newRegistrations: [...newRegistrations.values()].map(row => ({
      ...row, groups: [...row.groups].sort(), matches: [...row.matches.values()],
    })).sort((a, b) => b.grantDate.localeCompare(a.grantDate)),
  }
  return { rows, heatmaps }
}
