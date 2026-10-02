const LOW = {
  vss: ['ma_tinh', 'ten_tinh', 'nhomthau'],
  msc: ['province', 'group_name'],
  msc_prices: ['province', 'group_name'],
  msc_tenders: ['province', 'group_name'],
}

let pending

export function loadSuggestStatic() {
  if (!pending) {
    pending = fetch('/data/suggest-static.json').then((res) => {
      if (!res.ok) throw new Error('static suggest')
      return res.json()
    })
  }
  return pending
}

export function isLowCard(section, field) {
  return (LOW[section] || LOW[String(section).startsWith('msc') ? 'msc' : ''] || []).includes(field)
}

function fold(text) {
  const s = String(text ?? '').toLowerCase().replace(/đ/g, 'd')
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export async function staticSuggest(section, field, q) {
  const doc = await loadSuggestStatic()
  const bucket = doc[section] || (String(section).startsWith('msc') ? doc.msc : null) || {}
  const list = bucket[field] || []
  const needle = fold(q)
  return list.filter((item) => {
    const value = typeof item === 'string' ? item : item.value
    const label = typeof item === 'string' ? item : (item.label || item.value)
    return !needle || fold(value).includes(needle) || fold(label).includes(needle)
  }).slice(0, 12)
}

export function resetSuggestStatic() {
  pending = null
}
