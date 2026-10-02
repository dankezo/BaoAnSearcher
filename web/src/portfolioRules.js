/** Portfolio cockpit rules. Pure functions, no database client. */

export function statusColor(competitorCount) {
  const count = Number(competitorCount)
  if (!Number.isFinite(count)) return 'RED'
  if (count <= 2) return 'GREEN'
  if (count <= 4) return 'YELLOW'
  return 'RED'
}

export function isDm93(row) {
  return row?.dm93 === true || row?.dm93 === 'match' || row?.dm93Status === 'match'
}

export function recommendation(row) {
  const dm93 = isDm93(row)
  const count = Number(row?.competitorCount)
  const color = row?.statusColor || statusColor(count)
  const inn = fold(row?.inn || row?.hoatChat || '')
  const strength = fold(row?.strength || row?.hamLuong || '')
  const therapy = String(row?.therapyClass || row?.therapy_class || '')
  const beCandidate = !!(row?.beCandidate || row?.be_candidate)
  if (dm93 && color === 'RED') return 'Kiem soat gia, ne thau mo'
  if (dm93) return 'Huong bao ho DM93 (Dieu 56)'
  if (Number.isFinite(count) && count <= 2 && inn.includes('diosmin') && strength.includes('1000')) {
    return 'Thau So gom, uu the lieu'
  }
  if (Number.isFinite(count) && count <= 2) return 'Toa do Vang'
  if (Number.isFinite(count) && count >= 3 && count <= 4 && (therapy === 'cardio' || therapy === 'antibiotic' || beCandidate)) {
    return 'Lap de an BE len Nhom 3'
  }
  return 'Theo doi thi truong'
}

export function dm93Shield(row) {
  return isDm93(row)
}

export function aggregateKpis(rows) {
  const list = Array.isArray(rows) ? rows : []
  const total = list.length
  const categories = new Set(list.map((row) => row.category).filter(Boolean))
  const live = list.filter((row) => row.liveSdk || row.conHieuLuc).length
  const green = list.filter((row) => row.cycleGreen).length
  const years = list
    .map((row) => Number(String(row.expDate || row.exp_date || '').slice(0, 4)))
    .filter((year) => year >= 2000)
  const ready36 = list.filter((row) => Number(row.monthsLeft) >= 36).length
  const golden = list.filter((row) => Number(row.competitorCount) <= 2).length
  const won = list.filter((row) => row.wonBid).length
  const plants = new Map()
  for (const row of list) {
    const name = row.manufacturer || 'Chưa rõ xưởng'
    const key = fold(name) || 'chua ro'
    const current = plants.get(key) || { name, count: 0 }
    current.count += 1
    if (name.length > current.name.length) current.name = name
    plants.set(key, current)
  }
  const ranked = [...plants.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'vi'))
  const top = ranked[0] || { name: 'Chưa rõ xưởng', count: 0 }
  return {
    scale: {
      sku: total,
      categories: categories.size,
      liveSdk: live,
      liveSdkPct: total ? live / total : 0,
    },
    cycle: {
      green,
      greenPct: total ? green / total : 0,
      expiryFrom: years.length ? Math.min(...years) : null,
      expiryTo: years.length ? Math.max(...years) : null,
      ready36,
    },
    golden: { count: golden },
    bids: { won, total, waiting: total - won },
    cmo: {
      top: top.name,
      topCount: top.count,
      topPct: total ? top.count / total : 0,
      shares: ranked.map((item) => ({ name: item.name, count: item.count, pct: total ? item.count / total : 0 })),
    },
  }
}

/** Format a VND amount as tỷ / triệu. Optional per-year suffix for market flow. */
export function formatVnd(value, { perYear = false } = {}) {
  if (value == null || value === '') return '—'
  const amount = Number(value)
  if (!Number.isFinite(amount)) return '—'
  const sign = amount < 0 ? '-' : ''
  const abs = Math.abs(amount)
  const suffix = perYear ? '/năm' : ''
  const digits = (n) => n.toLocaleString('vi-VN', { maximumFractionDigits: 1 })
  if (abs >= 1e12) return `${sign}${digits(abs / 1e12)} nghìn tỷ${suffix}`
  if (abs >= 1e9) return `${sign}${digits(abs / 1e9)} tỷ${suffix}`
  if (abs >= 1e6) return `${sign}${digits(abs / 1e6)} triệu${suffix}`
  return `${sign}${Math.round(abs).toLocaleString('vi-VN')} đ${suffix}`
}

/** A rival undercuts Bảo An when the compared award price is lower. */
export function rivalUndercuts(row) {
  return (row?.competitors || []).some((item) => Number(item?.priceDeltaPct) < 0)
}

export function fold(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}
