/**
 * The only Vercel Serverless Function. vercel.json rewrites every /api/* URL here
 * because the Hobby builder does not match a catch-all file to nested paths.
 * Handlers live in api-lib/routes and are imported only after the path matches.
 */
export const config = { maxDuration: 300 }

import { json } from '../api-lib/auth.js'
import { matchRoute, requestPath, restoreRequestUrl } from '../api-lib/routeTable.js'

const LOADERS = {
  analytics: () => import('../api-lib/routes/analytics.js'),
  tenderSearch: () => import('../api-lib/routes/tenderSearch.js'),
  tenderCount: () => import('../api-lib/routes/tenderCount.js'),
  tenderMetrics: () => import('../api-lib/routes/tenderMetrics.js'),
  tenderBootstrap: () => import('../api-lib/routes/tenderBootstrap.js'),
  tenderMeta: () => import('../api-lib/routes/tenderMeta.js'),
  tenderSuggest: () => import('../api-lib/routes/tenderSuggest.js'),
  adminDatasets: () => import('../api-lib/routes/adminDatasets.js'),
  adminDatasetDownload: () => import('../api-lib/routes/adminDatasetDownload.js'),
  metricsMap: () => import('../api-lib/routes/metricsMap.js'),
  regulatory: () => import('../api-lib/routes/regulatory.js'),
  regulatoryDaily: () => import('../api-lib/routes/regulatoryDaily.js'),
  geminiLegal: () => import('../api-lib/routes/geminiLegal.js'),
  geminiNews: () => import('../api-lib/routes/geminiNews.js'),
}

export default async function handler(req, res) {
  const path = requestPath(req)
  const match = matchRoute(req.method, path)
  if (match.kind === 'missing') {
    return json(res, 404, { error: 'Not found' })
  }
  if (match.kind === 'method') {
    res.setHeader('Allow', match.allow.join(', '))
    return json(res, 405, { error: 'Method not allowed' })
  }
  try {
    const load = LOADERS[match.handler]
    if (!load) return json(res, 404, { error: 'Not found' })
    restoreRequestUrl(req, path)
    const mod = await load()
    await mod.default(req, res)
  } catch (error) {
    if (res.writableEnded) return
    const status = Number(error?.status) || 500
    const message = status === 500
      ? 'Internal Server Error'
      : (error?.message || 'Internal Server Error')
    return json(res, status, { error: message })
  }
}
