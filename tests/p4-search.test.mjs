import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSearchSql } from '../api-lib/db/searchSql.js'
import { packageMatchFromLines } from '../api-lib/scopeMatch.js'
import { classifyLot } from '../lib/regulatory/baoanMatch.js'

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

test('DAV group and SĐK-density filters use materialized columns', () => {
  const built = buildSearchSql({
    kind: 'dav',
    filters: { drugGroup: ['Thuốc kê đơn'], ingredientCount: '2' },
    dialect: 'tidb',
  })
  assert.match(built.sql, /drug_group_f LIKE \?/)
  assert.match(built.sql, /registration_count = \?/)
  assert.ok(built.args.includes('%thuoc ke don%'))
  assert.ok(built.args.includes(2))
  assert.equal(placeholders(built.sql), built.args.length)
})

test('DAV SĐK-density ranges stay materialized', () => {
  const built = buildSearchSql({ kind: 'dav', filters: { ingredientCount: '1-2' }, dialect: 'tidb' })
  assert.match(built.sql, /registration_count BETWEEN \? AND \?/)
  assert.deepEqual(built.args, [1, 2])
})

test('tender label is derived from displayed line matches, not a stale crawl label', () => {
  // The cache may say exact from an earlier catalogue version.  A green
  // package is valid only when at least one line remains exact right now.
  assert.equal(packageMatchFromLines([{ match: 'near' }, { match: 'near' }]), 'near')
  assert.equal(packageMatchFromLines([{ match: '' }, { match: 'exact' }, { match: 'near' }]), 'exact')
  assert.equal(packageMatchFromLines([{ match: '' }]), '')
})

test('current legal rule accepts Fenofibrat/Fenofibrate generic tablet eligibility', () => {
  const result = classifyLot(
    { tenHoatChat: 'Fenofibrate', nongDo: '145 mg', dangBaoChe: 'Viên', duongDung: 'Uống' },
    [{ brand_name: 'Fenoba', inn: 'Fenofibrat', strength: '145 mg', dosage_form: 'Viên nén bao phim', route: 'Uống' }],
  )
  assert.equal(result.status, 'MATCH')
  assert.equal(result.level, 'exact')
  assert.equal(result.matchedCriteria.route, true)
  assert.equal(result.formCompatible, true)
})

test('a supplied conflicting route never becomes an eligible match', () => {
  const result = classifyLot(
    { tenHoatChat: 'Fenofibrate', nongDo: '145mg', dangBaoChe: 'Viên', duongDung: 'Tiêm' },
    [{ inn: 'Fenofibrat', strength: '0.145 g', dosage_form: 'Viên nén bao phim', route: 'Uống' }],
  )
  assert.equal(result.status, 'MISMATCH')
  assert.equal(result.matchedCriteria.route, false)
})

test('special-release forms are review-only instead of silently green', () => {
  const result = classifyLot(
    { tenHoatChat: 'Metformin', nongDo: '1000mg', dangBaoChe: 'Viên nén', duongDung: 'Uống' },
    [{ inn: 'Metformin', strength: '1000mg', dosage_form: 'Viên giải phóng kéo dài', route: 'Uống' }],
  )
  assert.equal(result.status, 'POTENTIAL')
  assert.equal(result.level, 'near')
})

test('ingredient comparison uses whole tokens, never a substring', () => {
  const result = classifyLot(
    { lotName: 'Ciprofloxacin', nongDo: '300mg', dangBaoChe: 'Viên', duongDung: 'Uống' },
    [{ inn: 'Ofloxacin', strength: '300mg', dosage_form: 'Viên nén bao phim', route: 'Uống' }],
  )
  assert.equal(result.status, 'MISMATCH')
  assert.equal(result.matchedCriteria.ingredient, false)
})

test('a declared salt form still matches its named base ingredient', () => {
  const result = classifyLot(
    { lotName: 'Ciprofloxacin (dưới dạng Ciprofloxacin hydrochloride)', nongDo: '500mg', dangBaoChe: 'Viên', duongDung: 'Uống' },
    [{ inn: 'Ciprofloxacin', strength: '500mg', dosage_form: 'Viên nén bao phim', route: 'Uống' }],
  )
  assert.equal(result.status, 'MATCH')
})

test('same ingredient with a supplied non-route difference stays yellow for HSMT review', () => {
  const result = classifyLot(
    { lotName: 'Fenofibrat', nongDo: '160mg', dangBaoChe: 'Viên', duongDung: 'Uống' },
    [{ inn: 'Fenofibrate', strength: '145mg', dosage_form: 'Viên nén bao phim', route: 'Uống' }],
  )
  assert.equal(result.status, 'POTENTIAL')
  assert.equal(result.level, 'near')
  assert.equal(result.matchedCriteria.strength, false)
})
