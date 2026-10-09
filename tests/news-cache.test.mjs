import assert from 'node:assert/strict'
import { test } from 'node:test'
import { storedNewsAnalysis } from '../api-lib/routes/geminiNews.js'
import { NEWS_PROMPT_VERSION } from '../lib/regulatory/onDemand.js'

function fixture({ document = true, cached = null, busy = false } = {}) {
  const state = {
    doc: document ? {
      id: 'article-1', title: 'Tin đấu thầu thuốc mới', content: 'Toàn văn nội dung bài báo gốc.',
      summary: 'Tóm tắt ngắn.', source_url: 'https://dav.gov.vn/article-1',
      published_at: '2026-10-05', content_hash: 'content-hash-1',
    } : null,
    analysis: cached,
    busy,
  }
  function query(table, isWriter) {
    let operation = 'select', payload, selected = false
    const conditions = {}
    const chain = {
      select() { selected = true; return this },
      update(value) { operation = 'update'; payload = value; return this },
      eq(key, value) { conditions[key] = value; return this },
      limit() { return this },
      then(resolve, reject) {
        let data = []
        try {
          if (operation === 'select') {
            data = table === 'regulatory_documents'
              ? state.doc && state.doc.id === conditions.id ? [state.doc] : []
              : state.analysis && state.analysis.document_id === conditions.document_id ? [state.analysis] : []
          } else if (table === 'regulatory_news_analyses') {
            if (state.analysis?.document_id === conditions.document_id &&
              (!conditions.lease_token || conditions.lease_token === state.analysis.lease_token)) {
              state.analysis = { ...state.analysis, ...payload }
              if (payload.lease_token === null) state.busy = false
              data = selected ? [{ document_id: state.analysis.document_id }] : null
            }
          }
          return Promise.resolve({ data, error: null }).then(resolve, reject)
        } catch (error) { return Promise.reject(error).then(resolve, reject) }
      },
    }
    return chain
  }
  const userDb = { from: table => query(table, false) }
  const writer = {
    from: table => query(table, true),
    async rpc(name, args) {
      assert.equal(name, 'claim_news_analysis')
      if (state.busy || Date.parse(state.analysis?.lease_until || '') > Date.now()) return { data: false, error: null }
      state.busy = true
      state.analysis = {
        document_id: args.p_document_id,
        input_hash: state.analysis?.input_hash || '', model: state.analysis?.model || '',
        prompt_version: state.analysis?.prompt_version || '', result: state.analysis?.result || null,
        analyzed_at: state.analysis?.analyzed_at || null,
        lease_token: args.p_token, lease_until: new Date(Date.now() + 65_000).toISOString(),
      }
      return { data: true, error: null }
    },
  }
  return { state, userDb, writer }
}

const result = {
  headline_vietnamese: 'Tin đấu thầu cần rà soát',
  executive_summary: 'Sự kiện cần được đối chiếu với văn bản gốc.',
  tender_impact: { group_affected: 'Nhóm 2', nature: 'RISK_TRAP', detail: 'Có thể ảnh hưởng hồ sơ dự thầu.' },
  action_order: 'Giao bộ phận pháp chế kiểm tra văn bản.',
  sources: [{ title: 'Bài gốc', url: 'https://dav.gov.vn/article-1' }],
}

test('stores complete analysis, then serves cache without invoking Gemini', async () => {
  const { state, userDb, writer } = fixture()
  let calls = 0
  const analyze = async input => {
    calls++
    assert.equal(input.content, 'Toàn văn nội dung bài báo gốc.')
    assert.equal(input.source_url, 'https://dav.gov.vn/article-1')
    return result
  }
  const first = await storedNewsAnalysis({ userDb, writer, body: { id: 'article-1' }, analyze, model: 'gemini-pro' })
  assert.equal(first.cached, false)
  assert.equal(state.analysis.model, 'gemini-pro')
  assert.equal(state.analysis.prompt_version, NEWS_PROMPT_VERSION)
  assert.deepEqual(state.analysis.result, result)
  assert.ok(state.analysis.analyzed_at)
  const second = await storedNewsAnalysis({ userDb, writer, body: { id: 'article-1' }, analyze, model: 'gemini-pro' })
  assert.equal(second.cached, true)
  assert.equal(calls, 1)
})

test('fallback result retains its actual model and is reused under the Gemini-first policy', async () => {
  const { state, userDb, writer } = fixture()
  const fallback = { ...result, model: 'openai/gpt-oss-120b', provider: 'groq' }
  const first = await storedNewsAnalysis({ userDb, writer, body: { id: 'article-1' }, analyze: async () => fallback, model: 'gemini-pro' })
  assert.equal(state.analysis.model, fallback.model)
  const second = await storedNewsAnalysis({ userDb, writer, body: { id: 'article-1' }, analyze: async () => { throw new Error('cache should avoid model'); }, model: 'gemini-pro' })
  assert.equal(second.cached, true)
  assert.equal(second.model, fallback.model)
  assert.equal(second.analyzed_at, first.analyzed_at)
})

test('failed manual refresh keeps the previous successful result and timestamp', async () => {
  const seed = fixture()
  await storedNewsAnalysis({ userDb: seed.userDb, writer: seed.writer, body: { id: 'article-1' }, analyze: async () => result, model: 'gemini-pro' })
  const previous = { result: seed.state.analysis.result, analyzed_at: seed.state.analysis.analyzed_at }
  await assert.rejects(storedNewsAnalysis({
    userDb: seed.userDb, writer: seed.writer, body: { id: 'article-1', refresh: true },
    analyze: async () => { throw new Error('Gemini unavailable') }, model: 'gemini-pro',
  }), /Gemini unavailable/)
  assert.deepEqual({ result: seed.state.analysis.result, analyzed_at: seed.state.analysis.analyzed_at }, previous)
  assert.equal(seed.state.analysis.lease_token, null)
})

test('returns pending for a duplicate in-flight request without starting Gemini', async () => {
  const seed = fixture({ busy: true })
  let calls = 0
  const response = await storedNewsAnalysis({
    userDb: seed.userDb, writer: seed.writer, body: { id: 'article-1' },
    analyze: async () => { calls++; return result }, model: 'gemini-pro',
  })
  assert.equal(response.pending, true)
  assert.equal(response.retry_after, 3)
  assert.equal(calls, 0)
})

test('rejects inaccessible article before claiming or invoking Gemini', async () => {
  const seed = fixture({ document: false })
  let calls = 0
  await assert.rejects(storedNewsAnalysis({
    userDb: seed.userDb, writer: seed.writer, body: { id: 'article-1' },
    analyze: async () => { calls++; return result },
  }), error => error.status === 404)
  assert.equal(calls, 0)
  assert.equal(seed.state.analysis, null)
})
