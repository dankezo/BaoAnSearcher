import test from 'node:test'
import assert from 'node:assert/strict'
import {mapWindow,mapPayload} from '../api-lib/mapPayload.js'

test('VSS date range includes partial months, preserves same-period comparison, and separates quantity units',async()=>{
 const filters={tuNgay:'2024-02-15',denNgay:'2024-03-20',sodk:'SDK-1',loai:'Tân dược'}
 const window=mapWindow(12,new Date(2026,9,9),filters)
 assert.equal(window.curFrom.getDate(),15);assert.equal(window.now.getFullYear(),2024)
 assert.equal(window.prevFrom.getFullYear(),2023)
 const calls=[],query=async(sql,args)=>{calls.push({sql,args});return {rows:sql.includes('AS period')?[{period:'current',ma_tinh:'01',nhomthau:'1',ym:'2024-02',sum_thanhtien:100,cnt:1},{period:'previous',ma_tinh:'01',nhomthau:'1',ym:'2023-02',sum_thanhtien:50,cnt:1}]:sql.includes(' AS unit')?[{unit:'Viên',quantity:100},{unit:'Lọ',quantity:2}]:[]}}
 const payload=await mapPayload(query,{source:'vss',filters,dots:false,ingredients:false})
 assert.equal(payload.summary.value,100);assert.equal(payload.summary.prev,50);assert.equal(payload.summary.yoy,100)
 assert.deepEqual(payload.summary.range,{from:'2024-02-15',to:'2024-03-20'})
 assert.deepEqual(payload.summary.quantities,[{unit:'Viên',quantity:100},{unit:'Lọ',quantity:2}])
 assert.ok(calls[0].args.includes('2023-02-15'));assert.ok(calls[0].args.includes('2024-03-20'));assert.ok(calls[0].args.includes('%SDK-1%'))
 assert.throws(()=>mapWindow(12,new Date(),{tuNgay:'2024-02-30'}),/Ngày hợp đồng/)
 assert.throws(()=>mapWindow(12,new Date(),{tuNgay:'2024-03-20',denNgay:'2024-02-15'}),/trước/)
 const leap=mapWindow(12,new Date(),{tuNgay:'2024-02-29',denNgay:'2024-03-01'});assert.equal(leap.prevFrom.getDate(),28)
})
