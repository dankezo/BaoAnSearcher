/**
 * Execute SQL batch files on Turso (same SQL as MCP write_database).
 * Loads TURSO_* from .env / web/.env.local via dotenv if present.
 */
import { createClient } from '@libsql/client'
import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const batchDir = join(root, 'data', 'turso_batches')

function loadEnvFile(path) {
  try {
    const text = readFileSync(path, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const i = t.indexOf('=')
      if (i < 1) continue
      const k = t.slice(0, i).trim()
      let v = t.slice(i + 1).trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      if (!process.env[k]) process.env[k] = v
    }
  } catch {
    /* missing file */
  }
}

loadEnvFile(join(root, '.env'))
loadEnvFile(join(root, 'web', '.env.local'))

const url = (process.env.TURSO_DATABASE_URL || '').trim()
const authToken = (process.env.TURSO_AUTH_TOKEN || '').trim()
if (!url || !authToken) {
  console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN')
  process.exit(1)
}

const prefix = process.argv[2] || 'dav'
const client = createClient({ url, authToken })

const files = readdirSync(batchDir)
  .filter((f) => f.startsWith(prefix + '_') && f.endsWith('.sql'))
  .sort()

let n = 0
for (const f of files) {
  const sql = readFileSync(join(batchDir, f), 'utf8')
  await client.execute(sql)
  n += 1
  if (n % 20 === 0 || n === files.length) {
    console.log(`… ${n}/${files.length} ${f}`)
  }
}
console.log(`Done ${prefix}: ${files.length} batches`)
