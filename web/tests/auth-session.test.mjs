import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import Module from 'node:module'
import {fileURLToPath} from 'node:url'
import React from 'react'
import {act,create} from 'react-test-renderer'

const dir=fileURLToPath(new URL('..',import.meta.url))
const built=await build({entryPoints:[`${dir}/src/auth.jsx`],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react'],define:{'import.meta.env':'{}'},plugins:[{name:'session-fixture',setup(b){
 b.onResolve({filter:/supabaseClient$/},()=>({path:'client',namespace:'fixture'}))
 b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const ALLOWED_EMAIL_DOMAIN="example.test",REMEMBER_DAYS=30,supabaseConfigured=true;export const getSupabase=()=>globalThis.__currentAuth;export const resetSupabaseClient=()=>{globalThis.__currentAuth=globalThis.__nextAuth};export const setRememberPreference=()=>{};export const enforceRememberWindow=()=>true;export const isAllowedEmail=email=>email==="staff@example.test";export const appRedirectUrl=()=>"http://localhost/"'}))
}}]})
const module=new Module(`${dir}/tests/auth-session.cjs`);module.paths=Module._nodeModulePaths(dir);module._compile(built.outputFiles[0].text,'auth-session.cjs')
const {AuthProvider,useAuth}=module.exports

test('login rebinds auth listener so refresh and expiry update the active session',async()=>{
 const previous=globalThis.window;globalThis.window={location:{search:'',hash:''}}
 const client=()=>{
  const listeners=new Set();let session=null,insideEvent=false
  const emit=(event,next)=>{session=next;insideEvent=true;for(const callback of listeners)assert.equal(callback(event,next),undefined);insideEvent=false}
  return {listeners,emit,auth:{getSession:async()=>({data:{session}}),onAuthStateChange:callback=>{listeners.add(callback);return {data:{subscription:{unsubscribe:()=>listeners.delete(callback)}}}},signInWithPassword:async()=>{session={access_token:'signed-in',user:{id:'owner',email:'staff@example.test'}};return {data:{session}}},signOut:async()=>{assert.equal(insideEvent,false);emit('SIGNED_OUT',null)}}}
 }
 const old=client(),active=client();globalThis.__currentAuth=old;globalThis.__nextAuth=active
 let state,tree;function Harness(){state=useAuth();return null}
 try{
  await act(async()=>{tree=create(React.createElement(AuthProvider,null,React.createElement(Harness)))})
  assert.equal(old.listeners.size,1)
  await act(async()=>{await state.signIn('staff@example.test','fixture-only')})
  assert.equal(old.listeners.size,0);assert.equal(active.listeners.size,1)
  await act(async()=>active.emit('TOKEN_REFRESHED',{access_token:'renewed',user:{id:'owner',email:'staff@example.test'}}))
  assert.equal(state.session.access_token,'renewed')
  await act(async()=>active.emit('SIGNED_OUT',null))
  assert.equal(state.user,null);assert.match(state.authError,/hết hiệu lực/)
  await act(async()=>active.emit('SIGNED_IN',{access_token:'revoked',user:{id:'unknown',email:'blocked@example.test'}}))
  assert.equal(state.user,null);assert.match(state.authError,/chưa được cấp quyền/)
 }finally{await act(async()=>tree?.unmount());globalThis.window=previous;delete globalThis.__currentAuth;delete globalThis.__nextAuth}
})
