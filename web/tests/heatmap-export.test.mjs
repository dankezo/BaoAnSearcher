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

test('VSS XLSX preserves selected data and exports an independent, colored Heatmap worksheet', async () => {
  const provinces = [
    {code:'01',name:'Hà Nội',value:120,prev:100,yoy:20,groups:[120,0,0,0,0]},
    {code:'79',name:'Hồ Chí Minh',value:50,prev:100,yoy:-50},
    {code:'38',name:'Thanh Hóa',value:30,prev:0,yoy:null},
  ]
  const files = await unzipStored(buildXlsx([{key:'name',label:'Thuốc'}], [{name:'Một dòng được chọn'}], undefined, 'VSS', [{name:'Heatmap',rows:provinces}]))
  assert.match(files.get('xl/workbook.xml'), /name="VSS".*name="Heatmap"/)
  assert.match(files.get('xl/_rels/workbook.xml.rels'), /Target="worksheets\/sheet2.xml"/)
  assert.match(files.get('[Content_Types].xml'), /PartName="\/xl\/worksheets\/sheet2.xml"/)
  const data = files.get('xl/worksheets/sheet1.xml')
  assert.match(data, /Một dòng được chọn/)
  assert.doesNotMatch(data, /Hà Nội/)
  const heatmap = files.get('xl/worksheets/sheet2.xml')
  assert.match(heatmap, /s="2" r="A5".*Hà Nội/)
  assert.match(heatmap, /s="3" r="D5".*Hồ Chí Minh/)
  assert.match(heatmap, /s="4" r="G5".*Thanh Hóa/)
  assert.match(heatmap, /<v>120<\/v>/)
  assert.match(heatmap, /mergeCell ref="A5:C5"/)
  assert.match(heatmap, /orientation="landscape"/)
})
