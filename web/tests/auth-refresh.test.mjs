import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import Module from 'node:module'
import {fileURLToPath} from 'node:url'

const dir=fileURLToPath(new URL('..',import.meta.url))
const built=await build({entryPoints:[`${dir}/src/lib/supabase-auth.js`],bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'auth-fixture',setup(b){
  b.onResolve({filter:/supabaseClient$/},()=>({path:'auth-client',namespace:'fixture'}))
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const getSupabase=()=>globalThis.__authClient;export const supabaseConfigured=true,isCompanyEmail=()=>true,ALLOWED_EMAIL_DOMAIN="example.test"'}))
}}]})
const module=new Module(`${dir}/tests/auth-refresh.cjs`);module._compile(built.outputFiles[0].text,'auth-refresh.cjs')
const {authenticatedFetch}=module.exports

test('concurrent expired API requests refresh once and retry with the new token',async()=>{
  const previous=globalThis.fetch;let token='expired',refreshes=0;const sent=[]
  globalThis.__authClient={auth:{getSession:async()=>({data:{session:{access_token:token,user:{id:'owner'}}}}),refreshSession:async()=>{refreshes++;await new Promise(resolve=>setTimeout(resolve,15));token='fresh';return {data:{session:{access_token:token,user:{id:'owner'}}}}}}}
  globalThis.fetch=async(url,options)=>{sent.push([url,options.headers.Authorization]);return new Response('{}',{status:options.headers.Authorization==='Bearer expired'?401:200})}
  try{
    const results=await Promise.all(['/radar','/news'].map(url=>authenticatedFetch(url)))
    assert.ok(results.every(result=>result.status===200));assert.equal(refreshes,1)
    assert.equal(sent.filter(([,header])=>header==='Bearer fresh').length,2)
    let calls=0;globalThis.fetch=async()=>{calls++;return new Response('{}',{status:403})}
    assert.equal((await authenticatedFetch('/forbidden')).status,403);assert.equal(calls,1);assert.equal(refreshes,1)
  }finally{globalThis.fetch=previous;delete globalThis.__authClient}
})

test('failed refresh returns an actionable 401 and never retries endlessly',async()=>{
  const previous=globalThis.fetch;let calls=0
  globalThis.__authClient={auth:{getSession:async()=>({data:{session:{access_token:'expired',user:{id:'owner'}}}}),refreshSession:async()=>({data:{session:null},error:new Error('expired')})}}
  globalThis.fetch=async()=>{calls++;return new Response('{}',{status:401})}
  try{await assert.rejects(authenticatedFetch('/news'),error=>error.status===401&&/đăng nhập lại/.test(error.message));assert.equal(calls,1)}finally{globalThis.fetch=previous;delete globalThis.__authClient}
})

test('a delayed 401 uses the refreshed token once and explains a rejected retry',async()=>{
  const previous=globalThis.fetch;let reads=0;const sent=[]
  globalThis.__authClient={auth:{getSession:async()=>({data:{session:{access_token:reads++?'fresh':'expired',user:{id:'owner'}}}}),refreshSession:async()=>{throw new Error('should reuse the current session')}}}
  globalThis.fetch=async(url,options)=>{sent.push(options.headers.Authorization);return new Response('{}',{status:401})}
  try{await assert.rejects(authenticatedFetch('/news'),error=>error.status===401&&/đăng nhập lại/.test(error.message));assert.deepEqual(sent,['Bearer expired','Bearer fresh'])}finally{globalThis.fetch=previous;delete globalThis.__authClient}
})

test('an account switch during an API request cannot retry as the new user',async()=>{
  const previous=globalThis.fetch;let reads=0,calls=0
  globalThis.__authClient={auth:{getSession:async()=>({data:{session:{access_token:'token',user:{id:reads++?'other':'owner'}}}})}}
  globalThis.fetch=async()=>{calls++;return new Response('{}',{status:401})}
  try{await assert.rejects(authenticatedFetch('/news'),error=>error.status===401&&/tài khoản đã thay đổi/.test(error.message));assert.equal(calls,1)}finally{globalThis.fetch=previous;delete globalThis.__authClient}
})
