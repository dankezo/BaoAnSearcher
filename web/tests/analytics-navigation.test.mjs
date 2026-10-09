import {test} from 'node:test'
import assert from 'node:assert/strict'
import {columnEntity} from '../src/analytics/navigation.js'

test('maps company and registration columns to their typed analytics contexts',()=>{
  assert.deepEqual(columnEntity({key:'winner'},{winner:'Nhà thầu DEMO'}),{
    mode:'company',entity:'Nhà thầu DEMO',role:'all',companyFocus:'business',entityMatch:'contains',entityField:'ingredient',territoryField:'province',months:12,comparison:'yoy',filters:{}
  })
  assert.deepEqual(columnEntity({key:'registration'},{registration:'SDK-DEMO-001'}),{
    mode:'drug',entity:'SDK-DEMO-001',role:'winner',entityField:'registration',territoryField:'province',months:12,comparison:'yoy',filters:{}
  })
})

test('maps facility and region columns to distinct territory scopes',()=>{
  const facility=columnEntity({key:'buyer'},{buyer:'Bệnh viện DEMO'})
  assert.equal(facility.mode,'territory');assert.equal(facility.territoryField,'facility');assert.equal(facility.entity,'Bệnh viện DEMO')
  const region=columnEntity({key:'region'},{region:'Miền Tây DEMO'})
  assert.equal(region.mode,'territory');assert.equal(region.territoryField,'region');assert.equal(region.entity,'Miền Tây DEMO')
})

test('skips tender labels and empty or unknown columns instead of treating them as medicines',()=>{
  assert.equal(columnEntity({key:'name'},{name:'Gói thầu DEMO',bid_price:500}),null)
  assert.equal(columnEntity({key:'name'},{name:'Tên gói',status_label:'Đang mở'}),null)
  assert.equal(columnEntity({key:'tender_no'},{tender_no:'DEMO-01'}),null)
  assert.equal(columnEntity({key:'winner'},{winner:' — '}),null)
})


test('supplier, registrant and manufacturer cells open the same all-role company report',()=>{
 for(const key of ['winner','registrant','manufacturer']){
  const value=columnEntity({key},{[key]:'Công ty DEMO'})
  assert.equal(value.mode,'company');assert.equal(value.entity,'Công ty DEMO');assert.equal(value.role,'all')
  assert.equal(value.entityMatch,'contains')
  assert.equal(value.companyFocus,key==='manufacturer'?'manufacturer':'business')
 }
})
