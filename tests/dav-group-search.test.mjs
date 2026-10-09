import test from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@libsql/client'
import { buildSearchSql } from '../api-lib/db/searchSql.js'

test('DAV page and count filter by observed groups on current or old registration', async () => {
  const db = createClient({ url: 'file::memory:' })
  try {
    await db.execute('CREATE TABLE dav_drugs (id INTEGER, so_dang_ky TEXT, so_dang_ky_cu TEXT, ngay_cap TEXT, ngay_gia_han TEXT)')
    await db.execute("INSERT INTO dav_drugs VALUES (1, 'NEW', 'OLD', '2026-09-01', NULL), (2, 'OTHER', '', '2026-08-01', NULL)")
    await db.execute('CREATE TABLE vss_bids (sodk TEXT, nhomthau TEXT)')
    await db.execute("INSERT INTO vss_bids VALUES ('OLD', 'N3'), ('OLD', 'N4'), ('OTHER', 'N13')")
    const built = buildSearchSql({ kind: 'dav', filters: { tenderGroup: ['Nhóm 3'] }, dialect: 'turso', size: 10 })
    const page = await db.execute({ sql: built.sql, args: built.args })
    const count = await db.execute({ sql: built.countSql, args: built.countArgs })
    assert.equal(page.rows.length, 1)
    assert.equal(page.rows[0].so_dang_ky, 'NEW')
    assert.equal(page.rows[0].tender_group, 'N3,N4')
    assert.equal(count.rows[0].total, 1)
    const other = buildSearchSql({ kind: 'dav', filters: { tenderGroup: ['Nhóm 1'] }, dialect: 'turso' })
    assert.equal((await db.execute({ sql: other.sql, args: other.args })).rows.length, 0)
  } finally { db.close() }
})
