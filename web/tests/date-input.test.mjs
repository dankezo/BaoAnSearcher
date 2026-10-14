import test from 'node:test'
import assert from 'node:assert/strict'
import Module from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { act, create } from 'react-test-renderer'

const dir=fileURLToPath(new URL('..',import.meta.url))
const bundle=await build({stdin:{contents:'export {default,validateDateInputs} from "./src/DateInput.jsx"; export {fmtDateTime,relativeTime} from "./src/api.js"',resolveDir:dir},bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react'],loader:{'.css':'empty'},define:{'import.meta.env':'{}'}})
const compiled=new Module(`${dir}/tests/date-input.cjs`)
compiled.paths=Module._nodeModulePaths(dir);compiled._compile(bundle.outputFiles[0].text,'date-input.cjs')
const {default:DateInput,validateDateInputs}=compiled.exports

test('UTC sync timestamps show Vietnamese local time and retain date-only values',()=>{
 const timezone=process.env.TZ,now=Date.now
 try{
  process.env.TZ='Asia/Ho_Chi_Minh'
  Date.now=()=>new Date('2026-10-10T10:11:00Z').getTime()
  assert.equal(compiled.exports.fmtDateTime('2026-10-10T10:10:00Z'),'10/10/2026 17:10')
  assert.equal(compiled.exports.fmtDateTime('2026-10-10T17:10:00+07:00'),'10/10/2026 17:10')
  assert.equal(compiled.exports.relativeTime('2026-10-10T10:10:00Z'),'1 phút trước')
  assert.equal(compiled.exports.fmtDateTime('2026-10-01'),'01/10/2026')
  assert.equal(compiled.exports.fmtDateTime('2026-10-01 15:10:00'),'01/10/2026 15:10')
 }finally{Date.now=now;if(timezone===undefined)delete process.env.TZ;else process.env.TZ=timezone}
})

test('Vietnamese dates display dd/mm/yyyy, preserve ISO filters and reject nonexistent days',async()=>{
 let view,message='',pickerCalls=0
 const changed=[]
 const input={setCustomValidity:value=>{message=value},reportValidity:()=>!message,showPicker:()=>pickerCalls++}
 const props={value:'2025-06-01',onValueChange:value=>changed.push(value)}
 try{
  await act(async()=>{view=create(React.createElement(DateInput,props),{createNodeMock:()=>input})})
  const text=()=>view.root.findAllByType('input').find(node=>node.props.type==='text')
  const edit=async value=>act(async()=>text().props.onInput({currentTarget:{...input,value}}))
  assert.equal(text().props.value,'01/06/2025')
  await edit('31/02/2025');assert.equal(changed.length,0);assert.match(message,/dd\/mm\/yyyy/)
  await edit('29/02/2024');assert.equal(changed.at(-1),'2024-02-29');assert.equal(message,'')
  await edit('');assert.equal(changed.at(-1),'')
  await edit('bad')
  await act(async()=>view.root.findAllByType('input').find(node=>node.props.type==='date').props.onInput({currentTarget:{value:'2025-06-01'}}))
  assert.equal(text().props.value,'01/06/2025');assert.equal(message,'')
  await act(async()=>view.root.findByType('button').props.onClick());assert.equal(pickerCalls,1)
  await act(async()=>view.update(React.createElement(DateInput,{...props,value:'2026-10-01'})))
  assert.equal(text().props.value,'01/10/2026')
 }finally{if(view)await act(async()=>view.unmount())}
})
test('invalid dates block an applied search; hidden tab inputs do not block it',()=>{
 let shown=0
 const invalid={getClientRects:()=>[{}],reportValidity:()=>shown++}
 const hidden={getClientRects:()=>[],reportValidity:()=>{throw new Error('Hidden date should be ignored')}}
 assert.equal(validateDateInputs({querySelectorAll:()=>[hidden,invalid]}),false)
 assert.equal(shown,1)
 assert.equal(validateDateInputs({querySelectorAll:()=>[hidden]}),true)
})
