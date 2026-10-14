import { requireUser,json,readJson } from '../auth.js'
import { searchBackend } from '../backend.js'
import { query } from '../db/tidb.js'
import { loadTenderReport } from '../tenderReport.js'
export default async function handler(req,res){
  if(req.method==='OPTIONS'){res.statusCode=204;res.end();return}
  try{
    await requireUser(req)
    if(searchBackend()!=='tidb')throw Object.assign(new Error('Báo cáo cần kho TiDB đã cấu hình.'),{status:503})
    return json(res,200,await loadTenderReport(query,await readJson(req)))
  }catch(error){return json(res,error.status||500,{error:error.status?error.message:'Chưa tải được báo cáo. Vui lòng thử lại.'})}
}
