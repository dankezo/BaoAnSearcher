import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
test('preset RLS: isolated owners, forbidden reassignment and anonymous access',async()=>{
 const db=new PGlite()
 try{
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated; INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');`)
  await db.exec(await readFile(new URL('../../supabase/migrations/20261007000100_analytics_presets.sql',import.meta.url),'utf8'))
  await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001'; INSERT INTO public.user_saved_filters(name,configuration) VALUES('A','{"mode":"drug"}');`)
  assert.equal((await db.query('SELECT * FROM public.user_saved_filters')).rows.length,1)
  await assert.rejects(db.exec(`UPDATE public.user_saved_filters SET user_id='00000000-0000-0000-0000-000000000002'`))
  await db.exec(`SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';`)
  assert.equal((await db.query('SELECT * FROM public.user_saved_filters')).rows.length,0)
  await db.exec(`INSERT INTO public.user_saved_filters(name,configuration) VALUES('B','{}'); UPDATE public.user_saved_filters SET name='B2';`)
  assert.equal((await db.query('SELECT name FROM public.user_saved_filters')).rows[0].name,'B2')
  await db.exec(`DELETE FROM public.user_saved_filters; SET ROLE anon;`)
  await assert.rejects(db.query('SELECT * FROM public.user_saved_filters'))
 }finally{await db.close()}
})
