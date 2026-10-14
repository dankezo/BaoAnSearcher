import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import Module from 'node:module'
import {Readable} from 'node:stream'
import {fileURLToPath} from 'node:url'

const dir=fileURLToPath(new URL('..',import.meta.url))
const built=await build({entryPoints:[`${dir}/../api-lib/routes/analytics.js`],bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'route-fixture',setup(b){
 b.onResolve({filter:/^\.\.\/auth\.js$|^\.\.\/analytics\/(cloud|snapshot|portfolio|insight|companyStore|awards)\.js$|^\.\/insight\.js$/},args=>({path:args.path,namespace:'fixture'}))
 b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path.endsWith('auth.js')?'export const requireUser=async()=>({accessToken:"test"});export const json=(res,status,value)=>{res.statusCode=status;res.end(JSON.stringify(value))}':path.endsWith('cloud.js')?'export const cloudAdapter={separateAggregates:true,relation:async()=>"SELECT 1",query:async()=>[{kind:"summary",period:"current",label:"",count:1,amount:10,won_packages:1}]}':path.endsWith('snapshot.js')?'export const readSnapshot=async()=>null':path.endsWith('insight.js')?'export const rules=()=>({method:"rules"});export const insight=()=>({});export const regulatoryContext=()=>({})':path.endsWith('companyStore.js')?'export const companyProfiles=async()=>({})':path.endsWith('awards.js')?'export const recentAwards=async()=>({})':'export const portfolioCoordinates=async()=>[];export const companyStrategy=async()=>({})'}))
}}]})
const module=new Module(`${dir}/tests/analytics-route-stream.cjs`);module.paths=Module._nodeModulePaths(dir);module._compile(built.outputFiles[0].text,'analytics-route-stream.cjs')
const handler=module.exports.default

test('overview route streams each source followed by the complete compatible report',async()=>{
 const req=Readable.from([Buffer.from(JSON.stringify({mode:'macro',months:12,comparison:'yoy',filters:{}}))]);req.url='/api/analytics/overview';req.headers={accept:'application/x-ndjson'}
 const headers={},chunks=[];let ended=false
 const res={setHeader:(key,value)=>{headers[key]=value},write:chunk=>chunks.push(chunk),end:()=>{ended=true}}
 await handler(req,res)
 const events=chunks.join('').trim().split('\n').map(JSON.parse)
 assert.equal(res.statusCode,200);assert.match(headers['Content-Type'],/application\/x-ndjson/);assert.equal(ended,true)
 assert.equal(events[0].type,'start');assert.equal(events.filter(event=>event.type==='source').length,4)
 for(const source of ['msc_prices','msc_tenders','vss','dav']){
  const steps=events.filter(event=>event.type==='progress'&&event.source===source)
  assert.equal(steps[0].completed,0);assert.ok(steps[0].total>0)
  assert.equal(steps.at(-1).completed,steps.at(-1).total)
  assert.deepEqual(steps.map(step=>step.completed),Array.from({length:steps[0].total+1},(_,index)=>index))
 }
 const final=events.at(-1);assert.equal(final.type,'complete');assert.equal(final.data.version,2)
 assert.equal(Object.keys(final.data.sources).length,4);assert.ok(final.data.baseline)
})
