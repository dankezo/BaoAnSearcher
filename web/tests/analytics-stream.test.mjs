import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import Module from 'node:module'
import {fileURLToPath} from 'node:url'

const dir=fileURLToPath(new URL('..',import.meta.url))
const built=await build({entryPoints:[`${dir}/src/analytics/client.ts`],bundle:true,write:false,platform:'node',format:'cjs',define:{'import.meta.env':'{}'},plugins:[{name:'stream-fixture',setup(b){
  b.onResolve({filter:/supabaseClient$|supabase-auth$|queryCache$/},args=>({path:args.path,namespace:'fixture'}))
  b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path.endsWith('supabaseClient')?'export const getSupabase=()=>({auth:{getSession:async()=>({data:{session:{user:{id:"owner"}}}})}})':path.endsWith('supabase-auth')?'export const authenticatedFetch=(...args)=>globalThis.__streamFetch(...args)':'export const stableKey=(p,b)=>JSON.stringify([p,b]);export const cachedQuery=(_key,fn)=>fn()'}))
}}]})
const module=new Module(`${dir}/tests/analytics-stream.cjs`);module._compile(built.outputFiles[0].text,'analytics-stream.cjs')
const {loadOverview}=module.exports

test('overview shows completed sources as chunked UTF-8 arrives and keeps final facts intact',async()=>{
  const bytes=new TextEncoder().encode(JSON.stringify({type:'source',source:'dav'})+'\n'+JSON.stringify({type:'progress',source:'vss',completed:1,total:14})+'\n'+JSON.stringify({type:'source',source:'vss'})+'\n'+JSON.stringify({type:'complete',data:{entity:'Bệnh viện Sơn Tây',sources:{dav:{count:4}}}})+'\n')
  globalThis.__streamFetch=async(_url,options)=>{assert.equal(options.headers.Accept,'application/x-ndjson');return new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=7)controller.enqueue(bytes.slice(i,i+7));controller.close()}}),{headers:{'Content-Type':'application/x-ndjson'}})}
  try{const sources=[],progress=[],data=await loadOverview({},source=>sources.push(source),step=>progress.push(step));assert.equal(progress[0].completed,1);assert.equal(progress[0].total,14);assert.deepEqual(sources,['dav','vss']);assert.equal(data.entity,'Bệnh viện Sơn Tây');assert.equal(data.sources.dav.count,4)}finally{delete globalThis.__streamFetch}
})

test('JSON local response remains supported; an interrupted stream is retryable',async()=>{
  const sources=[]
  globalThis.__streamFetch=async()=>Response.json({count:7})
  try{assert.equal((await loadOverview({},source=>sources.push(source))).count,7);assert.deepEqual(sources,[])
    globalThis.__streamFetch=async()=>new Response('{"type":"source","source":"dav"}\n',{headers:{'Content-Type':'application/x-ndjson'}})
    await assert.rejects(loadOverview({}),/gián đoạn/)
  }finally{delete globalThis.__streamFetch}
})
