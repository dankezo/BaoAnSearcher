import { MODEL } from './brief.js'

const PROVIDERS = [
  { name:'gemini', key:'GEMINI_API_KEY' },
  { name:'groq', key:'GROQ_API_KEY' },
  { name:'openrouter', key:'OPENROUTER_API_KEY' }
]

const modelFor = (name, env) => name==='gemini'
  ? env.GEMINI_DAILY_MODEL || env.GEMINI_MODEL || MODEL
  : name==='groq' ? env.GROQ_MODEL || 'openai/gpt-oss-120b' : env.OPENROUTER_MODEL || 'openrouter/free'

function requestFor(provider, {system,payload,geminiBody,model,key}) {
  if (provider==='gemini') return {
    url:`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    headers:{'Content-Type':'application/json','x-goog-api-key':key},
    body:JSON.stringify(geminiBody || {systemInstruction:{parts:[{text:system}]},contents:[{role:'user',parts:[{text:JSON.stringify(payload)}]}],generationConfig:{responseMimeType:'application/json',temperature:0.1,maxOutputTokens:4096}})
  }
  const base=provider==='groq'?'https://api.groq.com/openai/v1/chat/completions':'https://openrouter.ai/api/v1/chat/completions'
  return {url:base,headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify({model,messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(payload)}],response_format:{type:'json_object'},temperature:0.1,max_tokens:4096})}
}

function unpack(provider,result) {
  if (provider==='gemini') {
    const candidate=result.candidates?.[0]
    if(candidate?.finishReason!=='STOP') throw new Error('incomplete')
    return {value:JSON.parse(candidate.content?.parts?.filter(p=>!p.thought).map(p=>p.text||'').join('')||''),usage:{input:result.usageMetadata?.promptTokenCount||0,output:(result.usageMetadata?.candidatesTokenCount||0)+(result.usageMetadata?.thoughtsTokenCount||0)}}
  }
  const message=result.choices?.[0]?.message
  if(!message?.content || result.choices?.[0]?.finish_reason!=='stop') throw new Error('incomplete')
  return {value:JSON.parse(message.content),usage:{input:result.usage?.prompt_tokens||0,output:result.usage?.completion_tokens||0}}
}

// Attempts are sequential and share one hard deadline; provider errors never leave this server.
export async function jsonAnalysis({system,payload,validate,geminiBody,fetchImpl=fetch,deadline=30000,attemptMs=11000,preferredProvider,env=process.env}) {
  const started=Date.now(), budget=Math.min(35000,Math.max(1,Number(deadline)||30000))
  for(const provider of [...PROVIDERS].sort((a,b)=>Number(b.name===preferredProvider)-Number(a.name===preferredProvider))) {
    const key=env[provider.key]
    if(!key) continue
    const model=modelFor(provider.name,env), remaining=budget-(Date.now()-started)
    if(remaining<=0) break
    try {
      const request=requestFor(provider.name,{system,payload,geminiBody,model,key})
      const response=await fetchImpl(request.url,{method:'POST',headers:request.headers,body:request.body,signal:AbortSignal.timeout(Math.min(Math.max(1,Math.min(20000,Number(attemptMs)||11000)),remaining))})
      if(!response.ok) continue
      const parsed=unpack(provider.name,await response.json())
      const value=validate?validate(parsed.value,{provider:provider.name,model}):parsed.value
      return {value,provider:provider.name,model,usage:parsed.usage}
    } catch { /* Malformed or rejected output falls through without exposing provider details. */ }
  }
  return null
}
