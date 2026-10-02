import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSearchSql } from '../api-lib/db/searchSql.js'
import { packageMatchFromLines } from '../api-lib/scopeMatch.js'

function placeholders(sql) {
  return (sql.match(/\?/g) || []).length
}

test('substring cillin stays LIKE on the folded search column', () => {
  for (const dialect of ['turso', 'tidb']) {
    const built = buildSearchSql({
      kind: 'vss',
      filters: { q: 'cillin', loai: 'Tân dược' },
      dialect,
    })
    assert.match(built.sql, /search LIKE \?/)
    assert.ok(built.args.includes('%cillin%'))
    assert.match(built.sql, /loai = \?/)
    assert.ok(built.args.includes('Tân dược'))
    assert.equal(placeholders(built.sql), built.args.length)
    assert.match(built.sql, /OFFSET/)
    assert.match(built.countSql, /COUNT\(\*\) AS total/)
    assert.doesNotMatch(built.countSql, /LIMIT/)
    assert.equal(placeholders(built.countSql), built.countArgs.length)
  }
})

test('TiDB folds field filters onto *_f columns and Turso does not', () => {
  const tidb = buildSearchSql({
    kind: 'vss',
    filters: { hoatchat: 'Amoxicillin' },
    dialect: 'tidb',
  })
  assert.match(tidb.sql, /hoatchat_f LIKE \?/)
  assert.ok(tidb.args.includes('%amoxicillin%'))

  const turso = buildSearchSql({
    kind: 'vss',
    filters: { hoatchat: 'Amoxicillin' },
    dialect: 'turso',
  })
  assert.match(turso.sql, /(?<!_)hoatchat LIKE \?/)
  assert.ok(turso.args.includes('%Amoxicillin%'))
  assert.doesNotMatch(turso.sql, /hoatchat_f/)
})

test('a usable cursor drops OFFSET and follows each dialect null order', () => {
  const cursor = { tungay_hd: '2024-01-01', fingerprint: 'abc' }
  const turso = buildSearchSql({ kind: 'vss', filters: { q: 'uroxim' }, cursor, dialect: 'turso' })
  assert.doesNotMatch(turso.sql, /OFFSET/)
  assert.match(turso.sql, /tungay_hd IS NOT NULL/)
  assert.equal(placeholders(turso.sql), turso.args.length)
  assert.ok(turso.args.includes('%uroxim%'))

  const tidb = buildSearchSql({ kind: 'vss', filters: {}, cursor, dialect: 'tidb' })
  assert.doesNotMatch(tidb.sql, /OFFSET/)
  assert.match(tidb.sql, /OR tungay_hd IS NULL/)
  assert.equal(placeholders(tidb.sql), tidb.args.length)

  const missing = buildSearchSql({
    kind: 'vss',
    filters: {},
    cursor: { tungay_hd: '', fingerprint: 'abc' },
    dialect: 'turso',
  })
  assert.match(missing.sql, /OFFSET/)
})

test('an empty DAV tag list returns no rows', () => {
  const built = buildSearchSql({ kind: 'dav', filters: { tags: [] }, dialect: 'tidb' })
  assert.equal(built.empty, true)
})

test('tender label is derived from displayed line matches, not a stale crawl label', () => {
  // The cache may say exact from an earlier catalogue version.  A green
  // package is valid only when at least one line remains exact right now.
  assert.equal(packageMatchFromLines([{ match: 'near' }, { match: 'near' }]), 'near')
  assert.equal(packageMatchFromLines([{ match: '' }, { match: 'exact' }, { match: 'near' }]), 'exact')
  assert.equal(packageMatchFromLines([{ match: '' }]), '')
})
