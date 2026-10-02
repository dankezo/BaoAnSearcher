import assert from 'node:assert/strict'
import test from 'node:test'
import { catalogTouch } from '../../lib/regulatory/catalogTouch.js'

test('bản tin không coi trùng mỗi hoạt chất là khớp danh mục', () => {
  const touch = catalogTouch('Thông báo đấu thầu Paracetamol', 'Cơ sở mua Paracetamol generic')
  assert.equal(touch.exact.length, 0)
})

test('bản tin khớp khi có SĐK trong văn bản', () => {
  const touch = catalogTouch('Gia hạn SĐK', 'Phụ lục có thuốc số đăng ký VD-35988-22 của công ty')
  assert.ok(touch.exact.some(row => String(row.reg || '').includes('35988')))
})
