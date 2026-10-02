import { requireUser, json, readJson } from '../auth.js'
import { analyzeLegal } from '../../lib/regulatory/onDemand.js'

export default async function handler(req, res) {
  try {
    await requireUser(req)
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return json(res, 405, { error: 'Method not allowed' })
    }
    return json(res, 200, await analyzeLegal(await readJson(req), { apiKey: process.env.GEMINI_API_KEY }))
  } catch (e) {
    const status = e.status || 500
    return json(res, status, { error: status === 500 ? 'Chưa phân tích được văn bản. Vui lòng thử lại.' : e.message })
  }
}
