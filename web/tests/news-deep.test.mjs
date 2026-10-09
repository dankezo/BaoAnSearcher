import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyzeNews, NEWS_MODEL, NEWS_PROMPT_VERSION } from '../../lib/regulatory/onDemand.js'

const sourceUrl = 'https://moh.gov.vn/van-ban/123'
const deepResult = {
  priority: 'CRITICAL',
  headline_vietnamese: 'Rà soát danh mục đấu thầu thuốc',
  executive_summary: 'Bộ Y tế công bố cập nhật cần đối chiếu hồ sơ hiện tại.',
  tender_impact: { group_affected: 'Nhóm 2', nature: 'RISK_TRAP', detail: 'Danh mục mới có thể ảnh hưởng bộ hồ sơ dự thầu.' },
  action_order: 'Pháp chế đối chiếu trong hai ngày trước khi điều chỉnh hồ sơ.',
  evidence: [{ detail: 'Văn bản công bố danh mục cập nhật ngày 5 tháng 10.', source_urls: [sourceUrl] }],
  catalog_impact: [{ detail: 'Rà soát thuốc Bảo An theo hoạt chất và hàm lượng.', source_urls: [sourceUrl] }],
  opportunities: [{ detail: 'Đánh giá mặt hàng phù hợp trước kỳ thầu tới.', source_urls: [sourceUrl] }],
  risks: [{ detail: 'Có thể phát sinh yêu cầu sửa đổi hồ sơ kỹ thuật.', source_urls: [sourceUrl] }],
  priority_actions: [{ detail: 'Pháp chế kiểm tra phụ lục trong hai ngày.', source_urls: [sourceUrl] }],
  verification: [{ detail: 'Xác nhận văn bản đã ký và ngày hiệu lực.', source_urls: [sourceUrl] }],
}

const researchResponse = (groundingChunks = [{ web: { uri: sourceUrl, title: 'Văn bản Bộ Y tế' } }]) => ({
  candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Đối chiếu nguồn Bộ Y tế.' }] }, groundingMetadata: { groundingChunks } }],
})
const finalResponse = (value = deepResult, finishReason = 'STOP') => ({
  candidates: [{ finishReason, content: { parts: [{ text: typeof value === 'string' ? value : JSON.stringify(value) }] } }],
})
const response = payload => ({ ok: true, json: async () => payload })
const body = { title: 'Tin cập nhật quy định đấu thầu thuốc', content: 'Toàn văn tin gốc.', source_url: 'https://dav.gov.vn/tin/456' }

test('deep news uses Pro grounding research, bounded stages, and source-backed conclusions', async () => {
  const calls = [], timeouts = []
  const originalTimeout = AbortSignal.timeout
  AbortSignal.timeout = milliseconds => { timeouts.push(milliseconds); return originalTimeout(milliseconds) }
  try {
    const data = await analyzeNews(body, {
      apiKey: 'test-key', model: NEWS_MODEL,
      fetchImpl: async (url, init) => {
        calls.push({ url, init, body: JSON.parse(init.body) })
        return response(calls.length === 1 ? researchResponse() : finalResponse())
      },
    })
    assert.equal(calls.length, 2)
    assert.ok(calls.every(call => call.url.includes(`/models/${NEWS_MODEL}:generateContent`)))
    assert.deepEqual(calls[0].body.tools, [{ google_search: {} }, { url_context: {} }])
    assert.equal(calls[1].body.tools, undefined)
    assert.equal(calls[0].body.generationConfig.thinkingConfig.thinkingLevel, 'high')
    assert.equal(calls[1].body.generationConfig.responseMimeType, 'application/json')
    assert.equal(calls[1].body.generationConfig.thinkingConfig.thinkingLevel, 'medium')
    assert.ok(calls.every(call => call.init.signal instanceof AbortSignal))
    assert.deepEqual(timeouts, [12_000, 12_000])
    assert.equal(data.model, NEWS_MODEL)
    assert.equal(data.prompt_version, NEWS_PROMPT_VERSION)
    assert.deepEqual(data.sources, [
      { title: body.title, url: body.source_url },
      { title: 'Văn bản Bộ Y tế', url: sourceUrl },
    ])
    for (const field of ['evidence', 'catalog_impact', 'opportunities', 'risks', 'priority_actions', 'verification']) {
      assert.ok(data[field].length)
      assert.ok(data[field][0].source_urls.every(url => data.sources.some(source => source.url === url)))
    }
  } finally { AbortSignal.timeout = originalTimeout }
})

