const API_BASE = import.meta.env.VITE_API_BASE || ''

async function request(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || res.statusText)
  }
  return res.json()
}

export async function health() {
  try {
    return await request('/api/health')
  } catch {
    return null
  }
}

export const api = {
  health,
  status: () => request('/api/status'),
  secrets: () => request('/api/secrets'),
  saveSecrets: (body) => request('/api/secrets', { method: 'POST', body: JSON.stringify(body) }),
  dm93: () => request('/api/dm93'),
  davSearch: (body) => request('/api/dav/search', { method: 'POST', body: JSON.stringify(body) }),
  davCrawl: (body) => request('/api/dav/crawl', { method: 'POST', body: JSON.stringify(body || {}) }),
  davCrawlStop: () => request('/api/dav/crawl/stop', { method: 'POST', body: '{}' }),
  davValidity: () => request('/api/dav/validity/rebuild', { method: 'POST', body: '{}' }),
  mscSearch: (body) => request('/api/msc/search', { method: 'POST', body: JSON.stringify(body) }),
  mscPrices: (body) => request('/api/msc/crawl/prices', { method: 'POST', body: JSON.stringify(body) }),
  mscTenders: (body) => request('/api/msc/crawl/tenders', { method: 'POST', body: JSON.stringify(body) }),
  vssSearch: (body) => request('/api/vss/search', { method: 'POST', body: JSON.stringify(body) }),
  vssCrawl: (body) => request('/api/vss/crawl', { method: 'POST', body: JSON.stringify(body || {}) }),
  vssImport: (body) => request('/api/vss/import', { method: 'POST', body: JSON.stringify(body || {}) }),
}

/** Static Pages fallback: load gzipped JSON if present */
export async function loadStaticGz(name) {
  try {
    const res = await fetch(`./data/${name}.json.gz`)
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    if (typeof DecompressionStream !== 'undefined') {
      const ds = new DecompressionStream('gzip')
      const stream = new Response(buf).body.pipeThrough(ds)
      const text = await new Response(stream).text()
      return JSON.parse(text)
    }
    // fallback: try plain json
    const plain = await fetch(`./data/${name}.json`)
    if (plain.ok) return plain.json()
    return null
  } catch {
    try {
      const plain = await fetch(`./data/${name}.json`)
      if (plain.ok) return plain.json()
    } catch { /* ignore */ }
    return null
  }
}

export const DAV_LOOKUP = 'https://dichvucong.dav.gov.vn/congbothuoc/index'

export function openDavLookup(tenThuoc) {
  try {
    navigator.clipboard?.writeText(tenThuoc || '')
  } catch { /* ignore */ }
  window.open(DAV_LOOKUP, '_blank', 'noopener,noreferrer')
}
