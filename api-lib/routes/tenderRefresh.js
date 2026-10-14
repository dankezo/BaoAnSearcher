import {requireUser,json} from '../auth.js'
import {refreshTenders} from '../tenderRefresh.js'
export default async function handler(req,res){
 await requireUser(req)
 const stream=String(req.headers.accept||'').includes('application/x-ndjson')
 const emit=value=>{if(!res.destroyed)res.write(JSON.stringify(value)+'\n')}
 try{
  const result=await refreshTenders(progress=>{
   if(!stream)return
   if(!res.headersSent){res.statusCode=200;res.setHeader('Content-Type','application/x-ndjson; charset=utf-8');res.setHeader('Cache-Control','no-store')}
   emit({type:'progress',...progress})
  })
  if(stream){emit({type:'complete',data:result});res.end()}
  else json(res,200,result)
 }catch(error){
  if(res.headersSent){emit({type:'error',error:error.message});res.end()}
  else{if(error.retryAfter)res.setHeader('Retry-After',String(error.retryAfter));json(res,error.status||502,{error:error.message})}
 }
}
