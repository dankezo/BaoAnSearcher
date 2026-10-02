import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { seed } from '../lib/regulatory/seed.js'
import { crawlSource } from '../lib/regulatory/crawler.js'
import { checked } from '../lib/regulatory/store.js'
import { analyzeDaily } from '../lib/regulatory/ai.js'

const env = fileURLToPath(new URL('../.env', import.meta.url))
if (existsSync(env)) for (const line of readFileSync(env, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z_]+)\s*=\s*(.*)$/)
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
}
const url = process.env.SUPABASE_URL
if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Thiếu SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY cho crawler nội bộ.')
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
try {
  await seed(db)
  if (process.argv.includes('--init-only')) console.log(JSON.stringify({ ok: true, initialized: true }))
  else {
    checked(await db.from('regulatory_http_cache').delete().lt('checked_at', new Date(Date.now() - 14 * 86400000).toISOString()))
    const rows = checked(await db.from('regulatory_sources').select('*').eq('enabled', true).order('id'))
    const results = []
    for (const source of rows) {
      const result = await crawlSource(db, source, { force: process.argv.includes('--force') })
      results.push(result); console.log(JSON.stringify(result))
    }
    // Partial source failures are visible but must not prevent the other daily data jobs.
    const ok = results.some(r => r.state === 'ok' || r.state === 'partial') || results.every(r => r.state === 'skipped')
    const ai = await analyzeDaily(db)
    console.log(JSON.stringify({ ok, results, ai }))
    if (!ok) process.exitCode = 2
  }
} catch (error) { console.error(error.message); process.exitCode = 1 }
