import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildMatchBlob, closeTone, matchSheetXml } from '../src/matchExport.js'

const now = Date.parse('2026-09-29T12:00:00')

test('close paint is orange within 3 days and green within 7', () => {
  assert.equal(closeTone('2026-10-02T12:00:00', now), 'soon')
  assert.equal(closeTone('2026-10-06T12:00:00', now), 'week')
  assert.equal(closeTone('2026-10-06T12:01:00', now), '')
  assert.equal(closeTone('2026-09-28T12:00:00', now), '')
})

test('match workbook keeps MT headers, Bảo An fill, deadline fill, and TBMT hyperlink', async () => {
  const rows = [
    {
      stt: 1, tenderNo: 'IB1', name: 'Gói A', buyer: 'BV', province: 'Hà Nội',
      innMt: 'Paracetamol', strengthMt: '500mg', formMt: 'Viên nén', routeMt: 'Uống', unit: 'Viên', price: 12000,
      inn: 'Paracetamol', brand: 'ParaBA', strength: '500mg', form: 'Viên nén', sdkDensity: 4,
      closeDate: '2026-10-01T08:00:00', link: 'https://muasamcong.mpi.gov.vn/goi/1', match: 'exact',
    },
    {
      stt: 2, tenderNo: 'IB2', name: 'Gói B', buyer: 'BV', province: 'Huế',
      innMt: 'Ibuprofen', strengthMt: '400mg', formMt: 'Viên nén', routeMt: 'Uống', unit: 'Viên', price: 8000,
      inn: 'Ibuprofen', brand: 'IbuBA', strength: '400mg', form: 'Viên nén', sdkDensity: 9,
      closeDate: '2026-10-05T08:00:00', link: 'https://muasamcong.mpi.gov.vn/goi/2', match: 'near',
    },
  ]
  const sheet = matchSheetXml(rows, now)
  assert.match(sheet, /Hoạt chất MT/)
  assert.match(sheet, /Mật độ SĐK/)
  assert.match(sheet, /Mã TBMT/)
  assert.doesNotMatch(sheet, /Link gói thầu/)
  assert.match(sheet, /s="3"/)
  assert.match(sheet, /s="4"/)
  assert.match(sheet, /s="5"/)
  assert.match(sheet, /s="6"/)
  assert.match(sheet, /<hyperlink ref="B3" r:id="rId1"\/>/)
  assert.match(sheet, /<hyperlink ref="B4" r:id="rId2"\/>/)
  assert.doesNotMatch(sheet, /HYPERLINK/)
  const blob = buildMatchBlob(rows, now)
  const text = Buffer.from(await blob.arrayBuffer()).toString('utf8')
  assert.match(text, /FFE7F3FB/)
  assert.match(text, /FFF8E6D0/)
  assert.match(text, /FFE3F6EA/)
  assert.match(text, /Target="https:\/\/muasamcong\.mpi\.gov\.vn\/goi\/1" TargetMode="External"/)
  assert.match(text, /Target="https:\/\/muasamcong\.mpi\.gov\.vn\/goi\/2" TargetMode="External"/)
  assert.doesNotMatch(text, /HYPERLINK/)
  assert.doesNotMatch(text, /Link gói thầu/)
})

test('combined match workbook splits exact and near onto two sheets', async () => {
  const rows = [
    { tenderNo: 'IB1', name: 'Gói A', link: 'https://muasamcong.mpi.gov.vn/goi/1', match: 'exact', closeDate: '2026-10-01T08:00:00' },
    { tenderNo: 'IB2', name: 'Gói B', link: 'https://muasamcong.mpi.gov.vn/goi/2', match: 'near', closeDate: '2026-10-05T08:00:00' },
    { tenderNo: 'IB3', name: 'Gói C', link: 'https://muasamcong.mpi.gov.vn/goi/3', match: 'exact', closeDate: '2026-10-08T08:00:00' },
  ]
  const blob = buildMatchBlob(rows, now, { split: true })
  const text = Buffer.from(await blob.arrayBuffer()).toString('utf8')
  assert.match(text, /sheet name="Khớp"/)
  assert.match(text, /sheet name="Cần rà soát HSMT"/)
  assert.match(text, /Target="https:\/\/muasamcong\.mpi\.gov\.vn\/goi\/1" TargetMode="External"/)
  assert.match(text, /Target="https:\/\/muasamcong\.mpi\.gov\.vn\/goi\/2" TargetMode="External"/)
  assert.doesNotMatch(text, /HYPERLINK/)
  assert.doesNotMatch(text, /Link gói thầu/)
  const sheets = [...text.matchAll(/<worksheet [\s\S]*?<\/worksheet>/g)].map((match) => match[0])
  assert.equal(sheets.length, 2)
  const exactSheet = sheets.find((sheet) => sheet.includes('IB1'))
  const nearSheet = sheets.find((sheet) => sheet.includes('IB2'))
  assert.ok(exactSheet)
  assert.ok(nearSheet)
  assert.match(exactSheet, /IB3/)
  assert.doesNotMatch(exactSheet, /IB2/)
  assert.doesNotMatch(nearSheet, /IB1/)
  assert.doesNotMatch(nearSheet, /IB3/)
})

test('match workbook totals each source tender line once across multiple BaoAn hits', () => {
  const rows = [
    { tenderNo:'IB1', name:'Gói A', price:10, quantity:2, scopeLineKey:'notify-1:0', inn:'A', match:'exact' },
    { tenderNo:'IB1', name:'Gói A', price:10, quantity:2, scopeLineKey:'notify-1:0', inn:'B', match:'exact' },
    { tenderNo:'IB1', name:'Gói A', price:13, quantity:4, scopeLineKey:'notify-1:1', inn:'C', match:'exact' },
  ]
  const sheet=matchSheetXml(rows,now)
  assert.match(sheet,/<c r="K2" s="7"><f>SUM\(K3:K5\)<\/f><v>23<\/v><\/c>/)
  assert.match(sheet,/<c r="L2" s="7"><f>SUM\(L3:L5\)<\/f><v>6<\/v><\/c>/)
  assert.match(sheet,/<c r="M2" s="7"><f>SUM\(M3:M5\)<\/f><v>72<\/v><\/c>/)
  assert.match(sheet,/<c r="K3"><v>10<\/v><\/c><c r="L3"><v>2<\/v><\/c><c r="M3"><v>20<\/v><\/c>/)
  assert.doesNotMatch(sheet,/r="K4"|r="L4"|r="M4"/)
  assert.match(sheet,/<c r="K5"><v>13<\/v><\/c><c r="L5"><v>4<\/v><\/c><c r="M5"><v>52<\/v><\/c>/)
  assert.match(sheet,/Tổng \(mỗi dòng mời thầu tính một lần\)/)
  assert.match(sheet,/ySplit="2" topLeftCell="A3"/)
})
