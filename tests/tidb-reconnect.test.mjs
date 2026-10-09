import {test} from 'node:test'
import assert from 'node:assert/strict'

test('expired TiDB sessions reconnect for SELECT once; writes and other errors are not replayed',async()=>{
 const originalFetch=globalThis.fetch,originalUrl=process.env.TIDB_DATABASE_URL
 const calls=[];let failCode=null
 process.env.TIDB_DATABASE_URL='mysql://fixture:fixture@fixture.example/fixture'
 globalThis.fetch=async(_url,options)=>{
  calls.push({session:options.headers['TiDB-Session'],sql:JSON.parse(options.body).query})
  if(failCode){const code=failCode;failCode=null;return new Response(JSON.stringify({code,message:'fixture error'}),{status:400})}
  return new Response(JSON.stringify({types:[{name:'n',type:'INT'}],rows:[['1']]}),{headers:{'TiDB-Session':'fixture-session'}})
 }
 try{
  const {query}=await import('../api-lib/db/tidb.js')
  assert.equal((await query('SELECT 1 AS n')).rows[0].n,1)
  failCode=61100002
  assert.equal((await query('SELECT 2 AS n')).rows[0].n,1)
  assert.deepEqual(calls.slice(-2).map(call=>call.session),['fixture-session',''])
  const before=calls.length;failCode=61100002
  await assert.rejects(query('UPDATE fixture SET n=2'));assert.equal(calls.length,before+1)
  failCode=12345;await assert.rejects(query('SELECT 3 AS n'));assert.equal(calls.length,before+2)
 }finally{globalThis.fetch=originalFetch;if(originalUrl===undefined)delete process.env.TIDB_DATABASE_URL;else process.env.TIDB_DATABASE_URL=originalUrl}
})
