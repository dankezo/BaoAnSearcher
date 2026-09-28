import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { build } from 'esbuild'
import Module from 'node:module'
import { fileURLToPath } from 'node:url'
const result = await build({
  entryPoints: [fileURLToPath(new URL('../src/services/davRpc.ts', import.meta.url))],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
})
const compiled = new Module('dav-rpc-test')
compiled._compile(result.outputFiles[0].text, 'dav-rpc-test.cjs')
const { buildDavRpcParams } = compiled.exports

test('DAV RPC normalizes blank/null/undefined values and numeric pagination', () => {
  const params = buildDavRpcParams(
    { q: '  Đau đầu ', tenThuoc: ' ', soDangKy: '', hoatChat: undefined, dangBaoChe: null, tags: [] },
    '2',
    '50',
  )
  assert.equal(params.p_q, 'dau dau')
  for (const key of ['p_ten_thuoc', 'p_so_dang_ky', 'p_hoat_chat', 'p_dang_bao_che'])
    assert.equal(params[key], null)
  assert.equal(params.p_page, 2)
  assert.equal(params.p_size, 50)
  assert.deepEqual(params.p_filters.tags, [])
  assert.equal(buildDavRpcParams({}, NaN, Infinity).p_size, 100)
  assert.equal(buildDavRpcParams({}, -4, 9000).p_page, 0)
  assert.equal(buildDavRpcParams({}, -4, 9000).p_size, 2000)
})

test('DAV migration: real PostgreSQL RPC, advanced filters, stable pagination, RLS and idempotency', async () => {
  const db = new PGlite({ extensions: { pg_trgm } })
  try {
    await db.exec('create role anon; create role authenticated;')
    const migration = await readFile(
      new URL('../../supabase/migrations/20260928030408_search_dav_drugs.sql', import.meta.url),
      'utf8',
    )
    await db.exec(migration)
    await db.exec(migration)
    await db.exec(`insert into public.dav_drugs(id, search, ten_thuoc, so_dang_ky, hoat_chat, dang_bao_che, ham_luong, nuoc_san_xuat, cty_san_xuat, ingredient_count, tag_id, ngay_cap) values
      ('1','thuoc a paracetamol','Thuốc A','VN-1','Paracetamol','Viên nén','500mg','Việt Nam','Alpha',1,'green','2026-01-01'),
      ('2','thuoc b paracetamol','Thuốc B','VN-2','Paracetamol','Sirô','100mg','Pháp','Beta',1,'gray','2026-01-01'),
      ('3','thuoc c amoxicillin','Thuốc C','VN-3','Amoxicillin','Viên nang','250mg','Việt Nam','Alpha',1,'green','2025-01-01');`)
    const query = async (params = {}) => {
      const p = { ...buildDavRpcParams(), ...params }
      const { rows } = await db.query(
        'select public.search_dav_drugs($1,$2,$3,$4,$5,$6,$7,$8) as result',
        Object.values(p),
      )
      return rows[0].result
    }
    const first = await query({ p_size: 1 })
    const second = await query({ p_size: 1, p_page: 1 })
    assert.equal(first.total, 3)
    assert.notEqual(first.items[0].id, second.items[0].id)
    assert.equal((await query({ p_ten_thuoc: 'thuoc a' })).total, 1)
    assert.equal((await query({ p_ten_thuoc: 'Paracetamol' })).total, 0)
    assert.equal((await query({ p_hoat_chat: 'para' })).total, 2)
    assert.equal((await query({ p_filters: { tags: [] } })).total, 0)
    assert.equal(
      (await query({ p_filters: { tags: ['green'], nuocSanXuat: ['Việt Nam'], sanXuat: 'Alpha' } })).total,
      2,
    )
    assert.equal(
      (await query({ p_filters: { dosageFormCount: '2', strengthCount: 'other', strengthCountOther: '2' } }))
        .total,
      2,
    )
    assert.equal((await query({ p_page: 99 })).items.length, 0)
    const legacy = await db.query('select public.search_dav_drugs(null,null,null,null,null,0,100) as result')
    assert.equal(legacy.rows[0].result.total, 3)
    await db.exec('set role authenticated')
    assert.equal((await query()).total, 3)
    await db.exec('reset role; set role anon')
    await assert.rejects(query(), /permission denied/)
  } finally {
    await db.close()
  }
})


test('cloud DAV detects static HTML, falls back to RPC and forwards normalized advanced filters', async () => {
  const fixture = await build({
    entryPoints: [fileURLToPath(new URL('../src/supabaseCloud.js', import.meta.url))],
    bundle: true, write: false, platform: 'node', format: 'cjs',
    plugins: [{ name: 'supabase-fixture', setup(build) {
      build.onResolve({ filter: /supabaseClient$/ }, () => ({ path: 'client', namespace: 'fixture' }))
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
        export const supabaseConfigured = true;
        export const getSupabase = () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'fixture-token' } } }) }, rpc: async (name, params) => {
          globalThis.__davRpc = { name, params };
          return { data: { total: 1, items: [{ id: '1', ten_thuoc: 'Thuốc thử', con_hieu_luc: true }] }, error: null };
        } });
      ` }))
    } }],
  })
  const module = new Module('dav-cloud-test')
  module._compile(fixture.outputFiles[0].text, 'dav-cloud-test.cjs')
  const original = global.fetch
  global.fetch = async () => ({ ok: true, text: async () => '<html>Static host</html>' })
  try {
    const data = await module.exports.cloudDavSearch({ filters: { tenThuoc: ' ', sanXuat: 'Alpha', tags: [] }, page: '2', size: '50' })
    assert.equal(global.__davRpc.name, 'search_dav_drugs')
    assert.equal(global.__davRpc.params.p_ten_thuoc, null)
    assert.equal(global.__davRpc.params.p_page, 2)
    assert.equal(global.__davRpc.params.p_size, 50)
    assert.deepEqual(global.__davRpc.params.p_filters.tags, [])
    assert.equal(data.items[0].tenThuoc, 'Thuốc thử')
    assert.equal(data.items[0].conHieuLuc, true)
  } finally { global.fetch = original; delete global.__davRpc }
})
