import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
import {build} from 'esbuild'
import Module from 'node:module'
import {fileURLToPath} from 'node:url'
const dir=fileURLToPath(new URL('..',import.meta.url))
const built=await build({entryPoints:[`${dir}/src/savedResultStore.js`],bundle:true,write:false,platform:'node',format:'cjs',define:{'import.meta.env':'{}'}})
const compiled=new Module(`${dir}/tests/saved-results.cjs`);compiled.paths=Module._nodeModulePaths(dir);compiled._compile(built.outputFiles[0].text,'saved-results.cjs')
const {tableSnapshot,tenderSnapshot,validateSnapshot,savedPrintHtml}=compiled.exports

test('saved table retains full rows, numeric totals, SDK as text and export formatting without functions',()=>{
 const rows=[{sdk:'0590110425723',amount:6570134000,day:'2026-10-01',extra:'Tên CSYT'}]
 const snapshot=tableSnapshot('VSS',[{key:'sdk',label:'SĐK'},{key:'amount',label:'Thành tiền',width:160,align:'right',numeric:true,sum:true,exportValue:r=>r.amount},{key:'day',label:'Ngày',text:r=>r.day.split('-').reverse().join('/')}],rows,{start:'2025-06-01',end:'2026-10-01'})
 assert.equal(validateSnapshot(snapshot),snapshot)
 assert.equal(snapshot.columns[1].width,160);assert.equal(snapshot.columns[1].align,'right');assert.equal(snapshot.columns[1].numeric,true);assert.equal(snapshot.columns[1].sum,true)
 assert.equal(snapshot.rows[0].sdk,'0590110425723');assert.equal(snapshot.rows[0].amount,6570134000);assert.equal(snapshot.rows[0].extra,'Tên CSYT');assert.equal(snapshot.rows[0].day,'01/10/2026')
 assert.deepEqual(JSON.parse(JSON.stringify(snapshot)),snapshot)
 assert.throws(()=>validateSnapshot({...snapshot,rows:[]}),/Không có/)
 assert.throws(()=>validateSnapshot({...snapshot,rows:Array(50001).fill(rows[0])}),/quá lớn/)
 const html=savedPrintHtml({name:'<script>bad()</script>',source:'vss',created_at:'2026-10-11T00:00:00Z',snapshot:{...snapshot,rows:[{sdk:'<img src=x onerror=bad()>',amount:6570134000}]}})
 assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.match(html,/6\.570\.134\.000/);assert.match(html,/2025-06-01/)
})
test('saved BHYT retains products and every historical source line',()=>{
 const product={regNumber:'001',quantity:5,packages:[{id:'line-1'},{id:'line-2'}]}
 const block={query:{start:'2025-06-01'},rows:[{children:[product],ingredient:'X',unit:'Viên',productCount:1}]}
 const snapshot=tenderSnapshot([block]);assert.equal(snapshot.rows.length,1);assert.equal(snapshot.blocks[0].rows[0].children[0].packages.length,2)
})
test('saved result RLS allows owner CRUD and denies another owner, reassignment, malformed data and anonymous access',async()=>{
 const db=new PGlite()
 try{
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated; INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');`)
  await db.exec(await readFile(new URL('../../supabase/migrations/20261011123109_account_saved_results.sql',import.meta.url),'utf8'))
  await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001'; INSERT INTO public.user_saved_results(name,source,row_count,snapshot) VALUES('A','vss',1,'{"version":1,"rows":[{"sdk":"001"}]}');`)
  assert.equal((await db.query('SELECT * FROM public.user_saved_results')).rows.length,1)
  await assert.rejects(db.exec(`UPDATE public.user_saved_results SET user_id='00000000-0000-0000-0000-000000000002'`))
  await assert.rejects(db.exec(`INSERT INTO public.user_saved_results(user_id,name,source,row_count,snapshot) VALUES('00000000-0000-0000-0000-000000000002','B','vss',1,'{"version":1,"rows":[{}]}')`))
  await assert.rejects(db.exec(`INSERT INTO public.user_saved_results(name,source,row_count,snapshot) VALUES('Empty','vss',1,'{}')`))
  await assert.rejects(db.exec(`INSERT INTO public.user_saved_results(name,source,row_count,snapshot) VALUES('Mismatch','vss',2,'{"version":1,"rows":[{}]}')`))
  await db.exec(`SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'`)
  assert.equal((await db.query('SELECT * FROM public.user_saved_results')).rows.length,0)
  await db.exec('DELETE FROM public.user_saved_results')
  await db.exec(`SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001'`)
  assert.equal((await db.query('SELECT * FROM public.user_saved_results')).rows.length,1)
  await db.exec('DELETE FROM public.user_saved_results')
  assert.equal((await db.query('SELECT * FROM public.user_saved_results')).rows.length,0)
  await db.exec('SET ROLE anon');await assert.rejects(db.query('SELECT * FROM public.user_saved_results'))
 }finally{await db.close()}
})
