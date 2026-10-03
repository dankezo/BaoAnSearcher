import assert from 'node:assert/strict'
import test from 'node:test'
import { selectListedDot } from '../src/mapSelection.js'
import { baoanLinesForIngredient, isExactBaoanMatch } from '../src/baoanIngredient.js'
import { rankScopeLines } from '../../api-lib/mapPayload.js'

test('chọn gói ở cột trái giữ nguyên tỉnh đang xem', () => {
  const state = {
    place: { type: 'province', id: '01' },
    query: { source: 'msc', province: '01', region: '', status: 'open' },
    zoomIntent: { province: '01' },
    pick: { type: 'province', id: '01' },
  }
  const next = selectListedDot(state, { id: 'goi-ha-noi', kind: 'package', buyer: 'Bệnh viện Bạch Mai' })
  assert.deepEqual(next.place, { type: 'province', id: '01' })
  assert.equal(next.query.province, '01')
  assert.equal(next.query.source, 'msc')
  assert.deepEqual(next.zoomIntent, { province: '01' })
  assert.deepEqual(next.pick, { type: 'dot', id: 'goi-ha-noi' })
})

test('tag Khớp chỉ dành cho khớp đúng', () => {
  assert.equal(isExactBaoanMatch({ baoanMatch: 'exact' }), true)
  assert.equal(isExactBaoanMatch({ baoan_match: 'near' }), false)
  assert.equal(isExactBaoanMatch({ match: 'match' }), false)
  assert.equal(isExactBaoanMatch({}), false)
})

test('hover hoạt chất chỉ khớp khi đủ dạng và hàm lượng', () => {
  const catalog = [
    { brand: 'Hapacol', inn: 'Paracetamol', strength: '500 mg', form: 'Viên nén', reg: 'VD-111' },
    { brand: 'Efferalgan', inn: 'Paracetamol', strength: '80 mg', form: 'Thuốc bột', reg: 'VD-222' },
    { brand: 'Khác', inn: 'Amoxicillin', strength: '500 mg', form: 'Viên nang', reg: 'VD-333' },
  ]
  assert.equal(baoanLinesForIngredient('Paracetamol', catalog).length, 0)
  const line = 'Paracetamol 500 mg Viên nén'
  assert.deepEqual(baoanLinesForIngredient(line, catalog).map((row) => row.reg), ['VD-111'])
  assert.equal(baoanLinesForIngredient('Amoxicillin 500 mg Viên nang', catalog)[0].brand, 'Khác')
  assert.equal(baoanLinesForIngredient('Ibuprofen', catalog).length, 0)
})

test('Map giữ nhãn và danh mục của hoạt chất cần rà soát', () => {
  const rows = rankScopeLines([
    {
      name: 'Silymarin', qty: 10, price: 100,
      match: 'near', status: 'POTENTIAL', legalBasis: 'HSMT cần đối chiếu',
      hits: [{ brand: 'Silymarin Bao An', strength: '140 mg', form: 'Viên nang', reg: 'VD-NEAR' }],
    },
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].match, 'near')
  assert.equal(rows[0].status, 'POTENTIAL')
  assert.equal(rows[0].baoanHits[0].reg, 'VD-NEAR')
})

test('Map ưu tiên khớp đúng khi cùng hoạt chất có cả hai mức', () => {
  const rows = rankScopeLines([
    { name: 'Paracetamol', match: 'near', hits: [{ brand: 'Rà soát', reg: 'VD-NEAR' }] },
    { name: 'Paracetamol', match: 'exact', hits: [{ brand: 'Khớp', reg: 'VD-EXACT' }] },
  ])
  assert.equal(rows[0].match, 'exact')
  assert.deepEqual(rows[0].baoanHits.map((hit) => hit.reg), ['VD-EXACT'])
})
