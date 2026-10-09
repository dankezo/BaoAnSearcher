import test from 'node:test'
import assert from 'node:assert/strict'
import {createClient} from '@libsql/client'
import {sdkFormsSql,sdkKeySql} from '../api-lib/db/sdkForms.js'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'

test('DAV form matching uses current and old SDK without multiplying VSS or guessing conflicting forms',async()=>{
 const db=createClient({url:'file::memory:'})
 try{
  await db.execute('CREATE TABLE dav_drugs (so_dang_ky TEXT,so_dang_ky_cu TEXT,dang_bao_che TEXT)')
  await db.execute("INSERT INTO dav_drugs VALUES ('NEW','OLD','Viên nén'),('NEW','OLD','Viên nén'),('CONFLICT','','Viên nén'),('CONFLICT','','Viên nang')")
  await db.execute('CREATE TABLE vss_bids (sodk TEXT,amount REAL)')
  await db.execute("INSERT INTO vss_bids VALUES ('new',10),(' OLD ',20),('CONFLICT',30),('UNKNOWN',40)")
  const {rows}=await db.execute(`SELECT vss_bids.*,forms.dav_form FROM vss_bids LEFT JOIN (${sdkFormsSql('turso')}) forms ON ${sdkKeySql('sodk','turso')}=forms.sdk_form_key ORDER BY amount`)
  assert.equal(rows.length,4);assert.deepEqual(rows.map(row=>row.dav_form),['Viên nén','Viên nén',null,null]);assert.equal(rows.reduce((sum,row)=>sum+row.amount,0),100)
 }finally{db.close()}
})

test('local analytics also resolves a missing VSS form through the old DAV registration',()=>{
 const folder=mkdtempSync(join(tmpdir(),'vss-form-fixture-'))
 try{
  execFileSync('python',['-m','tests.analytics_fixture',folder],{env:{...process.env,PYTHONUTF8:'1'}})
  execFileSync('python',['-X','utf8','-c',"import sqlite3,json,sys;from pathlib import Path;p=Path(sys.argv[1]);c=sqlite3.connect(p/'vss.sqlite3');r=json.loads(c.execute('SELECT raw FROM bids LIMIT 1').fetchone()[0]);r.pop('dangbaoche',None);r['sodk']='OLD-SDK';c.execute('UPDATE bids SET raw=?',(json.dumps(r,ensure_ascii=False),));c.commit();c.close();c=sqlite3.connect(p/'dav.sqlite3');rows=c.execute('SELECT id,raw FROM drugs').fetchall();[(r.update(soDangKyCu='OLD-SDK'),c.execute('UPDATE drugs SET raw=? WHERE id=?',(json.dumps(r,ensure_ascii=False),id))) for id,raw in rows for r in [json.loads(raw)]];c.commit();c.close()",folder])
  const result=JSON.parse(execFileSync('node',['scripts/analytics_local.mjs'],{input:JSON.stringify({action:'detail',body:{source:'vss',query:{mode:'drug',entity:'Ambroxol',start:'2026-02-01',end:'2026-03-31'}}}),encoding:'utf8',env:{...process.env,ANALYTICS_DB_DIR:folder},timeout:30000}))
  assert.equal(result.items.length,1);assert.equal(result.items[0].form,'Viên')
 }finally{rmSync(folder,{recursive:true,force:true})}
})
