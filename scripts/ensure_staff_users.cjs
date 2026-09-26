const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

function loadEnv(p) {
  const out = {}
  if (!fs.existsSync(p)) return out
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    out[m[1]] = v
  }
  return out
}

const root = path.resolve(__dirname, '..')
const e = { ...loadEnv(path.join(root, '.env')), ...loadEnv(path.join(root, 'web', '.env.local')) }
const url = (e.SUPABASE_URL || e.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '')
const key = (e.SUPABASE_SERVICE_ROLE_KEY || '').trim()

if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

console.log('project', url)
console.log('service_role', key.length > 40 ? 'ok' : 'missing', 'len=' + key.length)

async function admin(pathname, opts = {}) {
  const res = await fetch(`${url}/auth/v1${pathname}`, {
    ...opts,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  })
  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  return { ok: res.ok, status: res.status, body }
}

async function main() {
  const list = await admin('/admin/users?page=1&per_page=100')
  if (!list.ok) {
    console.error('list_users_failed', list.status, typeof list.body === 'string' ? list.body.slice(0, 200) : list.body)
    process.exit(1)
  }
  const users = list.body?.users || []
  console.log('existing', users.map((u) => u.email).join(', '))

  const wanted = ['sales@baoanpharma.com', 'importer@baoanpharma.com']
  const results = []

  for (const email of wanted) {
    const found = users.find((u) => String(u.email || '').toLowerCase() === email)
    if (found) {
      results.push({ email, action: 'exists', id: found.id })
      continue
    }
    const password = `BaoAn!${crypto.randomBytes(4).toString('hex')}`
    const created = await admin('/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { role: 'staff', source: 'outlook' },
      }),
    })
    if (!created.ok) {
      results.push({ email, action: 'error', detail: created.body })
      continue
    }
    results.push({ email, action: 'created', id: created.body?.id, password })
  }

  console.log(JSON.stringify(results, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
