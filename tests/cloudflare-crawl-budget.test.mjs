import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

const source = readFileSync(new URL('../scripts/cloudflare_crawl_worker.js', import.meta.url), 'utf8')
  .replace(/^import[^\n]+\n/, '').replace('export class CrawlBudget', 'class CrawlBudget')
  .replace('export default', 'const worker =')
const { CrawlBudget } = runInNewContext(source + '\n;({ CrawlBudget, worker })', {
  DurableObject: class {}, Response, Request, URL, Date, crypto: webcrypto, structuredClone,
})

function fixture() {
  const values = new Map()
  const ctx = { storage: {
    kv: { get: key => structuredClone(values.get(key)), put: (key, value) => values.set(key, structuredClone(value)) },
    transactionSync: callback => callback(),
  } }
  let calls = 0
  const page = { content: [{ id: 'public-id', isMedicine: 1 }], totalPages: 200 }
  const env = { CRAWL_KEY: 'test-key', BROWSER: { quickAction: async () => {
    calls++
    const result = JSON.stringify({ status: 200, page })
    return Response.json({ success: true, result: `<pre id="baoan-search-result">${result}</pre>` })
  } } }
  const request = page => new Request('https://crawl.baoanpharma.com/msc/search', {
    method: 'POST', headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
    body: JSON.stringify({ page }),
  })
  return { ctx, env, request, calls: () => calls }
}

test('persistent quota rejects the sixth fresh page before opening a browser', async () => {
  const f = fixture()
  for (let page = 0; page < 5; page++) {
    // A fresh instance must retain the reservation from earlier requests.
    assert.equal((await new CrawlBudget(f.ctx, f.env).fetch(f.request(page))).status, 200)
  }
  assert.equal((await new CrawlBudget(f.ctx, f.env).fetch(f.request(5))).status, 429)
  assert.equal(f.calls(), 5)
})

test('a repeated request uses cached public data without another browser reservation', async () => {
  const f = fixture()
  const actor = new CrawlBudget(f.ctx, f.env)
  const first = await actor.fetch(f.request(0))
  const next = await actor.fetch(f.request(0))
  assert.equal(next.headers.get('X-Crawl-Cache'), 'hit')
  assert.equal(first.headers.get('X-Crawl-Budget-Ms'), next.headers.get('X-Crawl-Budget-Ms'))
  assert.equal(f.calls(), 1)
})
