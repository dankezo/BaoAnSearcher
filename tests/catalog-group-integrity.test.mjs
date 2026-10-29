import test from 'node:test'
import assert from 'node:assert/strict'
import { baoanProducts } from '../api-lib/baoanCatalog.js'
import { classifyLot } from '../lib/regulatory/baoanMatch.js'

test('release catalog preserves the 45 medicines and confirmed tender groups', () => {
  const products = baoanProducts()
  assert.equal(products.length, 45)
  assert.deepEqual(products.map(product => product.id), Array.from({ length: 45 }, (_, index) => index + 1))
  for (const product of products) {
    assert.match(product.tender_group || '', /^[1-5]$/, `${product.brand_name}: missing tender group`)
    assert.ok(['user_quote', 'user_confirmation'].includes(product.tender_group_source?.kind), `${product.brand_name}: missing confirmation source`)
    assert.match(product.tender_group_source?.confirmed_at || '', /^\d{4}-\d{2}-\d{2}$/, `${product.brand_name}: missing confirmation date`)
  }
})

test('restored groups recover matching without accepting unknown or conflicting groups', () => {
  const medicine = baoanProducts()[0]
  const lot = { tenHoatChat: medicine.inn, nongDo: medicine.strength, dangBaoChe: medicine.dosage_form, duongDung: medicine.route, groupMedicine: medicine.tender_group }
  assert.equal(classifyLot(lot, [medicine]).level, 'exact')
  assert.notEqual(classifyLot(lot, [{ ...medicine, tender_group: '' }]).level, 'exact')
  const conflict = medicine.tender_group === '3' ? '4' : '3'
  assert.notEqual(classifyLot({ ...lot, groupMedicine: conflict }, [medicine]).level, 'exact')
})
