import {test} from 'node:test'
import assert from 'node:assert/strict'
import {jsonAnalysis} from '../../lib/regulatory/providers.js'
import {validateAnalysis} from '../../lib/regulatory/ai.js'

const success=(provider,value={ok:true})=>provider==='gemini'
  ? {candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(value)}]}}],usageMetadata:{promptTokenCount:2,candidatesTokenCount:3}}
  : {choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:2,completion_tokens:3}}
const response=(body,ok=true)=>({ok,json:async()=>body})

test('skips unconfigured Gemini and uses Groq with bounded JSON request and hidden credentials',async()=>{
  let call
  const result=await jsonAnalysis({system:'policy',payload:{id:'safe'},env:{GROQ_API_KEY:'groq-secret'},fetchImpl:async(url,init)=>{call={url,init};return response(success('groq'))}})
  assert.equal(result.provider,'groq');assert.equal(result.model,'openai/gpt-oss-120b');assert.deepEqual(result.value,{ok:true});assert.deepEqual(result.usage,{input:2,output:3})
  assert.equal(call.url,'https://api.groq.com/openai/v1/chat/completions');assert.equal(call.init.headers.Authorization,'Bearer groq-secret')
  assert.ok(!call.url.includes('groq-secret'));assert.ok(!call.init.body.includes('groq-secret'))
  const body=JSON.parse(call.init.body);assert.equal(body.response_format.type,'json_object');assert.ok(body.model);assert.ok(Number.isInteger(body.max_tokens)&&body.max_tokens>0&&body.max_tokens<=4096);assert.ok(call.init.signal instanceof AbortSignal)
})

test('falls through malformed JSON, unfinished output, and caller validation rejection',async()=>{
  for(const invalid of [
    {candidates:[{finishReason:'STOP',content:{parts:[{text:'not json'}]}}]},
    {candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'{}'}]}}]},
    success('gemini',{id:'invented'})
  ]) {
    let calls=0
    const result=await jsonAnalysis({system:'s',payload:{},env:{GEMINI_API_KEY:'g',GROQ_API_KEY:'r'},validate:value=>{if(value.id)throw Error('private validation detail');return value},fetchImpl:async(url)=>{calls++;return response(url.includes('generativelanguage')?invalid:success('groq'))}})
    assert.equal(result.provider,'groq');assert.equal(calls,2)
  }
})

test('rejects invented evidence with the real analysis validator before falling back',async()=>{
  const doc={id:'d1',title:'Danh mục thuốc đáp ứng quy định đấu thầu',summary:'Bộ Y tế công bố danh mục thuốc để kiểm tra hồ sơ đấu thầu.',legal_status:'unknown',code:'808/QĐ-QLD'}
  const item={id:'d1',priority:80,reason:'Liên quan danh mục đấu thầu.',impact:'Có thể cần đối chiếu hồ sơ.',action:'Kiểm tra bản gốc.',evidence_quote:'Danh mục thuốc đáp ứng'}
  assert.throws(()=>validateAnalysis({items:[{...item,evidence_quote:'Trích dẫn không có trong bài'}]},[doc]),/trích dẫn/i)
  const calls=[]
  const result=await jsonAnalysis({system:'s',payload:[doc],env:{GEMINI_API_KEY:'g',GROQ_API_KEY:'r'},validate:value=>validateAnalysis(value,[doc]),fetchImpl:async url=>{calls.push(url);return response(url.includes('generativelanguage')?success('gemini',{items:[{...item,evidence_quote:'Trích dẫn không có trong bài'}]}):success('groq',{items:[item]}))}})
  assert.equal(result.provider,'groq');assert.equal(result.value[0].method,'ai');assert.equal(calls.length,2)
})

test('falls from Groq to OpenRouter and emits no credential or provider error',async()=>{
  const calls=[]
  const result=await jsonAnalysis({system:'s',payload:{},env:{GROQ_API_KEY:'groq-secret',OPENROUTER_API_KEY:'router-secret'},fetchImpl:async(url,init)=>{calls.push({url,init});if(url.includes('groq'))throw Error('groq-secret private error');return response(success('router'))}})
  assert.equal(result.provider,'openrouter');assert.equal(calls.length,2);assert.ok(calls[1].url.startsWith('https://openrouter.ai/api/'))
  for(const call of calls){assert.ok(!call.url.includes('secret'));assert.ok(!call.init.body.includes('secret'))}
})

test('returns null after all configured providers fail and when no keys are configured',async()=>{
  let calls=0
  assert.equal(await jsonAnalysis({system:'s',payload:{},env:{},fetchImpl:async()=>{calls++}}),null);assert.equal(calls,0)
  assert.equal(await jsonAnalysis({system:'s',payload:{},env:{GEMINI_API_KEY:'g',GROQ_API_KEY:'r',OPENROUTER_API_KEY:'o'},fetchImpl:async()=>{calls++;return response({},false)}}),null);assert.equal(calls,3)
})

test('respects model overrides and caps each provider timeout and the total deadline',async()=>{
  const calls=[],timeouts=[],original=AbortSignal.timeout
  AbortSignal.timeout=ms=>{timeouts.push(ms);return original(ms)}
  try { await jsonAnalysis({system:'s',payload:{},deadline:60000,env:{GEMINI_API_KEY:'g',GEMINI_DAILY_MODEL:'gemini-test',GROQ_API_KEY:'r',GROQ_MODEL:'groq-test',OPENROUTER_API_KEY:'o',OPENROUTER_MODEL:'router-test'},fetchImpl:async(url,init)=>{calls.push({url,init});return response({},false)}}) }
  finally { AbortSignal.timeout=original }
  assert.equal(calls.length,3)
  assert.ok(calls[0].url.includes('/gemini-test:'))
  assert.equal(JSON.parse(calls[1].init.body).model,'groq-test');assert.equal(JSON.parse(calls[2].init.body).model,'router-test')
  for(const call of calls) assert.ok(call.init.signal instanceof AbortSignal)
  assert.deepEqual(timeouts,[11000,11000,11000])
})

test('stops provider attempts once the total caller deadline expires',async()=>{
  const calls=[]
  await jsonAnalysis({system:'s',payload:{},deadline:1,env:{GEMINI_API_KEY:'g',GROQ_API_KEY:'r',OPENROUTER_API_KEY:'o'},fetchImpl:async(url,init)=>{calls.push({url,init});await new Promise(resolve=>setTimeout(resolve,4));return response({},false)}})
  assert.equal(calls.length,1);assert.ok(calls[0].init.signal instanceof AbortSignal)
})


test('analytics may prefer the faster configured provider while the normal order remains Gemini first',async()=>{
 const calls=[]
 const env={GEMINI_API_KEY:'g',GROQ_API_KEY:'r'}
 const result=await jsonAnalysis({system:'s',payload:{},env,preferredProvider:'groq',fetchImpl:async url=>{calls.push(url);return response(success('groq'))}})
 assert.equal(result.provider,'groq');assert.equal(calls.length,1);assert.ok(calls[0].includes('api.groq.com'))
 const normal=await jsonAnalysis({system:'s',payload:{},env,fetchImpl:async url=>response(success(url.includes('generativelanguage')?'gemini':'groq'))})
 assert.equal(normal.provider,'gemini')
})
