import assert from 'node:assert/strict'
import test from 'node:test'
import { cachedQuery, resetQueryCache, stableKey } from '../src/queryCache.js'

test('identical keys share one in-flight call', async () => {
  resetQueryCache()
  let calls = 0
  const run = () => cachedQuery('k', async () => {
    calls += 1
    return 'ok'
  })
  const [a, b] = await Promise.all([run(), run()])
  assert.equal(a, 'ok')
  assert.equal(b, 'ok')
  assert.equal(calls, 1)
})

test('a fresh hit does not call again', async () => {
  resetQueryCache()
  let calls = 0
  const factory = async () => {
    calls += 1
    return calls
  }
  assert.equal(await cachedQuery('fresh', factory, { freshMs: 5000 }), 1)
  assert.equal(await cachedQuery('fresh', factory, { freshMs: 5000 }), 1)
  assert.equal(calls, 1)
})

test('stableKey changes when params change', () => {
  assert.notEqual(stableKey('/api/tender/search', { q: 'cillin' }), stableKey('/api/tender/search', { q: 'uroxim' }))
})
