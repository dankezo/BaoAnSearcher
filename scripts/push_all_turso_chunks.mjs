/**
 * Push data/turso_chunks/*.sql to Turso via @libsql/client (batch SQL = MCP write_database).
 * Requires TURSO_AUTH_TOKEN (+ optional TURSO_DATABASE_URL) in environment or .env (loaded below).
 */
import { createClient } from '@libsql/client'
import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const chunkDir = join(root, 'data', 'turso_chunks')

function loadEnv(path) {
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const i = t.indexOf('=')
      if (i < 1) continue
      const k = t.slice(0, i).trim()
      let v = t.slice(i + 1).trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      if (!process.env[k]) process.env[k] = v
    }
  } catch { /* */ }
}

loadEnv(join(root, '.env'))
loadEnv(join(root, 'web', '.env.local'))

const url = (process.env.TURSO_DATABASE_URL || 'libsql://baoan-searcher-dankezo.aws-ap-northeast-1.turso.io').trim()
const authToken = (process.env.TURSO_AUTH_TOKEN || '').trim()
if (!authToken) {
  console.error('Missing TURSO_AUTH_TOKEN')
  process.exit(2)
}

const prefix = process.argv[2] || ''
const client = createClient({ url, authToken })
const files = readdirSync(chunkDir)
  .filter((f) => f.endsWith('.sql') && (!prefix || f.startsWith(prefix + '_')))
  .sort()

let n = 0
for (const f of files) {
  const sql = readFileSync(join(chunkDir, f), 'utf8')
  await client.execute(sql)
  n += 1
  if (n % 25 === 0 || n === files.length) console.log(`… ${n}/${files.length} ${f}`)
}
console.log(`Done: ${files.length} chunks`)
