import test from 'node:test'
import assert from 'node:assert/strict'
import { refreshCloudScopes, scopeFor, attachScope } from '../api-lib/scopeMatch.js'

test('TiDB webforms are loaded once and used for displayed medicine lines', async () => {
  let calls = 0
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const db = { dialect: 'tidb', async query() { calls++; return { rows: [{ notify_id: id, tender_no: 'IB-CLOUD', lots: JSON.stringify([{ tenHoatChat: 'Paracetamol', quantity: 80, uom: 'Viên' }]) }] } } }
  await Promise.all([refreshCloudScopes(db), refreshCloudScopes(db)])
  await refreshCloudScopes(db)
  assert.equal(calls, 1)
  assert.equal(scopeFor({ source_id: id }).lots[0].tenHoatChat, 'Paracetamol')
  const items = [{ source_id: id }]
  attachScope(items)
  assert.equal(items[0].scope_lines[0].qty, 80)
  assert.equal(items[0].ingredient, 'Paracetamol')
})
