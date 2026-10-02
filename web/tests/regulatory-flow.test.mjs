import assert from 'node:assert/strict'
import { test } from 'node:test'
import Module, { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { create, act } from 'react-test-renderer'
const dir = fileURLToPath(new URL('..', import.meta.url))
const bundle = await build({ entryPoints: [`${dir}/src/RegulatoryHub.jsx`], bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react'], define: { 'import.meta.env': '{"BASE_URL":"/"}' }, loader: { '.css': 'empty' }, plugins: [{ name: 'cloud-fixture', setup(b) {
  b.onResolve({ filter: /supabaseCloud$/ }, () => ({ path: 'cloud', namespace: 'fixture' }))
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const cloudDavSearch = p => globalThis.searchFixture(p); export const cloudMscSearch = cloudDavSearch; export const cloudVssSearch = cloudDavSearch;' }))
} }] })
const compiled = new Module(fileURLToPath(new URL('./regulatory-flow.cjs', import.meta.url)))
compiled.paths = Module._nodeModulePaths(dir)
compiled._compile(bundle.outputFiles[0].text, 'regulatory-flow.cjs')
const Hub = compiled.exports.default
const wait = ms => new Promise(r => setTimeout(r, ms))
test('Hub filters catalogs, queries the connected source, paginates and surfaces errors', async () => {
  const previousFetch = global.fetch
  global.fetch = async () => ({ ok: true, json: async () => [{ stt: 1, hoatChat: 'Metformin', hamLuong: '500mg', dangBaoChe: 'Viên' }] })
  const requests = []
  global.searchFixture = async p => { requests.push(p); return { total: 26, items: [{ tenThuoc: 'Metformin test', soDangKy: 'TEST-01' }] } }
  let root
  const content = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(content).join('') : node?.props ? content(node.props.children) : ''
  const button = text => root.root.findAllByType('button').find(b => content(b.props.children).includes(text))
  try {
    await act(async () => { root = create(React.createElement(Hub, { localMode: false })); await wait(5) })
    await act(async () => button('Hoạt chất BE').props.onClick())
    assert.equal(root.root.findAllByType('tbody')[0].findAllByType('tr').length, 26)
    await act(async () => root.root.findByType('input').props.onChange({ target: { value: 'metformin' } }))
    assert.equal(root.root.findAllByType('tbody')[0].findAllByType('tr').length, 1)
    await act(async () => button('Metformin').props.onClick())
    await act(async () => { await wait(400) })
    assert.equal(requests.at(-1).filters.q, 'Metformin')
    assert.equal(requests.at(-1).page, 0)
    assert.match(JSON.stringify(root.toJSON()), /TEST-01/)
    await act(async () => button('Sau').props.onClick())
    await act(async () => { await wait(400) })
    assert.equal(requests.at(-1).page, 1)
    global.searchFixture = async () => { throw new Error('Nguồn đang mất kết nối') }
    await act(async () => button('Trước').props.onClick())
    await act(async () => { await wait(400) })
    assert.match(JSON.stringify(root.toJSON()), /Nguồn đang mất kết nối/)
    assert.ok(button('Thử lại'))
  } finally { await act(async () => root?.unmount()); global.fetch = previousFetch; delete global.searchFixture }
})
