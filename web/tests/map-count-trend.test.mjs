import test from 'node:test'
import assert from 'node:assert/strict'
import {countPoints, mapPayload, mapWindow} from '../../api-lib/mapPayload.js'
test('monthly distinct package sets become counts and changes',()=>{
 const counts=new Map([['2026-08',new Set(['IB1','IB2','IB1'])],['2026-09',new Set(['IB3'])]])
 assert.deepEqual(countPoints(['2026-08','2026-09','2026-10'],counts),[{key:'2026-08',value:2,delta:null},{key:'2026-09',value:1,delta:-1},{key:'2026-10',value:0,delta:-1}])
 assert.equal(countPoints(['2026-09'],new Map([['2026-09',3]]))[0].value,3)
})

test('opening rhythm includes closed packages, deduplicates IDs and ignores publication dates', async () => {
 const window = mapWindow(12)
 const key = `${window.now.getFullYear()}-${String(window.now.getMonth() + 1).padStart(2, '0')}`
 const rows = [
  {source_id:'a',tender_no:'IB1',province:'Hà Nội',published:'2020-01-01',open_date:`${key}-01`,close_date:'2099-01-01',bid_price:100},
  {source_id:'duplicate',tender_no:'IB1',province:'Hà Nội',published:'2020-01-01',open_date:`${key}-01`,close_date:'2099-01-01',bid_price:100},
  {source_id:'b',tender_no:'IB2',province:'Hà Nội',published:`${key}-01`,open_date:`${key}-02`,status_code:'CNTT',close_date:`${key}-02`},
  {source_id:'missing',tender_no:'IB3',province:'Hà Nội',published:`${key}-01`,close_date:'2099-01-01'},
  {source_id:'unlocated',tender_no:'IB4',province:'',open_date:`${key}-03`,close_date:'2099-01-01'},
 ]
 const query = async sql => ({rows: sql.includes('FROM msc_tenders') ? rows : []})
 const open = await mapPayload(query,{source:'msc',filters:{status:'open'}})
 const all = await mapPayload(query,{source:'msc',filters:{}})
 assert.equal(open.summary.countTrend.find(point=>point.key===key).value,3)
 assert.deepEqual(open.summary.countTrend,all.summary.countTrend)
 assert.equal(open.packageTotal,2)
 assert.equal(open.summary.value,100)
})
