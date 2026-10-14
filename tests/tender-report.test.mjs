import test from 'node:test'
import assert from 'node:assert/strict'
import { buildReport, reportHistory, rowValues } from '../web/src/tenderReport/model.mjs'
import { reportQuery, loadTenderReport } from '../api-lib/tenderReport.js'
import { createClient } from '@libsql/client'
import { whereFor } from '../api-lib/db/searchSql.js'
const query={keyword:'Lacidipin',start:'2025-06-01',end:'2026-10-01',searchField:'ingredient',group:'',strength:'',form:'',composition:'all'}
const bid={id:'1',brandName:'Lacikez',activeIngredient:'Lacidipin',strength:'2mg',regNumber:'590110425723',registrationCompany:'Registrant',route:'Uống',dosageForm:'Viên nén',group:'1',manufacturer:'Biofarm',country:'Poland',unit:'Viên',quantity:'100.000',unitPrice:'4200.00',totalAmount:'420000.00',date:'2026-09-07'}

test('MSC report reads price rows and preserves per-line amounts and result dates',async()=>{
 let captured
 const payload=await loadTenderReport(async(sql,args)=>{
  if(sql.includes('FROM msc_prices')){captured={sql,args};return {rows:[{fp_hash:'msc-1',ten:'Lacikez 2mg',hoatchat:'Lacidipin',hamluong:'2mg',soluong:'100.000',gia:'4200.00',thanhtien:'420000.00',tungay_hd:'2026-10-01 23:59:59'}]}}
  return {rows:[]}
 },{...query,source:'msc',name:'Lacikez 2mg'})
 assert.match(captured.sql,/unit_price \* quantity AS thanhtien/)
 assert.match(captured.sql,/published >= \?/)
 assert.match(captured.sql,/published < DATE_ADD/)
 assert.ok(captured.args.includes('2025-06-01'));assert.ok(captured.args.includes('2026-10-01'))
 assert.equal(payload.items[0].dateBasis,'Ngày KQLCNT')
 assert.equal(payload.items[0].quantity,100)
 assert.equal(buildReport(payload.items,{...query,source:'msc'}).totalAmount,420000)
})

