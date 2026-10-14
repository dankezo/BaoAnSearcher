import { authenticatedFetch } from '../lib/supabase-auth'

export async function regulatoryRequest(params = {}, body, signal) {
  const response = await authenticatedFetch(`/api/regulatory?${new URLSearchParams(params)}`, {
    method: body ? 'POST' : 'GET', signal,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || `Không tải được kho pháp luật (${response.status}).`)
  return result
}
