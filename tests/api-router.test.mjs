import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchRoute, requestPath, restoreRequestUrl } from '../api-lib/routeTable.js'
import handler from '../api/index.js'

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    writableEnded: false,
    setHeader(name, value) { this.headers[name] = value },
    end(text) { this.body = text; this.writableEnded = true },
  }
}

test('keeps the existing API paths and methods', () => {
  assert.deepEqual(matchRoute('POST', 'tender/search'), { kind: 'ok', handler: 'tenderSearch' })
  assert.deepEqual(matchRoute('GET', 'tender/suggest'), { kind: 'ok', handler: 'tenderSuggest' })
  assert.deepEqual(matchRoute('POST', 'metrics/map'), { kind: 'ok', handler: 'metricsMap' })
  assert.deepEqual(matchRoute('GET', 'regulatory-daily'), { kind: 'ok', handler: 'regulatoryDaily' })
  assert.deepEqual(matchRoute('GET', 'admin/datasets'), { kind: 'ok', handler: 'adminDatasets' })
  assert.deepEqual(matchRoute('GET', 'admin/datasets/download/MSC_PRICE'), { kind: 'ok', handler: 'adminDatasetDownload' })
  assert.equal(matchRoute('POST', 'admin/datasets/download/MSC_PRICE').kind, 'method')
  assert.equal(matchRoute('GET', 'tender/search').kind, 'method')
  assert.equal(matchRoute('POST', 'missing').kind, 'missing')
})

test('unknown path is 404 and the wrong method is 405 before any handler runs', async () => {
  const missing = mockRes()
  await handler({ method: 'GET', url: '/api/does-not-exist', query: { route: ['does-not-exist'] } }, missing)
  assert.equal(missing.statusCode, 404)

  const wrong = mockRes()
  await handler({ method: 'GET', url: '/api/tender/search', query: { route: ['tender', 'search'] } }, wrong)
  assert.equal(wrong.statusCode, 405)
  assert.match(wrong.headers.Allow, /POST/)
})

test('reads the rewrite stamp or the /api pathname and restores the public URL', () => {
  assert.equal(requestPath({ query: { route: ['tender', 'search'] }, url: '/ignored' }), 'tender/search')
  assert.equal(requestPath({ query: { __route: 'metrics/map', section: 'vss' }, url: '/api?__route=metrics/map&section=vss' }), 'metrics/map')
  assert.equal(requestPath({ url: '/api/gemini/analyze-news?x=1' }), 'gemini/analyze-news')
  assert.equal(requestPath({ url: 'https://app.baoanpharma.com/api/regulatory-daily' }), 'regulatory-daily')

  const req = { query: { __route: 'tender/suggest', section: 'vss', q: 'am' }, url: '/api?__route=tender/suggest&section=vss&q=am' }
  restoreRequestUrl(req, 'tender/suggest')
  assert.equal(req.url, '/api/tender/suggest?section=vss&q=am')
  assert.equal(req.query.__route, undefined)
})
