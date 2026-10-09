import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SignJWT } from 'jose'
import { localBrief } from '../../scripts/regulatory_local.mjs'

test('local brief verifies the JWT before any query and reads with anon key + user RLS', async () => {
  const env = { AUTH_MODE: 'local', SUPABASE_URL: 'https://fixture.supabase.co', VITE_SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_ANON_KEY: 'fixture-anon', VITE_SUPABASE_ANON_KEY: 'fixture-anon', SUPABASE_JWT_SECRET: 'fixture-only-signing-secret' }
  const prior = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]))
  Object.assign(process.env, env)
  const oldFetch = global.fetch, oldError = console.error, calls = []
  console.error = () => {}
  global.fetch = async (input, init) => {
    calls.push({ url: new URL(input), init })
    const table = new URL(input).pathname.split('/').at(-1)
    const rows = table === 'regulatory_sources' ? [{ id: 'gov', name: 'Government', enabled: true, last_success: new Date().toISOString() }] : table === 'regulatory_documents' ? [{ id: 'price', title: 'Giá bán thuốc căn cứ giá trúng thầu', summary: '', published_at: new Date().toISOString().slice(0, 10), source_id: 'gov' }] : []
    return new Response(JSON.stringify(rows), { headers: { 'Content-Type': 'application/json' } })
  }
  try {
    assert.equal((await localBrief(undefined)).status, 401)
    assert.equal((await localBrief('Bearer invalid-jwt')).status, 401)
    assert.equal(calls.length, 0)
    const jwt = await new SignJWT({ email: 'sales@baoanpharma.com' }).setProtectedHeader({ alg: 'HS256' }).setIssuer(`${env.SUPABASE_URL}/auth/v1`).setAudience('authenticated').setSubject('staff-fixture').setExpirationTime('1m').sign(new TextEncoder().encode(env.SUPABASE_JWT_SECRET))
    const result = await localBrief(`Bearer ${jwt}`)
    assert.equal(result.status, 200); assert.equal(result.body.total, 1)
    assert.equal(result.body.items[0].insight.priority, 85)
    assert.equal(result.body.canEdit, false)
    assert.ok(calls.length >= 4)
    for (const call of calls) {
      assert.equal(call.init.method, 'GET')
      const headers = new Headers(call.init.headers)
      assert.equal(headers.get('apikey'), env.SUPABASE_ANON_KEY)
      assert.equal(headers.get('Authorization'), `Bearer ${jwt}`)
    }
    calls.length = 0
    global.fetch = async (input, init) => {
      calls.push({ url: new URL(input), init })
      return new Response(JSON.stringify({ message: 'Temporary source failure' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
    }
    assert.equal((await localBrief(`Bearer ${jwt}`)).status, 500)
    assert.equal(calls.length, 4, 'each parallel read is attempted once despite HTTP 503')
  } finally {
    global.fetch = oldFetch; console.error = oldError
    for (const [key, value] of Object.entries(prior)) value === undefined ? delete process.env[key] : process.env[key] = value
  }
})
