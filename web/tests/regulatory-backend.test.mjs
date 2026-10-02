import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { queryWords, isNew, safeUrl, validateDocument } from '../../lib/regulatory/domain.js'
import { extractArticle, extractLinks, dateOf, hasOfficialNewsListing } from '../../lib/regulatory/parser.js'

test('discovers official news independently and keeps proposals distinct', () => {
  const source={id:'baochinhphu-health',url:'https://baochinhphu.vn/xa-hoi/y-te.htm',kind:'html'}
  assert.equal(safeUrl(source.url,true),source.url)
  assert.throws(()=>safeUrl('https://baochinhphu.vn.evil.test',true))
  const html='<h1>Đề xuất kê đơn thuốc ngoại trú tối đa 90 ngày</h1><meta property="article:published_time" content="2026-09-21T15:43:00+07:00"><div class="detail-sapo">Bộ Y tế lấy ý kiến dự thảo.</div><div class="detail-content"><p>Nội dung đề xuất chưa được ban hành.</p></div>'
  const row=extractArticle(html,'https://baochinhphu.vn/news.htm',source)
  assert.equal(row.legal_status,'draft'); assert.equal(row.published_at,'2026-09-21');assert.equal(row.issued_at,null)
  assert.match(row.summary,/chưa được ban hành/)
  assert.equal(extractLinks('<a href="/new-102260921153136421.htm">Đề xuất kê đơn thuốc ngoại trú tối đa 90 ngày</a>',source).length,1)
  assert.equal(hasOfficialNewsListing('<h1>Access denied</h1>',source),false)
})

test('search normalization, legal evidence, dates and URL boundaries', () => {
  assert.deepEqual(queryWords('TT 22/2024/TT-BYT'), ['22','2024','tt','byt'])
  assert.deepEqual(queryWords('dược chất BE'), ['duoc','chat','tuong','duong','sinh','hoc'])
  const now = Date.parse('2026-09-28T00:00:00+07:00')
  assert.equal(isNew({ issued_at: '2026-08-29' }, now), false)
  assert.equal(isNew({ issued_at: '2026-08-30' }, now), true)
  assert.equal(isNew({ issued_at: '2026-09-29' }, now), false)
  assert.equal(isNew({ fetched_at: '2026-09-28' }, now), false)
  for (const url of ['http://dav.gov.vn','https://dav.gov.vn.evil.test','https://127.0.0.1','https://dav.gov.vn:8000','https://x@dav.gov.vn']) assert.throws(() => safeUrl(url, true))
  assert.throws(() => validateDocument({ title:'Test', source_url:'https://dav.gov.vn/test', legal_status:'active' }), /đối chiếu/)
  assert.equal(dateOf('Mon, 28 Sep 2026 08:00:00 GMT'), '2026-09-28')
  assert.equal(dateOf('31/02/2026'), null)
})

test('parser separates issue/publication dates and never verifies effect', () => {
  const source = { id:'dav', url:'https://dav.gov.vn', kind:'html', keywords:'' }
  const html = '<meta property="og:title" content="Quyết định số 808/QĐ-QLD về danh mục thuốc"><div class="time-boxsearch">28/09/2026</div><div class="description"><p>Quyết định số 808/QĐ-QLD ngày 22/9/2026 về danh mục thuốc, căn cứ TT 40/2025 ngày 25/10/2025.</p><a href="/signed.pdf">Bản ký</a></div>'
  const row = extractArticle(html, 'https://dav.gov.vn/test', source)
  assert.equal(row.issued_at,'2026-09-22'); assert.equal(row.published_at,null)
  assert.equal(row.legal_status,'unknown'); assert.equal(row.reviewed_at,null)
  assert.equal(row.pdf_url,'https://dav.gov.vn/signed.pdf')
  assert.equal(row.code,'808/QĐ-QLD')
  const links = extractLinks('<a href="/test">Quyết định số 808/QĐ-QLD về danh mục thuốc</a><a href="https://evil.test/test">Quyết định về thuốc khác</a><a href="/x.pdf">Quyết định về danh mục thuốc mới</a>',source)
  assert.equal(links.length,1)
})

test('database enforces staff/admin/read isolation and preserves reviewed items during re-crawl', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
      grant usage on schema auth to authenticated,service_role;
      insert into auth.users values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');`)
    for (const name of ['20260928081206_regulatory_news_hub.sql','20260928082553_regulatory_manual_news.sql','20260928174406_regulatory_editorial_brief.sql']) await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`,import.meta.url),'utf8'))
    await db.exec(`insert into regulatory_sources(id,name,url) values('dav','DAV','https://dav.gov.vn');`)
    const row = { id:'test', title:'Thuốc test', code:'808/QĐ-QLD', category:'BE', summary:'test', source_id:'dav', source_url:'https://dav.gov.vn/test', legal_status:'active', content_hash:'fixture', search_text:'thuoc test 808 qd qld' }
    await db.query('select regulatory_ingest($1::jsonb)',[JSON.stringify(row)])
    assert.equal((await db.query('select legal_status from regulatory_documents')).rows[0].legal_status,'unknown')
    const login = async (email, id='00000000-0000-0000-0000-000000000001') => {
      await db.exec('reset role')
      await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({ email, sub:id })])
      await db.exec('set role authenticated')
    }
    await login('outsider@example.com')
    assert.equal((await db.query('select * from regulatory_documents')).rows.length,0)
    await login('sales@baoanpharma.com')
    assert.equal((await db.query('select * from regulatory_documents')).rows.length,1)
    assert.equal((await db.query("update regulatory_documents set title='bad' returning id")).rows.length,0)
    await assert.rejects(db.query("select regulatory_ingest('{}'::jsonb)"),/permission/)
    await assert.rejects(db.query('select regulatory_ai_reserve()'),/permission/)
    await db.exec("insert into regulatory_reads(user_id,document_id) values(auth.uid(),'test')")
    await login('importer@baoanpharma.com','00000000-0000-0000-0000-000000000002')
    assert.equal((await db.query('select * from regulatory_reads')).rows.length,0)
    await assert.rejects(db.exec("insert into regulatory_reads values('00000000-0000-0000-0000-000000000001','test',now())"),/row-level security/)
    await login('admin@baoanpharma.com')
    await db.exec("update regulatory_documents set title='Reviewed',origin='manual' where id='test'")
    assert.equal((await db.query('select * from regulatory_audit')).rows.length,1)
    assert.equal((await db.query('select regulatory_search(p_news=>true) as result')).rows[0].result.total,1)
    await db.exec('reset role')
    const day=(await db.query('select regulatory_ai_reserve() as day')).rows[0].day
    assert.ok(day)
    assert.equal((await db.query('select regulatory_ai_reserve() as day')).rows[0].day,null)
    assert.equal(Number((await db.query('select sum(reserved_usd) as reserved from regulatory_ai_runs')).rows[0].reserved),0.025)
    await db.query('select regulatory_ingest($1::jsonb)',[JSON.stringify(row)])
    assert.equal((await db.query('select title from regulatory_documents')).rows[0].title,'Reviewed')
    assert.equal((await db.query("select regulatory_claim('dav',true) as claimed")).rows[0].claimed,true)
    assert.equal((await db.query("select regulatory_claim('dav',true) as claimed")).rows[0].claimed,false)
    await db.exec('set role anon')
    await assert.rejects(db.query('select * from regulatory_documents'),/permission/)
  } finally { await db.close() }
})
