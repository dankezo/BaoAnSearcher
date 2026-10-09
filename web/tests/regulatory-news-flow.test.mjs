import assert from 'node:assert/strict'
import { test } from 'node:test'
import Module from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { create, act } from 'react-test-renderer'
const dir = fileURLToPath(new URL('..', import.meta.url))
const bundle = await build({ entryPoints:[`${dir}/src/components/regulatory/RegulatoryViews.jsx`], bundle:true, write:false, platform:'node', format:'cjs', jsx:'automatic', external:['react'], loader:{'.css':'empty'}, plugins:[{ name:'fixture', setup(b) {
  b.onResolve({filter:/regulatoryService$/},()=>({ path:'service',namespace:'fixture' }))
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const regulatoryRequest = (...args) => globalThis.regulatoryFixture(...args)'}))
} }] })
const compiled = new Module(`${dir}/tests/news-flow.cjs`); compiled.paths = Module._nodeModulePaths(dir)
compiled._compile(bundle.outputFiles[0].text,'news-flow.cjs')
const { LegalSearch, RegulatoryAdmin } = compiled.exports
const wait = () => new Promise(r=>setTimeout(r,350))
const content = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(content).join('') : node?.props ? content(node.props.children) : ''
test('feed persists read state, handles filters, related links, and admin saves', async () => {
  let read = false, saved, root; const calls=[]
  const doc={ id:'test',title:'Văn bản kiểm thử', code:'22/2024/TT-BYT',category:'BHYT',source_url:'https://moh.gov.vn/test',legal_status:'unknown' }
  global.regulatoryFixture = async (params,body) => {
    calls.push({params,body})
    if(body?.action==='read') { read=body.read; return {ok:true} }
    if(body?.entity) { saved=body; return {id:'new'} }
    if(params.related) return {items:[{...doc,id:'related',code:'47/2025/TT-BYT',reason:'Bãi bỏ TT22'}]}
    if(params.view==='sources') return {items:[],runs:[],canEdit:true}
    return {items: params.unread==='1' && read ? [] : [{...doc,read_at:read?'2026-09-28':null}],total:1,canEdit:true}
  }
  const button = label => root.root.findAllByType('button').find(n=>content(n.props.children).includes(label))
  try {
    await act(async()=>{root=create(React.createElement(LegalSearch,{query:'22/2024',news:true})); await wait()})
    assert.match(JSON.stringify(root.toJSON()),/22\/2024\/TT-BYT/)
    await act(async()=>button('Đánh dấu đã đọc').props.onClick()); await act(wait)
    assert.equal(read,true); assert.ok(button('Đã đọc'))
    await act(async()=>button('Chi tiết & liên quan').props.onClick()); await act(wait)
    assert.match(JSON.stringify(root.toJSON()),/47\/2025/)
    await act(async()=>root.root.findByType('select').props.onChange({target:{value:'BE'}})); await act(wait)
    assert.equal(calls.at(-1).params.category,'BE')
    await act(async()=>root.update(React.createElement(RegulatoryAdmin))); await act(wait)
    await act(async()=>button('+ Nguồn tin').props.onClick())
    const inputs=root.root.findAllByType('input')
    await act(async()=>inputs[0].props.onChange({target:{value:'DAV mới'}}))
    await act(async()=>inputs[1].props.onChange({target:{value:'https://dav.gov.vn/chuyen-muc'}}))
    await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}))
    assert.equal(saved.entity,'source');assert.equal(saved.data.name,'DAV mới')
  } finally { await act(async()=>root?.unmount());delete global.regulatoryFixture }
})
