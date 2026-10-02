import test from 'node:test'
import assert from 'node:assert/strict'
import { pageSlots } from '../src/pageSlots.js'

test('few pages show every number', () => {
  assert.deepEqual(pageSlots(0, 1), [0])
  assert.deepEqual(pageSlots(1, 3), [0, 1, 2])
  assert.deepEqual(pageSlots(0, 5), [0, 1, 2, 3, 4])
})

test('many pages stay within five numbers', () => {
  assert.deepEqual(pageSlots(0, 30), [0, 1, 2, 'gap', 29])
  assert.deepEqual(pageSlots(14, 30), [0, 'gap', 14, 'gap', 29])
  assert.deepEqual(pageSlots(29, 30), [0, 'gap', 27, 28, 29])
  for (const slots of [pageSlots(0, 30), pageSlots(14, 30), pageSlots(29, 30)]) {
    assert.ok(slots.filter((slot) => slot !== 'gap').length <= 5)
  }
})
