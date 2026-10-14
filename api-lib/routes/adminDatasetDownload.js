/**
 * GET /api/admin/datasets/download/:code
 * Authorizes the request, then returns the public/custom-domain R2 URL. The
 * browser downloads from R2 directly; Vercel neither fetches nor streams CSV.
 */
import { requireUser, json } from '../auth.js'
import { DATASET_CODES, getDataRegistry } from '../dataRegistry.js'

function codeFrom(req) {
  const url = new URL(req.url || '/', 'https://app.baoanpharma.com')
  return decodeURIComponent(url.pathname).split('/').filter(Boolean).at(-1)?.toUpperCase() || ''
}

function safeR2Url(value) {
  try {
    const url = new URL(String(value || ''))
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  try {
    await requireUser(req)
    const code = codeFrom(req)
    if (!DATASET_CODES.has(code)) return json(res, 404, { error: 'Không tìm thấy tập dữ liệu.' })
    const dataset = await getDataRegistry(code)
    const format = new URL(req.url || '/', 'https://app.baoanpharma.com').searchParams.get('format') || 'csv'
    if(!['csv','xlsx'].includes(format))return json(res,400,{error:'Định dạng tải không hợp lệ.'})
    let url = safeR2Url(dataset?.r2DownloadUrl)
    if (!url) {
      return json(res, 409, { error: 'Bản Snapshot R2 chưa sẵn sàng cho tập dữ liệu này.' })
    }
    if(format==='xlsx'){
      const target=new URL(url)
      target.pathname=target.pathname.replace(/\.csv$/i,'.xlsx')
      if(target.toString()===url)return json(res,409,{error:'Snapshot Excel chưa được tạo.'})
      const ready=await fetch(target,{method:'HEAD',signal:AbortSignal.timeout(8000)})
      if(!ready.ok)return json(res,409,{error:'Snapshot Excel chưa sẵn sàng. Chọn bộ lọc để tải Excel tùy chỉnh hoặc tải CSV đầy đủ.'})
      url=target.toString()
    }
    return json(res, 200, { code, url, filename: `${code.toLowerCase()}-snapshot.${format}` })
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || String(error) })
  }
}
