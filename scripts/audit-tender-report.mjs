// Read-only source check and reproducible acceptance extracts. Run from repo root.
import { mkdir, writeFile } from 'node:fs/promises'
import { query } from '../api-lib/db/tidb.js'
import { loadTenderReport } from '../api-lib/tenderReport.js'
import { buildReport } from '../web/src/tenderReport/model.mjs'
import { buildTenderReportXlsx } from '../web/src/tenderReport/export.mjs'

for(const path of ['.env','web/.env.local']){
  try{process.loadEnvFile(path)}catch(error){if(error.code!=='ENOENT')throw error}
}
const period={start:'2025-06-01',end:'2026-10-01',searchField:'ingredient',group:'',strength:'',form:'',composition:'all'}
await mkdir('outputs',{recursive:true})
const blocks=[]
for(const keyword of ['Lacidipin','Lisinopril','Losartan']){
  const payload=await loadTenderReport(query,{...period,keyword})
  await writeFile(`outputs/tender-audit-${keyword}.json`,JSON.stringify(payload))
  const block=buildReport(payload.items,payload.query,blocks.length)
  blocks.push(block)
  const quantities=[...new Set(block.rows.map(row=>row.unit))].map(unit=>{const rows=block.rows.filter(row=>row.unit===unit);return {unit,quantity:rows.some(row=>row.totalQuantity==null)?null:rows.reduce((sum,row)=>sum+row.totalQuantity,0)}})
  console.log(JSON.stringify({keyword,rows:block.lineCount,groups:block.rows.length,quantities,amountVnd:block.totalAmount}))
}
const sdk=await loadTenderReport(query,{...period,searchField:'registration',keyword:'590110425723'})
console.log(JSON.stringify({sdk:'590110425723',rows:sdk.items.length,quantity:sdk.items.reduce((sum,row)=>sum+row.quantity,0),amountVnd:sdk.items.reduce((sum,row)=>sum+row.totalAmount,0)}))
await writeFile('outputs/tender-market-report-2026-10-09.xlsx',new Uint8Array(await buildTenderReportXlsx(blocks,true,true).arrayBuffer()))
