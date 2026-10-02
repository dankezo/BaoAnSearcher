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
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || result.detail || `Chưa phân tích được (${response.status}).`)
  return result
}

export function analyzeNews(body) {
  return post('/api/gemini/analyze-news', body)
}

export function analyzeLegal(body) {
  return post('/api/gemini/analyze-legal', body)
}