test('canonical decimal quantities stay numeric; one SDK remains one product; actual amount differs from minimum-price estimate',()=>{
 const items=[bid,{...bid,id:'2',manufacturer:'G2116.Biofarm',quantity:200,unitPrice:4000,totalAmount:800000},{...bid,id:'3',regNumber:'OTHER',brandName:'Other',quantity:50,unitPrice:3000,totalAmount:150000},bid]
 const block=buildReport(items,query),row=block.rows[0]
 assert.equal(block.lineCount,3);assert.equal(row.productCount,2);assert.equal(row.totalQuantity,350)
 assert.equal(row.minUnitPrice,3000);assert.equal(row.totalAmount,1370000);assert.notEqual(row.totalAmount,row.totalQuantity*row.minUnitPrice)
 assert.equal(row.children.find(product=>product.regNumber===bid.regNumber).quantity,300)
 assert.equal(rowValues(row,undefined,1)[1],'');assert.equal(rowValues(row,undefined,1)[4],'')
 assert.equal(reportHistory(block,bid.regNumber).length,2)
 const history=reportHistory(block,undefined,undefined,row)
 assert.equal(history.length,3);assert.equal(history.reduce((sum,p)=>sum+p.totalAmount,0),row.totalAmount)
 assert.equal(history.reduce((sum,p)=>sum+p.quantity,0),row.totalQuantity)
 assert.equal(history.find(p=>p.id==='3').regNumber,'OTHER')
})
test('groups separate unit, route, form and strength; missing values stay unavailable; zero remains valid',()=>{
 const block=buildReport([bid,{...bid,id:'2',unit:'Lọ'},{...bid,id:'3',route:'Tiêm'},{...bid,id:'4',dosageForm:'Viên nang'},{...bid,id:'5',strength:'4mg'},{...bid,id:'6',regNumber:'ZERO',unitPrice:0,totalAmount:0,quantity:0}],query)
 assert.equal(block.rows.length,5);assert.equal(block.rows.find(row=>row.unit==='Viên'&&row.route==='Uống'&&row.strength==='2mg'&&row.dosageForm==='Viên nén').minUnitPrice,0)
 assert.equal(buildReport([{...bid,quantity:null,totalAmount:null}],query).rows[0].totalQuantity,null)
 assert.equal(buildReport([{...bid,quantity:null,totalAmount:null}],query).totalAmount,null)
})
test('known Lacidipin spelling and embedded-dose variants group without counting a registration twice',()=>{
 const block=buildReport([bid,{...bid,id:'2',activeIngredient:'Lacidipine 2mg',strength:'2 mg',quantity:200}],query)
 assert.equal(block.rows.length,1);assert.equal(block.rows[0].productCount,1);assert.equal(block.rows[0].totalQuantity,300)
})
test('composition, strength and dosage filters operate before totals; history retains only the selected block and units',()=>{
 const items=[bid,{...bid,id:'2',activeIngredient:'Lacidipin + Hydrochlorothiazide',strength:'2mg + 12.5mg'},{...bid,id:'3',unit:'Lọ'}]
 assert.equal(buildReport(items,{...query,composition:'combination'}).lineCount,1)
 assert.equal(buildReport(items,{...query,strength:'2mg',composition:'single'}).lineCount,2)
 assert.equal(reportHistory(buildReport(items,query),bid.regNumber,'Viên').length,2)
 assert.equal(buildReport(items,{...query,form:'Viên nang'}).totalAmount,0)
 assert.equal(buildReport([{...bid,activeIngredient:'Lacidipin 2,5mg'}],{...query,composition:'single'}).lineCount,1)
})
test('DAV enrichment does not multiply tender rows and leaves ambiguous registration companies unavailable',async()=>{
 const raw={fp_hash:'bid-1',sodk:bid.regNumber,hoatchat:'Lacidipin',soluong:'100.000',gia:'4200.00',thanhtien:'420000.00',dangbaoche:'Viên nén',nhasx:'VSS maker'}
 const items=[{so_dang_ky:bid.regNumber,cty_dang_ky:'A',dang_bao_che:'Form A'},{so_dang_ky_cu:bid.regNumber,cty_dang_ky:'B',dang_bao_che:'Form B'}]
 const payload=await loadTenderReport(async sql=>({rows:sql.includes('SELECT * FROM vss_bids')?[raw]:items}),query)
 assert.equal(payload.items.length,1);assert.equal(payload.items[0].quantity,100)
 assert.equal(payload.items[0].registrationCompany,'');assert.equal(payload.items[0].dosageForm,'Viên nén')
 assert.equal(payload.items[0].manufacturer,'VSS maker');assert.equal(payload.items[0].activeIngredient,'Lacidipin')
})
test('report validates date boundaries and does not truncate silently',async()=>{
 assert.throws(()=>reportQuery({...query,start:'2025-02-30'}),/ngày/)
 assert.throws(()=>reportQuery({...query,start:'not-a-date'}),/ngày/)
 assert.throws(()=>reportQuery({...query,start:'2026-10-02'}),/trước/)
 assert.throws(()=>reportQuery({...query,keyword:'la'}),/3 ký tự/)
 await assert.rejects(()=>loadTenderReport(async()=>({rows:Array(5001).fill({})}),query),/5.000/)
})
test('separate ingredient, registration and name fields combine before aggregation',async()=>{
 let statement,params
 await loadTenderReport(async(sql,args)=>{statement=sql;params=args;return {rows:[]}}, {...query,ingredient:'Lacidipin',registration:'590110425723',name:'Lacikez'})
 assert.match(statement,/hoatchat_f LIKE \? AND ten_f LIKE \? AND sodk = \?/)
 assert.deepEqual(params.slice(3),['%lacidipin%','%lacikez%','590110425723'])
 assert.throws(()=>reportQuery({...query,ingredient:'la'}),/3 ký tự/)
})
test('VSS list date window excludes unknown dates and includes the full final day, matching metrics',async()=>{
 const db=createClient({url:'file::memory:'})
 try{
  await db.execute('CREATE TABLE vss_bids(loai TEXT,tungay_hd TEXT,hoatchat TEXT,sodk TEXT,nhomthau TEXT)')
  for(const day of [null,'','2025-05-31','2025-06-01','2026-10-01 23:59:59.999','2026-10-02'])await db.execute({sql:'INSERT INTO vss_bids VALUES(?,?,?,?,?)',args:['Tân dược',day,'Lacidipin',bid.regNumber,'N1']})
  const where=whereFor('vss',{loai:'Tân dược',tuNgay:query.start,denNgay:query.end},'turso')
  const {rows}=await db.execute({sql:'SELECT tungay_hd FROM vss_bids WHERE '+where.where,args:where.args})
  assert.deepEqual(rows.map(row=>row.tungay_hd),['2025-06-01','2026-10-01 23:59:59.999'])
  const upper=whereFor('vss',{denNgay:query.end},'turso')
  assert.equal((await db.execute({sql:'SELECT tungay_hd FROM vss_bids WHERE '+upper.where,args:upper.args})).rows.length,3)
 }finally{db.close()}
})
test('custom DAV and MSC exports include the full final day and exclude missing dates',async()=>{
 const db=createClient({url:'file::memory:'})
 try{
  for(const [kind,column,filters] of [['dav','ngay_cap',{dateFrom:query.start,dateTo:query.end}],['msc_prices','published',{publishedFrom:query.start,publishedTo:query.end,strictDates:true}],['msc_tenders','published',{publishedFrom:query.start,publishedTo:query.end,strictDates:true}]]){
   const table=kind==='dav'?'dav_drugs':kind
   await db.execute(`CREATE TABLE ${table}(${column} TEXT)`)
   for(const day of [null,'','2025-05-31','2025-06-01','2026-10-01 23:59:59.999','2026-10-02'])await db.execute({sql:`INSERT INTO ${table} VALUES(?)`,args:[day]})
   const where=whereFor(kind,filters,'turso')
   const {rows}=await db.execute({sql:`SELECT ${column} FROM ${table} WHERE `+where.where,args:where.args})
   assert.deepEqual(rows.map(row=>row[column]),['2025-06-01','2026-10-01 23:59:59.999'])
  }
 }finally{db.close()}
})
