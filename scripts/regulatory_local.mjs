import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import handler from '../api-lib/routes/regulatory.js'

// The same route verifies the staff JWT and uses only the anon key with user RLS.
export async function localBrief(authorization) {
  let status = 200, body
  await handler({ method: 'GET', url: '/api/regulatory?view=brief', headers: { authorization } }, {
    set statusCode(value) { status = value },
    setHeader() {},
    end(value) { body = JSON.parse(value) },
  })
  return { status, body }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const keys = new Set(['AUTH_MODE', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_JWT_SECRET', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'])
  for (const name of ['../.env', '../web/.env.local']) {
    const path = fileURLToPath(new URL(name, import.meta.url))
    if (existsSync(path)) for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (m && keys.has(m[1]) && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2').trim()
    }
  }
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
  // Auth and data must select the same project/key despite their alias precedence.
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (url) process.env.VITE_SUPABASE_URL = url
  if (anon) process.env.VITE_SUPABASE_ANON_KEY = anon
  const fetchImpl = globalThis.fetch
  globalThis.fetch = (url, init) => fetchImpl(url, { ...init, signal: AbortSignal.timeout(15000) })
  console.error = () => {} // The shared route logs failures; credentials never enter bridge output.
  try {
    let input = ''
    for await (const chunk of process.stdin) { input += chunk; if (Buffer.byteLength(input) > 24000) throw new Error('Invalid input') }
    process.stdout.write(JSON.stringify(await localBrief(JSON.parse(input).authorization)))
  } catch {
    process.stdout.write(JSON.stringify({ status: 502, body: { error: 'Chưa tải được bản tin trên máy local.' } }))
  }
}
