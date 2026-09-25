/**
 * Push data/turso_chunks/*.sql to Turso via @libsql/client.
 * Reads TURSO_* from .env (no secrets printed).
 *
 * node scripts/push_turso_chunks.mjs
 * node scripts/push_turso_chunks.mjs --prefix dav
 */
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@libsql/client'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CHUNK_DIR = join(ROOT, 'data', 'turso_chunks')

function loadEnv() {
  const p = join(ROOT, '.env')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const i = line.indexOf('=')
    const k = line.slice(0, i).trim()
    const v = line.slice(i + 1).trim()
    if (!(k in process.env) || !process.env[k]) process.env[k] = v
  }
}

async function executeWithRetry(client, sql, retries = 6) {
  const text = String(sql).trim()
  if (!text) return

  let delay = 1000
  let last
  for (let a = 0; a < retries; a++) {
    try {
      // Prefer executeMultiple for chunk files that contain several INSERTs
      if (typeof client.executeMultiple === 'function' && /;\s*INSERT\b/i.test(text)) {
        await client.executeMultiple(text)
      } else {
        await client.execute(text)
      }
      return
    } catch (e) {
      last = e
      const msg = String(e?.message || e).toLowerCase()
      if (/many_statements/.test(msg)) {
        // Split only between statements (keep ; inside string literals intact enough for our dumps)
        const parts = text.split(/;\s*(?=INSERT\b)/i).map((s) => s.trim().replace(/;\s*$/, '')).filter(Boolean)
        for (const s of parts) await client.execute(s)
        return
      }
      if (
        a < retries - 1 &&
        /timeout|temporarily|reset|503|429|unavailable|connection|network/.test(msg)
      ) {
        await new Promise((r) => setTimeout(r, delay))
        delay = Math.min(delay * 1.8, 20000)
        continue
      }
      throw e
    }
  }
  throw last
}

async function pushPrefix(client, prefix) {
  const files = readdirSync(CHUNK_DIR)
    .filter((f) => f.startsWith(`${prefix}_`) && f.endsWith('.sql'))
    .sort()
  for (let i = 0; i < files.length; i++) {
    const sql = readFileSync(join(CHUNK_DIR, files[i]), 'utf8')
    await executeWithRetry(client, sql)
    if ((i + 1) % 25 === 0 || i + 1 === files.length) {
      console.log(`  ${prefix}: ${i + 1}/${files.length}`)
    }
  }
  return files.length
}

async function main() {
  loadEnv()
  const url = (process.env.TURSO_DATABASE_URL || '').trim()
  const authToken = (process.env.TURSO_AUTH_TOKEN || '').trim()
  if (!url || !authToken) {
    console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN')
    process.exit(1)
  }
  const prefixArg = process.argv.includes('--prefix')
    ? process.argv[process.argv.indexOf('--prefix') + 1]
    : ''
  const client = createClient({ url, authToken })
  const t0 = Date.now()
  const prefixes = prefixArg
    ? [prefixArg]
    : ['msc_prices', 'msc_tenders', 'dav', 'vss']
  for (const prefix of prefixes) {
    const n = readdirSync(CHUNK_DIR).filter((f) => f.startsWith(`${prefix}_`)).length
    if (!n) continue
    console.log(`Pushing ${prefix}…`)
    await pushPrefix(client, prefix)
  }
  // light meta stamp
  const syncedAt = new Date().toISOString()
  for (const key of ['vss', 'dav', 'msc']) {
    const value = JSON.stringify({ synced_at: syncedAt, backend: 'turso', phase: 'pushed' })
    await client.execute({
      sql: `INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
      args: [key, value, syncedAt],
    })
  }
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
