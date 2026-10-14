import test from 'node:test'
import assert from 'node:assert/strict'
import { buildXlsx } from '../src/export.js'

async function unzipStored(blob) {
  const bytes = Buffer.from(await blob.arrayBuffer())
  const files = new Map()
  let offset = 0
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const size = bytes.readUInt32LE(offset + 18)
    const nameLength = bytes.readUInt16LE(offset + 26)
    const extraLength = bytes.readUInt16LE(offset + 28)
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString()
    const start = offset + 30 + nameLength + extraLength
    files.set(name, bytes.subarray(start, start + size).toString())
    offset = start + size
  }
  return files
}

test('sum columns get a styled summary row before data on every tabular sheet', async () => {
  const columns = [{ key: 'name', label: 'Item' }, { key: 'unit', label: 'Unit price', sum: true }, { key: 'total', label: 'Total', sum: true }]
  const rows = [{ name: 'A', unit: 1.25, total: 2.5 }, { name: 'B', unit: '3.00', total: 4.75 }]
  const files = await unzipStored(buildXlsx(columns, rows, undefined, 'Data', [
    { name: 'Extra', columns: [{ key: 'qty', label: 'Qty', sum: true }], rows: [{ qty: 0.5 }, { qty: 1.25 }] },
  ]))

  const sheet = files.get('xl/worksheets/sheet1.xml')
  assert.match(sheet, /<pane ySplit="2" topLeftCell="A3"/)
  assert.match(sheet, /<row r="2"><c r="A2" t="inlineStr" s="5"><is><t>Tổng<\/t><\/is><\/c><c r="B2" s="5"><f>SUM\(B3:B4\)<\/f><v>1\.25<\/v><\/c><c r="C2" s="5"><f>SUM\(C3:C4\)<\/f><v>7\.25<\/v><\/c><\/row>/)
  assert.match(sheet, /<row r="3"><c r="A3".*>A<\/t><\/is><\/c><c r="B3"><v>1\.25<\/v><\/c>/)
  assert.match(sheet, /<c r="B2" s="5"><f>/)
  assert.match(files.get('xl/worksheets/sheet2.xml'), /<c r="A2" s="5"><f>SUM\(A3:A4\)<\/f><v>1\.75<\/v><\/c>/)
  assert.match(files.get('xl/styles.xml'), /<cellXfs count="6">/)
})

test('empty sum export uses a styled zero without a circular formula', async () => {
  const files = await unzipStored(buildXlsx([{ key: 'amount', sum: true }], []))
  const sheet = files.get('xl/worksheets/sheet1.xml')
  assert.match(sheet, /<row r="2"><c r="A2" s="5"><v>0<\/v><\/c><\/row>/)
  assert.doesNotMatch(sheet, /<f>/)
})
