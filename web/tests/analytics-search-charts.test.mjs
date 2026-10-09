import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import Module from 'node:module'
import React from 'react'
import {act,create} from 'react-test-renderer'
import {fileURLToPath} from 'node:url'

const entries=['../src/analytics/OmniFilterBar.tsx','../src/analytics/Charts.tsx'].map(p=>fileURLToPath(new URL(p,import.meta.url)))
const built=await build({entryPoints:entries,outdir:'out',bundle:true,write:false,platform:'node',format:'cjs',external:['react','react/jsx-runtime','lucide-react'],plugins:[{name:'analytics-test-mocks',setup(b){
 b.onResolve({filter:/^\.\/client$/},()=>({path:'client',namespace:'analytics-test'}))
 b.onLoad({filter:/^client$/,namespace:'analytics-test'},()=>({loader:'js',contents:`export const loadSuggestions=(...args)=>globalThis.__analyticsLoadSuggestions(...args);export const presets=async()=>[];export const savePreset=async()=>{}`}))
 b.onResolve({filter:/^\.\/ui$/},()=>({path:'ui',namespace:'analytics-test'}))
 b.onLoad({filter:/^ui$/,namespace:'analytics-test'},()=>({loader:'js',contents:`import React from 'react';export const Card=({title,children})=>React.createElement('section',null,React.createElement('h2',null,title),children);export const Dialog=()=>null`}))
 b.onResolve({filter:/^recharts$/},()=>({path:'recharts',namespace:'analytics-test'}))
 b.onLoad({filter:/^recharts$/,namespace:'analytics-test'},()=>({loader:'js',contents:`import React from 'react';const passthrough=({children})=>React.createElement('div',null,children);export const ResponsiveContainer=passthrough,LineChart=({children,onClick})=>React.createElement('div',{'data-line-chart':true,onClick},children),Line=({dataKey,onClick})=>React.createElement('button',{'data-line':dataKey,onClick},dataKey),XAxis=passthrough,YAxis=passthrough,Tooltip=passthrough,CartesianGrid=passthrough,BarChart=passthrough,Bar=passthrough,Cell=()=>null;export const PieChart=passthrough;export const Pie=({data=[],onClick,children})=>React.createElement('div',{'data-chart-pie':'true'},...data.map(d=>React.createElement('button',{key:d.name,'data-pie-slice':d.name,onClick:()=>onClick?.({name:d.name})},d.name)),children)`}))
}}]})
function loadEntry(name){const file=built.outputFiles.find(f=>f.path.includes(name));assert.ok(file,`missing compiled entry ${name}`);const mod=new Module(name);mod.paths=Module._nodeModulePaths(process.cwd());mod._compile(file.text,`${name}.cjs`);return mod.exports}
const {default:OmniFilterBar}=loadEntry('OmniFilterBar')
const {PriceComparison,GroupChart,Trend}=loadEntry('Charts')
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const query=(mode,entity,role='winner',entityField='ingredient')=>({mode,entity,role,entityField,territoryField:'province',months:12,comparison:'yoy',filters:{}})
function inputOf(view){return view.root.find(el=>el.type==='input'&&el.props['aria-label']==='Tìm thuốc, doanh nghiệp, địa bàn')}
function applyOf(view){return view.root.findAllByType('button').find(el=>el.children.includes('Áp dụng'))}
async function typeAndResolve(view,value){await act(async()=>{inputOf(view).props.onChange({target:{value}});await delay(270)})}
async function apply(view){await act(async()=>{await applyOf(view).props.onClick()})}
function childText(children){return React.Children.toArray(children).map(child=>React.isValidElement(child)?childText(child.props.children):String(child)).join('')}
function legend(view,name){return view.root.findAll(el=>el.type==='button'&&el.props.className?.includes('analytics-legend-button')&&childText(el.props.children).includes(name))[0]}
function deltaText(view){return view.root.find(el=>el.props.className==='analytics-unit-delta').findAllByType('strong').at(-1).children.join('')}

