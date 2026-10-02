import { analyzeLegal, analyzeNews } from '../lib/regulatory/onDemand.js'

const raw = await new Promise((resolve, reject) => {
  const chunks = []
  process.stdin.on('data', chunk => chunks.push(chunk))
  process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  process.stdin.on('error', reject)
})

try {
  const { kind, body } = JSON.parse(raw || '{}')
  const apiKey = process.env.GEMINI_API_KEY
  const result = kind === 'legal' ? await analyzeLegal(body, { apiKey }) : await analyzeNews(body, { apiKey })
  process.stdout.write(JSON.stringify(result))
} catch (error) {
  process.stdout.write(JSON.stringify({ error: error.message || 'Chưa phân tích được.', status: error.status || 502 }))
}
