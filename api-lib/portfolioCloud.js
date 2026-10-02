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
  return match ? `${match[1]}-${match[2]}-${match[3]}` : ''
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
    dosageForm: '',
    group: row.group_name || '',
    manufacturer: row.manufacturer || '',
    buyer: row.buyer || '',
    province: row.province || '',
    winner: row.winner || '',
    unit: row.unit || '',
    price: num(row.unit_price) || null,
    quantity: row.quantity == null ? null : num(row.quantity),
    sourceUrl: /^https:\/\/muasamcong\.mpi\.gov\.vn\//.test(row.source_url || '') ? row.source_url : '',
  }
}

function awardFromVss(row) {
  return {
    source: 'VSS',
    tenderNo: '',
    decision: '',
    date: day(row.tungay_hd),
    dateKind: 'Bắt đầu hợp đồng',
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
  if (registration != null && productId != null) {
    const detail = cached.heatmaps[productId] || { histories: {} }
    const items = detail.histories?.[registration] || []
    return { items, registration, productId }
  }
  const payload = {
    kpis: kpis(cached.rows),
    rows: cached.rows,
    meta: { backend: 'tidb', preparedFor: 'tidb' },
  }
  if (productId == null) {
    payload.details = cached.heatmaps
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

function kpis(rows) {
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
  }
}

async function assemble(query) {
  const catalog = baoanProducts()
  const regs = [...new Set(catalog.map((item) => item.reg_number).filter(Boolean))]
  const tokenSet = new Set()
  for (const item of catalog) tokensOf(item.inn).forEach((token) => tokenSet.add(token))
  const tokens = [...tokenSet].slice(0, 24)
  const davOwn = regs.length
    ? await rowsOf(query, `SELECT ${hint('dav_drugs')} so_dang_ky, ten_thuoc, hoat_chat, ham_luong, dang_bao_che, dong_goi, ngay_cap, ngay_het_han, cty_san_xuat, cty_dang_ky, so_quyet_dinh, con_hieu_luc FROM dav_drugs WHERE so_dang_ky IN (${regs.map(() => '?').join(',')})`, regs)
    : []
  const davCells = tokens.length
    ? await rowsOf(query, `SELECT ${hint('dav_drugs')} so_dang_ky, ten_thuoc, hoat_chat, ham_luong, dang_bao_che, ngay_cap, ngay_het_han, cty_san_xuat, cty_dang_ky, so_quyet_dinh, con_hieu_luc FROM dav_drugs WHERE con_hieu_luc = 1 AND (${tokens.map(() => 'hoat_chat_f LIKE ?').join(' OR ')})`, tokens.map((token) => `%${token}%`))
    : []
  const bySdk = new Map(davOwn.map((row) => [sdkKey(row.so_dang_ky), row]))
  const cells = new Map()
  for (const row of davCells) {
    if (!row.con_hieu_luc || !row.so_dang_ky) continue
    const key = cellKey(row.hoat_chat, row.ham_luong, row.dang_bao_che)
    if (!cells.has(key)) cells.set(key, new Map())
    cells.get(key).set(row.so_dang_ky, row)
  }
  const catalogRegs = new Set(regs.map(sdkKey))
  const msc = regs.length
    ? await rowsOf(query, `SELECT ${hint('msc_prices')} registration, name, ingredient, strength, unit_price, quantity, unit, group_name, manufacturer, buyer, province, tender_no, published, winner, source_url FROM msc_prices WHERE registration IN (${regs.map(() => '?').join(',')})`, regs)
    : []
  const vss = regs.length
    ? await rowsOf(query, `SELECT ${hint('vss_bids')} sodk, ten, hoatchat, hamluong, gia, soluong, donvitinh, nhomthau, nhasx, ten_cskcb, ten_tinh, ma_tinh, thanhtien, tungay_hd, nam FROM vss_bids WHERE sodk IN (${regs.map(() => '?').join(',')})`, regs)
    : []
  const history = new Map()
  for (const row of msc) {
    const key = sdkKey(row.registration)
    if (!history.has(key)) history.set(key, [])
    history.get(key).push(awardFromMsc(row))
  }
  for (const row of vss) {
    const key = sdkKey(row.sodk)
    if (!history.has(key)) history.set(key, [])
    history.get(key).push(awardFromVss(row))
  }
  for (const list of history.values()) {
    list.sort((a, b) => String(b.date).localeCompare(String(a.date)))
  }
  const heatRows = tokens.length
    ? await rowsOf(query, `SELECT ${hint('vss_bids')} hoatchat, ma_tinh, ten_tinh, ten_cskcb, SUM(COALESCE(thanhtien, 0)) AS value FROM vss_bids WHERE nam >= 2025 AND (${tokens.map(() => 'hoatchat_f LIKE ?').join(' OR ')}) GROUP BY hoatchat, ma_tinh, ten_tinh, ten_cskcb`, tokens.map((token) => `%${token}%`))
    : []
  const rows = []
  const heatmaps = {}
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
      competitors: rivals.map((rival) => ({ ...rival, ...summarize(history.get(sdkKey(rival.regNumber)) || []) })),
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
    rows.push(row)
  }
  return { rows, heatmaps }
}
