import assert from 'node:assert/strict'
import test from 'node:test'
import Module from 'node:module'
import {build} from 'esbuild'
import React from 'react'
import {act,create} from 'react-test-renderer'
const result=await build({entryPoints:['src/PortfolioCockpit.jsx'],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react'],loader:{'.css':'empty'},define:{'import.meta.env':'{}'},plugins:[{name:'fixtures',setup(b){
b.onResolve({filter:/\/(api|supabaseCloud|components)$/},a=>({path:a.path,namespace:'fixture'}))
b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path.endsWith('/api')?'export const api={baoanPortfolio:async()=>globalThis.fixture}':a.path.endsWith('/supabaseCloud')?'export const supabaseConfigured=false; export const cloudPortfolio=async()=>({})':'export const LoadingOverlay=()=>null; export const Modal=()=>null; export const useLoadProgress=()=>({percent:0});'}))
}}]})
const mod=new Module(import.meta.url);mod.paths=Module._nodeModulePaths(process.cwd());mod._compile(result.outputFiles[0].text,'fixture.cjs')
test('separate searchable awards and expanded recent registrations',async()=>{
globalThis.fixture={rows:[],kpis:{cmo:{shares:[]},cycle:{greenPct:1,ready36:2},awards12m:{revenue:5000,packages:2,records:2,quantityTotals:[{unit:'Viên',quantity:5},{unit:'Lọ',quantity:2}]}},awardRows:[{name:'Paracetamol',tenderNo:'IB-A'},{name:'Amoxicillin',tenderNo:'IB-B'}],newRegistrations:[{regNumber:'NEW-SDK',name:'Rival',ctyDangKy:'Registrant company',inn:'Paracetamol',grantDate:'2026-09-01',groupKnown:true,groups:['N4'],matches:[{id:'own',brandName:'Own drug',inn:'Paracetamol',groups:['N4']}]}]}
let root;await act(async()=>{root=create(React.createElement(mod.exports.default,{localMode:true}));await new Promise(r=>setTimeout(r,0))})
const text=()=>JSON.stringify(root.toJSON());const click=async label=>act(async()=>root.root.findAllByType('button').find(b=>b.props.children===label).props.onClick())
assert.match(text(),/Tổng doanh thu trúng thầu 12 tháng/);assert.doesNotMatch(text(),/Quy mô|Ổ vàng|Kích hoạt thầu/)
await click('Lịch sử trúng');assert.match(text(),/IB-A/);assert.match(text(),/IB-B/)
await act(async()=>root.root.findByType('input').props.onChange({target:{value:'paracetamol'}}));assert.doesNotMatch(text(),/IB-B/)
await click('SĐK mới');assert.match(text(),/NEW-SDK/);assert.doesNotMatch(text(),/NN4/);assert.match(text(),/Registrant company/)
await act(async()=>root.root.findAllByType('button').find(b=>b.props['aria-expanded']===false).props.onClick());assert.match(text(),/Own drug/)
await act(async()=>root.unmount());delete globalThis.fixture
})

test('award history appends on scroll and resets after searching', async () => {
globalThis.fixture={rows:[],kpis:{cmo:{shares:[]},cycle:{}},awardRows:Array.from({length:120},(_,i)=>({name:`Drug ${i}`,tenderNo:`IB-${i}`})),newRegistrations:[]}
let intersect, disconnected=0
globalThis.IntersectionObserver=class {constructor(callback){intersect=callback} observe(){} disconnect(){disconnected++}}
let root
try {
 await act(async()=>{root=create(React.createElement(mod.exports.default,{localMode:true}),{createNodeMock:()=>({parentElement:{}})});await new Promise(r=>setTimeout(r,0))})
 await act(async()=>root.root.findAllByType('button').find(b=>b.props.children==='Lịch sử trúng').props.onClick())
 const count=()=>root.root.findAllByType('tbody')[0].findAllByType('tr').length
 assert.equal(count(),50)
 await act(async()=>intersect([{isIntersecting:true}]))
 assert.equal(count(),100)
 await act(async()=>intersect([{isIntersecting:true}]))
 assert.equal(count(),120)
 assert.ok(disconnected>0)
 await act(async()=>root.root.findByType('input').props.onChange({target:{value:'Drug 119'}}))
 assert.equal(count(),1)
 assert.deepEqual(root.root.findAllByType('th').slice(2,4).map(th=>th.children[0]),['Tên thuốc','SĐK'])
} finally {
 if(root) await act(async()=>root.unmount())
 delete globalThis.fixture;delete globalThis.IntersectionObserver
}
})