test('auto-resolves territory from company-manufacturer context and company from drug-registration context',async()=>{
 const applied=[]
 globalThis.__analyticsLoadSuggestions=async text=>text==='Hà Nội'?{items:[{mode:'territory',role:'winner',territoryField:'province',label:'Hà Nội'}]}:{items:[{mode:'company',role:'winner',label:'Công ty Cổ phần Vĩnh Phúc'}]}
 for(const [initial,search,expected] of [
  [query('company','Công ty A','manufacturer'),'Hà Nội',{mode:'territory',entity:'Hà Nội',role:'winner',territoryField:'province'}],
  [query('drug','SDK-OLD','winner','registration'),'Vĩnh Phúc',{mode:'company',entity:'Công ty Cổ phần Vĩnh Phúc',role:'all'}]
 ]){
  let view
  await act(async()=>{view=create(React.createElement(OmniFilterBar,{query:initial,onApply:value=>applied.push(value),onExport:()=>{},exporting:false}))})
  await typeAndResolve(view,search);await apply(view)
  const value=applied.at(-1);assert.equal(value.mode,expected.mode);assert.equal(value.entity,expected.entity);assert.equal(value.role,expected.role)
  if(expected.territoryField)assert.equal(value.territoryField,expected.territoryField)
  await act(async()=>view.unmount())
 }
 delete globalThis.__analyticsLoadSuggestions
})

test('company suggestion applies all roles; ambiguity and lookup failure do not reuse the previous scope',async()=>{
 const applied=[]
 globalThis.__analyticsLoadSuggestions=async text=>text==='BaoAn query'?{items:[{mode:'company',role:'winner',label:'Công ty Cổ phần Dược Bảo An'}]}:text==='Ambiguous query'?{items:[{mode:'company',role:'winner',label:'Công ty A'},{mode:'company',role:'manufacturer',label:'Công ty B'}]}:Promise.reject(new Error('fixture failure'))
 let view
 await act(async()=>{view=create(React.createElement(OmniFilterBar,{query:query('drug','Old Ingredient'),onApply:value=>applied.push(value),onExport:()=>{},exporting:false}))})
 await typeAndResolve(view,'BaoAn query')
 const option=view.root.findAll(el=>el.props.role==='option')[0]
 await act(async()=>option.props.onClick())
 await apply(view)
 assert.equal(applied.at(-1).mode,'company');assert.equal(applied.at(-1).role,'all');assert.equal(applied.at(-1).entity,'Công ty Cổ phần Dược Bảo An')
 const appliedCount=applied.length
 await typeAndResolve(view,'Ambiguous query');await apply(view)
 assert.equal(applied.length,appliedCount,'ambiguous candidates must not apply the existing drug scope')
 assert.match(view.root.findAll(el=>el.props.role==='alert').map(el=>el.children.join('')).join(' '),/nhiều chủ thể/i)
 await typeAndResolve(view,'Fetch failure');await apply(view)
 assert.equal(applied.length,appliedCount,'failed lookup must not apply the existing drug scope')
 assert.match(view.root.findAll(el=>el.props.role==='alert').map(el=>el.children.join('')).join(' '),/Chưa xác minh được chủ thể/i)
 await act(async()=>view.unmount());delete globalThis.__analyticsLoadSuggestions
})

test('empty filter mount performs no suggestion call',async()=>{
 let calls=0;globalThis.__analyticsLoadSuggestions=async()=>{calls++;return {items:[]}}
 let view
 await act(async()=>{view=create(React.createElement(OmniFilterBar,{query:query('macro',''),onApply:()=>{},onExport:()=>{},exporting:false}));await delay(300)})
 assert.equal(calls,0)
 await act(async()=>view.unmount());delete globalThis.__analyticsLoadSuggestions
})

const unitStats={rows:[
 {kind:'unit',label:'túi',period:'current',amount:'150'}, {kind:'unit',label:'túi',period:'previous',amount:'100'},
 {kind:'unit',label:'viên',period:'current',amount:'60'}, {kind:'unit',label:'viên',period:'previous',amount:'120'},
 {kind:'unit',label:'ống',period:'current',amount:'20'}
]}

test('unit donuts compare current/prior values and legend or slice selects unit growth accessibly',async()=>{
 let view
 await act(async()=>{view=create(React.createElement(PriceComparison,{stats:unitStats}))})
 assert.equal(view.root.findAllByProps({'data-chart-pie':'true'}).length,2)
 assert.equal(deltaText(view),'+4,545% · tăng')
 const tablet=legend(view,'viên');assert.ok(tablet);assert.equal(tablet.props['aria-pressed'],false)
 await act(async()=>tablet.props.onClick())
 assert.equal(deltaText(view),'-50% · giảm')
 assert.equal(legend(view,'viên').props['aria-pressed'],true)
 await act(async()=>legend(view,'viên').props.onClick())
 assert.equal(deltaText(view),'+4,545% · tăng')
 assert.equal(legend(view,'viên').props['aria-pressed'],false)
 const slice=view.root.findAllByProps({'data-pie-slice':'túi'})[0]
 await act(async()=>slice.props.onClick())
 assert.equal(deltaText(view),'+50% · tăng')
 await act(async()=>view.unmount())
})

