import assert from 'node:assert/strict'
import test from 'node:test'
import { emailAllowed, requireUser } from '../api-lib/auth.js'
import { searchBackend } from '../api-lib/backend.js'

test('allowlist is exact', () => {
  assert.equal(emailAllowed('sales@baoanpharma.com'), true)
  assert.equal(emailAllowed('stranger@baoanpharma.com'), false)
})

test('missing bearer is 401 without a network call', async () => {
  await assert.rejects(() => requireUser({ headers: {} }), (error) => error.status === 401)
})

test('search backend defaults to supabase', () => {
  const previous = process.env.SEARCH_BACKEND
  delete process.env.SEARCH_BACKEND
  assert.equal(searchBackend(), 'supabase')
  process.env.SEARCH_BACKEND = 'turso'
  assert.equal(searchBackend(), 'turso')
  if (previous == null) delete process.env.SEARCH_BACKEND
  else process.env.SEARCH_BACKEND = previous
})
