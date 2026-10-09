/**
 * Path → handler id. The catch-all function imports only the matched module.
 * methods includes OPTIONS where the old route answered preflight with 204.
 */
export const ROUTES = {
  'analytics/suggest': { methods: ['GET'], handler: 'analytics' },
  'analytics/overview': { methods: ['POST'], handler: 'analytics' },
  'analytics/detail': { methods: ['POST'], handler: 'analytics' },
  'analytics/ai-insight': { methods: ['POST'], handler: 'analytics' },
  'analytics/awards': { methods: ['POST'], handler: 'analytics' },
  'analytics/company-profile': { methods: ['POST'], handler: 'analytics' },
  'tender/search': { methods: ['POST', 'OPTIONS'], handler: 'tenderSearch' },
  'tender/count': { methods: ['POST', 'OPTIONS'], handler: 'tenderCount' },
  'tender/metrics': { methods: ['GET', 'POST', 'OPTIONS'], handler: 'tenderMetrics' },
  'tender/bootstrap': { methods: ['GET', 'POST', 'OPTIONS'], handler: 'tenderBootstrap' },
  'tender/meta': { methods: ['GET', 'POST', 'OPTIONS'], handler: 'tenderMeta' },
  'tender/suggest': { methods: ['GET', 'OPTIONS'], handler: 'tenderSuggest' },
  'admin/datasets': { methods: ['GET', 'OPTIONS'], handler: 'adminDatasets' },
  'metrics/map': { methods: ['POST', 'OPTIONS'], handler: 'metricsMap' },
  'metrics/map/facility-ingredients': { methods: ['POST', 'OPTIONS'], handler: 'metricsMap' },
  regulatory: { methods: ['GET', 'POST'], handler: 'regulatory' },
  'regulatory-daily': { methods: ['GET'], handler: 'regulatoryDaily' },
  'gemini/analyze-legal': { methods: ['POST'], handler: 'geminiLegal' },
  'gemini/analyze-news': { methods: ['POST'], handler: 'geminiNews' },
}

function pathFromQuery(value) {
  if (Array.isArray(value) && value.length) {
    return value.map((part) => decodeURIComponent(String(part))).filter(Boolean).join('/')
  }
  if (typeof value === 'string' && value) {
    return value.split('/').map((part) => decodeURIComponent(part)).filter(Boolean).join('/')
  }
  return ''
}

export function requestPath(req) {
  const stamped = pathFromQuery(req?.query?.__route) || pathFromQuery(req?.query?.route)
  if (stamped) return stamped
  const raw = String(req?.url || '/')
  let pathname = raw
  try {
    pathname = raw.startsWith('http') ? new URL(raw).pathname : raw.split('?')[0]
  } catch {
    pathname = raw.split('?')[0]
  }
  return pathname.replace(/^\/api\/?/, '').replace(/^\/+|\/+$/g, '')
}

/** Put the public /api/... URL back before a handler reads req.url. */
export function restoreRequestUrl(req, path) {
  const base = new URL(req?.url || '/', 'https://app.baoanpharma.com')
  base.searchParams.delete('__route')
  base.pathname = path ? `/api/${path}` : '/api'
  req.url = `${base.pathname}${base.search}`
  if (req.query && Object.prototype.hasOwnProperty.call(req.query, '__route')) delete req.query.__route
}

export function matchRoute(method, path) {
  const key = String(path || '').replace(/^\/+|\/+$/g, '')
  const entry = ROUTES[key]
    || (/^admin\/datasets\/download\/(DAV|MSC_PRICE|MSC_BID|VSS)$/i.test(key)
      ? { methods: ['GET', 'OPTIONS'], handler: 'adminDatasetDownload' }
      : null)
  if (!entry) return { kind: 'missing' }
  const verb = String(method || 'GET').toUpperCase()
  if (!entry.methods.includes(verb)) {
    return { kind: 'method', allow: entry.methods }
  }
  return { kind: 'ok', handler: entry.handler }
}