test('unit without a prior value and empty group data use compact unavailable states',async()=>{
 let view
 await act(async()=>{view=create(React.createElement(PriceComparison,{stats:{rows:[{kind:'unit',label:'gói',period:'current',amount:'42'}]}}))})
 assert.match(JSON.stringify(view.toJSON()),/Chưa có dữ liệu kỳ này/)
 assert.match(JSON.stringify(view.toJSON()),/Chưa có cơ sở tính tăng trưởng/)
 await act(async()=>view.unmount())
 await act(async()=>{view=create(React.createElement(GroupChart,{stats:{rows:[{kind:'group',label:'1',period:'current',amount:'600'},{kind:'group',label:'2',period:'current',amount:'400'}]}}))})
 assert.equal(view.root.findAllByProps({'data-chart-pie':'true'}).length,1)
 assert.ok(legend(view,'Nhóm 1'));assert.ok(legend(view,'Nhóm 2'))
 await act(async()=>view.unmount())
})


test('group slices toggle off and blank click, double click and Escape restore totals',async()=>{
 let view
 await act(async()=>{view=create(React.createElement(GroupChart,{stats:{rows:[{kind:'group',label:'1',period:'current',amount:'600'},{kind:'group',label:'2',period:'current',amount:'400'}]}}))})
 const selected=()=>legend(view,'Nhóm 1').props['aria-pressed']
 const box=()=>view.root.findByProps({className:'analytics-donut-layout analytics-group-donut'})
 await act(async()=>legend(view,'Nhóm 1').props.onClick());assert.equal(selected(),true)
 await act(async()=>legend(view,'Nhóm 1').props.onClick());assert.equal(selected(),false)
 for(const clear of [()=>box().props.onClick({target:{closest:()=>null}}),()=>box().props.onDoubleClick(),()=>box().props.onKeyDown({key:'Escape'})]){
  await act(async()=>legend(view,'Nhóm 1').props.onClick());assert.equal(selected(),true)
  await act(async()=>clear());assert.equal(selected(),false)
 }
 await act(async()=>view.unmount())
})

test('VSS trend provides all-period and monthly group value/share details; selection can return to total',async()=>{
 let view
 const rows=[{kind:'month',period:'current',label:'2026-09',amount:'300'},
  {kind:'group',period:'current',label:'1',amount:'100',count:2},{kind:'group',period:'current',label:'2',amount:'200',count:3},
  {kind:'month_group',period:'current',label:'2026-09|1',amount:'40',count:1},{kind:'month_group',period:'current',label:'2026-09|2',amount:'260',count:2}]
 await act(async()=>{view=create(React.createElement(Trend,{stats:{rows},source:'vss'}))})
 const n1=()=>view.root.findAllByType('button').find(x=>childText(x.props.children)==='N1'&&typeof x.props['aria-pressed']==='boolean')
 const box=()=>view.root.findByProps({className:'analytics-trend'})
 assert.match(JSON.stringify(view.toJSON()),/Tỷ trọng/)
 assert.equal(view.root.findAllByType('select').length,0)
 await act(async()=>n1().props.onClick());assert.equal(n1().props['aria-pressed'],true)
 assert.equal(view.root.findByType('tbody').findAllByType('tr').length,1)
 await act(async()=>n1().props.onClick());assert.equal(n1().props['aria-pressed'],false)
 await act(async()=>view.root.findByProps({'data-line-chart':true}).props.onClick({activeLabel:'2026-09'}))
 assert.match(JSON.stringify(view.toJSON()),/40 ₫/)
 for(const clear of [()=>box().props.onClick({target:{closest:()=>null}}),()=>box().props.onDoubleClick(),()=>box().props.onKeyDown({key:'Escape'})]){
  await act(async()=>n1().props.onClick());assert.equal(n1().props['aria-pressed'],true)
  await act(async()=>clear());assert.equal(n1().props['aria-pressed'],false)
 }
 await act(async()=>view.unmount())
})
