import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('legacy VSS RPC date migration aligns counts and rows with contract start, and can run twice',async()=>{
  const db=new PGlite()
  try{
    const init=await readFile(new URL('../../supabase/migrations/001_init.sql',import.meta.url),'utf8')
    const table=init.indexOf('create table if not exists public.vss_bids')
    const rpc=init.indexOf('create or replace function public.search_vss_bids')
    await db.exec(init.slice(table,init.indexOf(');',table)+2))
    await db.exec(init.slice(rpc,init.indexOf('$$;',rpc)+3))
    for(const [id,start,end] of [['missing',null,'2025-01-01'],['early','2025-05-31','2027-01-01'],['start','2025-06-01','2027-01-01'],['end','2026-10-01 23:59:59.999','2027-01-01'],['late','2026-10-02','2026-10-03']])
      await db.query('insert into vss_bids(fingerprint,tungay_hd,denngay_hd) values($1,$2,$3)',[id,start,end])
    const migration=await readFile(new URL('../../supabase/migrations/20261009000100_vss_contract_start_window.sql',import.meta.url),'utf8')
    await db.exec(migration);await db.exec(migration)
    const get=async(start,page=0,size=100)=>(await db.query('select search_vss_bids(p_tu_ngay=>$1,p_den_ngay=>$2,p_page=>$3,p_size=>$4) as result',[start,'2026-10-01',page,size])).rows[0].result
    const ranged=await get('2025-06-01')
    assert.equal(ranged.total,2);assert.equal(ranged.items.length,2)
    assert.deepEqual(ranged.items.map(item=>item.tungay_hd),['2026-10-01 23:59:59.999','2025-06-01'])
    assert.equal((await get(null)).total,3)
    const page=await get('2025-06-01',1,1)
    assert.equal(page.total,2);assert.equal(page.items.length,1);assert.equal(page.items[0].tungay_hd,'2025-06-01')
  }finally{await db.close()}
})
