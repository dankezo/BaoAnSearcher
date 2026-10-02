import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { beIngredients, documents, searchRows } from '../src/regulatoryData.js'

test('BE is the 26-entry official appendix, preserving the combination entry', () => {
  assert.equal(beIngredients.length, 26)
  assert.equal(new Set(beIngredients.map(r => r.hoatChat)).size, 26)
  assert.equal(beIngredients[12].hoatChat, 'Amoxicilin + acid clavulanic')
  assert.equal(searchRows(beIngredients, 'cefuroxime axetil').length, 1)
  assert.equal(searchRows(beIngredients, 'unknown').length, 0)
})
test('Search supports Vietnamese accents, multiple terms and original catalogs', () => {
  assert.ok(searchRows(documents, 'dau thau').length >= 2)
  assert.equal(searchRows(documents, '40/2025 cong lap').length, 1)
  const dm93 = JSON.parse(readFileSync(new URL('../public/data/dm93.json', import.meta.url)))
  assert.equal(dm93.length, 93)
  assert.ok(searchRows(dm93, 'acyclovir 400').length)
})
test('Draft sources cannot be marked verified or have an effective date', () => {
  for (const row of documents.filter(d => d.id.startsWith('draft'))) {
    assert.equal(row.verified, false)
    assert.equal(row.effective, '')
  }
  assert.ok(documents.every(d => d.url.startsWith('https://')))
})
