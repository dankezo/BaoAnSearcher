import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyLot } from '../lib/regulatory/baoanMatch.js'
import { quoteMatches, quoteRow, searchQuotes } from '../api-lib/ycbg.js'

test('ordinary paging hydrates only the selected IDs and preserves sort and total',async()=>{
  const records=Array.from({length:5},(_,i)=>({normalized:JSON.stringify({id:'id'+i,name:'Gói thầu thuốc',published:'2026-10-0'+(i+1)}),lots:'[]'}))
  const queries=[]
  const db={query:async(sql,args)=>{
    queries.push(sql)
    if(sql.includes('data_registry_meta'))return {rows:[{total_records:5}]}
    if(sql.includes('app_metadata'))return {rows:[]}
    if(sql.includes('WHERE id IN'))return {rows:records.filter(row=>args.includes(JSON.parse(row.normalized).id)).reverse()}
    return {rows:records.map(({normalized})=>({normalized}))}
  }}
  const result=await searchQuotes(db,{group_name:[]},1,2)
  assert.equal(result.total,5)
  assert.deepEqual(result.items.map(row=>row.id),['id2','id1'])
  assert.ok(result.items.every(row=>Array.isArray(row.scope_lines)))
  assert.equal(queries[0],'SELECT normalized,error FROM msc_ycbg')
  assert.ok(queries[1].includes('WHERE id IN (?,?)'))
})

test('GE.01 / group 2 cannot be green without verified Bao An group',()=>{
  const lot={medicineCode:'GE.01',tenHoatChat:'Paracetamol',nongDo:'500mg',dangBaoChe:'Viên nén',duongDung:'Uống',nhomTCKT:2}
  const item={inn:'Paracetamol',strength:'500mg',dosage_form:'Viên nén',route:'Uống',group_evidence:[{group:'N4'}]}
  assert.equal(classifyLot(lot,[item]).status,'POTENTIAL')
  assert.equal(classifyLot(lot,[item]).matchedCriteria.group,null)
  assert.equal(classifyLot(lot,[{...item,tender_group:'4'}]).status,'MISMATCH')
  assert.equal(classifyLot(lot,[{...item,tender_group:'2'}]).status,'MATCH')
})
test('YCBG expiry uses Vietnam time and cancellation wins',()=>{
  const normalized={id:'a',close_date:'2026-10-14T15:00:00',status_code:'01'}
  const row=quoteRow({normalized,lots:[],error:null},new Date('2026-10-14T08:00:01Z'))
  assert.equal(row.status_label,'Đã hết hạn nhận báo giá')
  assert.equal(row.document_status,'Cần rà soát hồ sơ đính kèm')
  assert.equal(quoteRow({normalized:{...normalized,status_code:'03'}}).status_label,'Đã hủy')
})
test('ingredient and group must belong to the same YCBG line',()=>{
  const row={scope_lines:[{name:'Paracetamol',form:'Viên',group:'4'},{name:'Ambroxol',form:'Viên',group:'2'}]}
  assert.equal(quoteMatches(row,{ingredient:'Paracetamol',group_name:['2']}),false)
  assert.equal(quoteMatches(row,{ingredient:'Paracetamol',group_name:['N4']}),true)
})
