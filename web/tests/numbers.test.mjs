import test from 'node:test'
import assert from 'node:assert/strict'
import { formatNumber, numberValue, lineValue } from '../src/numbers.js'

test('API padded decimals lose only meaningless zeroes; real fractions remain',()=>{
  assert.equal(formatNumber('123456.000'),'123.456')
  assert.equal(formatNumber('1234.50'),'1.234,5')
  assert.equal(numberValue('100.000'),100)
  assert.equal(numberValue('100.000',true),100000)
  assert.equal(numberValue('1.234,50',true),1234.5)
  assert.equal(lineValue('1234.50','2.000'),2469)
  assert.equal(lineValue('',2),null)
  assert.equal(lineValue(' ',2),null)
  assert.equal(lineValue(0,2),0)
  assert.equal(lineValue(Infinity,2),null)
})