const groqResponse = (content, executedTools = []) => ({
  choices: [{ finish_reason: 'stop', message: { content, executed_tools: executedTools } }],
})
const groqResearchTools = [{ search_results: { results: [{ title: 'Văn bản Bộ Y tế', url: sourceUrl }] } }]
const jsonFinal = (value = deepResult) => groqResponse(JSON.stringify(value))
const httpError = status => ({ ok: false, status, json: async () => ({}) })

test('Gemini quota falls back to Groq research and keeps actual source URLs', async () => {
  const calls = []
  const data = await analyzeNews(body, {
    apiKey: 'test-gemini', groqApiKey: 'test-groq',
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) })
      if (url.includes('generativelanguage')) return httpError(429)
      return response(calls.length === 2 ? groqResponse('Đã đối chiếu văn bản.', groqResearchTools) : jsonFinal())
    },
  })
  assert.equal(calls.length, 3)
  assert.equal(calls[1].body.model, 'openai/gpt-oss-120b')
  assert.deepEqual(calls[1].body.tools, [{ type: 'browser_search' }])
  assert.equal(data.provider, 'groq')
  assert.equal(data.model, 'openai/gpt-oss-120b')
  assert.equal(data.grounding_method, 'groq_browser_search')
  assert.deepEqual(data.sources.map(source => source.url), [body.source_url, sourceUrl])
  assert.ok(data.evidence[0].source_urls.every(url => data.sources.some(source => source.url === url)))
})

test('missing Gemini falls back directly to Groq research', async () => {
  const calls = []
  const data = await analyzeNews(body, {
    groqApiKey: 'test-groq',
    fetchImpl: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) })
      return response(calls.length === 1 ? groqResponse('Đã đối chiếu văn bản.', groqResearchTools) : jsonFinal())
    },
  })
  assert.equal(calls.length, 2)
  assert.ok(calls.every(call => call.url.startsWith('https://api.groq.com/')))
  assert.ok(calls.every(call => call.init.headers.Authorization === 'Bearer test-groq'))
  assert.ok(calls.every(call => !call.url.includes('test-groq') && !call.init.body.includes('test-groq')))
  assert.equal(data.provider, 'groq')
  assert.equal(data.grounding_method, 'groq_browser_search')
})

test('malformed Gemini output falls back to configured Groq', async () => {
  const calls = []
  const data = await analyzeNews(body, {
    apiKey: 'test-gemini', groqApiKey: 'test-groq',
    fetchImpl: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) })
      if (url.includes('generativelanguage')) return response(calls.length === 1 ? researchResponse() : finalResponse('{not json'))
      return response(calls.length === 3 ? groqResponse('Đã đối chiếu văn bản.', groqResearchTools) : jsonFinal())
    },
  })
  assert.equal(calls.length, 4)
  assert.ok(calls[0].url.includes('generativelanguage'))
  assert.ok(calls[1].url.includes('generativelanguage'))
  assert.ok(calls[2].url.startsWith('https://api.groq.com/'))
  assert.ok(calls.every(call => !call.url.includes('test-gemini') && !call.url.includes('test-groq') && !call.init.body.includes('test-gemini') && !call.init.body.includes('test-groq')))
  assert.equal(calls[2].init.headers.Authorization, 'Bearer test-groq')
  assert.equal(data.provider, 'groq')
  assert.equal(data.grounding_method, 'groq_browser_search')
})

test('failed Groq search falls back to original source with an explicit verification limit', async () => {
  let call = 0
  const articleResult = JSON.parse(JSON.stringify(deepResult).replaceAll(sourceUrl, body.source_url))
  const data = await analyzeNews(body, {
    apiKey: 'test-gemini', groqApiKey: 'test-groq',
    fetchImpl: async (url) => {
      call++
      if (url.includes('generativelanguage')) return httpError(503)
      if (call === 2) return httpError(500)
      return response(jsonFinal(articleResult))
    },
  })
  assert.equal(data.grounding_method, 'source_documents')
  assert.match(data.verification_limit, /chưa có đối chiếu/i)
  assert.deepEqual(data.sources.map(source => source.url), [body.source_url])
})

