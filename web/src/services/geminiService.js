import { getSupabase } from '../supabaseClient'

async function post(path, body) {
  const session = await getSupabase()?.auth.getSession()
  const token = session?.data?.session?.access_token
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(65000),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || result.detail || `Chưa phân tích được (${response.status}).`)
  return result
}

export async function analyzeNews(body) {
  const started = new Date().toISOString()
  let result = await post('/api/gemini/analyze-news', body)
  for (let attempt = 0; result.pending && attempt < 23; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 3000))
    result = await post('/api/gemini/analyze-news', { id: body.id, wait_after: started })
  }
  if (result.pending) throw new Error('Phân tích đang chạy. Mở lại bài sau ít phút để xem kết quả đã lưu.')
  return result
}

export function analyzeLegal(body) {
  return post('/api/gemini/analyze-legal', body)
}
