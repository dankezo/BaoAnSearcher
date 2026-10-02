import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { fold } from '../api-lib/turso.js'
import { buildSearchSql } from '../api-lib/db/searchSql.js'

const suite = JSON.parse(fs.readFileSync(new URL('../scripts/perf/queries.json', import.meta.url), 'utf8'))
const searches = suite.queries.filter((query) => query.op === 'search')

const FOLD_FIELDS = {
  hoatchat: 'hoatchat_f',
  ten_tinh: 'ten_tinh_f',
  hoatChat: 'hoat_chat_f',
  tenThuoc: 'ten_thuoc_f',
  name: 'name_f',
  ingredient: 'ingredient_f',
  province: 'province_f',
}

function placeholders(sql) {
  return (sql.match(/\?/g) || []).length
}

test('the suite still has 30 queries', () => {
  assert.equal(suite.queries.length, 30)
  assert.equal(searches.length, 26)
})

test('search keeps substring LIKE except indexed MSC ingredient prefix', () => {
  for (const query of searches) {
    for (const dialect of ['turso', 'tidb']) {
      const built = buildSearchSql({
        kind: query.kind,
        filters: query.filters,
        page: query.page || 0,
        size: query.size || 100,
        dialect,
      })
      assert.equal(built.empty, false, query.id)
      assert.equal(placeholders(built.sql), built.args.length, `${query.id} ${dialect} sql`)
      assert.equal(placeholders(built.countSql), built.countArgs.length, `${query.id} ${dialect} count`)
      assert.match(built.countSql, /COUNT\(\*\) AS total/)
      assert.doesNotMatch(built.sql, /MATCH\s+AGAINST/i)
      assert.doesNotMatch(built.countSql, /LIMIT/)
      const words = fold(query.filters.q || '').split(/\s+/).filter(Boolean)
      for (const word of words) {
        assert.ok(built.args.includes(`%${word}%`), `${query.id} ${dialect} %${word}%`)
        assert.match(built.sql, /search LIKE \?/)
      }
      for (const [field, column] of Object.entries(FOLD_FIELDS)) {
        const value = query.filters[field]
        if (value == null || value === '') continue
        if (dialect === 'tidb') {
          assert.match(built.sql, new RegExp(`${column} LIKE \\?`), `${query.id} ${column}`)
          const expected = column === 'ingredient_f' ? `${fold(value).trim()}%` : `%${fold(value)}%`
          assert.ok(built.args.includes(expected), `${query.id} ${column}`)
          if (column === 'ingredient_f') {
            assert.match(built.sql, /USE_INDEX\(msc_prices, idx_msc_prices_ingredient_f\)/)
            assert.doesNotMatch(built.sql, /OFFSET/)
          }
          assert.doesNotMatch(built.sql, new RegExp(`(?<!_)${field === 'hoatChat' ? 'hoat_chat' : field} LIKE`))
        } else {
          assert.doesNotMatch(built.sql, new RegExp(`${column} LIKE`))
          assert.ok(built.args.includes(`%${value}%`), `${query.id} turso raw ${field}`)
        }
      }
    }
  }
})

test('cillin and uroxim needles stay inside the word', () => {
  for (const id of ['vss-substring-cillin', 'dav-substring-cillin', 'msc-prices-substring']) {
    const query = searches.find((item) => item.id === id)
    const built = buildSearchSql({ kind: query.kind, filters: query.filters, dialect: 'tidb' })
    assert.ok(built.args.includes('%cillin%'))
  }
  const uroxim = searches.find((item) => item.id === 'vss-substring-uroxim')
  const built = buildSearchSql({ kind: 'vss', filters: uroxim.filters, dialect: 'tidb' })
  assert.ok(built.args.includes('%uroxim%'))
})