test('deep analysis rejects conclusions that cite an invented source', async () => {
  let calls = 0
  await assert.rejects(analyzeNews(body, { apiKey: 'test-key', fetchImpl: async () => response(++calls === 1 ? researchResponse() : finalResponse({ ...deepResult, evidence: [{ detail: 'Kết luận chưa có căn cứ.', source_urls: ['https://invented.example/document'] }] })) }), /Thiếu nguồn hỗ trợ evidence/)
})

test('OpenRouter can finalize the same verified sources when Groq JSON finalization fails', async () => {
  const calls = []
  const data = await analyzeNews(body, {
    apiKey: 'test-gemini', groqApiKey: 'test-groq', openRouterApiKey: 'test-openrouter',
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) })
      if (url.includes('generativelanguage')) return httpError(429)
      if (calls.length === 2) return response(groqResponse('Đã đối chiếu văn bản.', groqResearchTools))
      if (url.includes('api.groq.com')) return httpError(500)
      return response(jsonFinal())
    },
  })
  assert.equal(calls.length, 4)
  assert.equal(calls[3].body.model, 'openrouter/free')
  assert.equal(data.provider, 'openrouter')
  assert.equal(data.model, 'openrouter/free')
  assert.equal(data.grounding_method, 'groq_browser_search')
  assert.deepEqual(data.sources.map(source => source.url), [body.source_url, sourceUrl])
})

test('OpenRouter-only fallback cites the original source and states its verification limit', async () => {
  const oldGroqKey = process.env.GROQ_API_KEY
  delete process.env.GROQ_API_KEY
  try {
    const calls = []
    const articleResult = JSON.parse(JSON.stringify(deepResult).replaceAll(sourceUrl, body.source_url))
    const data = await analyzeNews(body, {
      openRouterApiKey: 'test-openrouter',
      fetchImpl: async (url, init) => {
        calls.push({ url, init, body: JSON.parse(init.body) })
        return response(jsonFinal(articleResult))
      },
    })
    assert.equal(calls.length, 1)
    assert.ok(calls[0].url.startsWith('https://openrouter.ai/api/'))
    assert.equal(calls[0].init.headers.Authorization, 'Bearer test-openrouter')
    assert.ok(!calls[0].url.includes('test-openrouter') && !calls[0].init.body.includes('test-openrouter'))
    const prompt = JSON.parse(calls[0].init.body).messages[1].content
    assert.deepEqual(JSON.parse(prompt).sources.map(source => source.url), [body.source_url])
    assert.equal(data.provider, 'openrouter')
    assert.equal(data.grounding_method, 'source_documents')
    assert.equal(data.verification_limit, 'Chỉ dùng bài gốc; chưa có đối chiếu nguồn bên ngoài trong lượt này.')
    assert.deepEqual(data.sources.map(source => source.url), [body.source_url])
  } finally {
    if (oldGroqKey === undefined) delete process.env.GROQ_API_KEY
    else process.env.GROQ_API_KEY = oldGroqKey
  }
})

test('deep analysis rejects unfinished output and research without grounding sources', async () => {
  await assert.rejects(analyzeNews(body, {
    apiKey: 'test-key', fetchImpl: async () => response({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'partial' }] } }] }),
  }), /chưa hoàn tất/i)
  await assert.rejects(analyzeNews(body, {
    apiKey: 'test-key', fetchImpl: async () => response(researchResponse([])),
  }), /nguồn ngoài/i)
})

test('deep analysis rejects malformed final JSON and invalid strategic values', async () => {
  let call = 0
  await assert.rejects(analyzeNews(body, {
    apiKey: 'test-key', fetchImpl: async () => response(++call === 1 ? researchResponse() : finalResponse('{not json')),
  }), /JSON hợp lệ/i)
  call = 0
  await assert.rejects(analyzeNews(body, {
    apiKey: 'test-key', fetchImpl: async () => response(++call === 1 ? researchResponse() : finalResponse({ ...deepResult, priority: 'URGENT' })),
  }), /ưu tiên AI không hợp lệ/i)
})
