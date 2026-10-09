import assert from 'node:assert/strict'
import { test } from 'node:test'
import Module, { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { create, act } from 'react-test-renderer'
const require = createRequire(import.meta.url)
const dir = fileURLToPath(new URL('..', import.meta.url))
const bundle = await build({
  stdin: {
    contents:
      'export { computeDavCompound } from "./src/metrics"; export { useDavSearch } from "./src/hooks/useDavSearch"; export { DavMetricCards } from "./src/components/dav/DavMetricCards"; export { DavDataTable } from "./src/components/dav/DavDataTable";',
    resolveDir: dir,
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  external: ['react', 'react-dom'],
  define: { 'import.meta.env': '{}' },
  plugins: [
    {
      name: 'auth-fixture',
      setup(build) {
        build.onResolve({ filter: /\/auth$/ }, () => ({ path: 'auth', namespace: 'fixture' }))
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: 'export const useAuth = () => ({ user: { id: "test-dav" } })',
        }))
      },
    },
  ],
})
const compiled = new Module(fileURLToPath(new URL('./dav-flow.cjs', import.meta.url)))
compiled.paths = Module._nodeModulePaths(dir)
compiled._compile(bundle.outputFiles[0].text, compiled.filename || 'dav-flow.cjs')
const { computeDavCompound, useDavSearch, DavMetricCards, DavDataTable } = compiled.exports
const flush = () => new Promise((resolve) => setTimeout(resolve, 15))

test('DAV flow: load, metrics, draft filters, pagination, selection, columns, retry and real XLSX export', async () => {
  const store = new Map()
  global.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }
  global.window = { setInterval, clearInterval, setTimeout, clearTimeout }
  let download = null
  let downloadedBlob = null
  const savedCreate = URL.createObjectURL
  URL.createObjectURL = (blob) => {
    downloadedBlob = blob
    return 'blob:test'
  }
  global.document = {
    body: { appendChild() {} },
    createElement: () => ({
      click() {
        download = this.download
      },
      remove() {},
    }),
    addEventListener() {},
    removeEventListener() {},
  }
  const calls = []
  let fail = false
  const rows = Array.from({ length: 125 }, (_, i) => ({
    id: String(i),
    soDangKy: `VN-${i}`,
    tenThuoc: `Thuốc ${i}`,
    hoatChat: 'Paracetamol',
    dangBaoChe: 'Viên nén',
    tagId: 'TAG_XANH_LA',
    ngayCap: '2026-01-01',
  }))
  const originalFetch = global.fetch
  global.fetch = async (url, opts = {}) => {
    if (String(url).includes('/api/metrics?section=dav')) return { ok: true, json: async () => ({ cards: computeDavCompound(rows, rows.length), total: rows.length }) }
    if (String(url).includes('/api/status')) return { ok: true, json: async () => ({}) }
    const body = JSON.parse(opts.body || '{}')
    if (String(url).includes('/api/metrics/slice')) {
      const matched = body.filters?.q ? rows.filter(r => r.tenThuoc.includes(body.filters.q)) : rows
      return { ok: true, json: async () => ({ cards: computeDavCompound(matched, matched.length), total: matched.length }) }
    }
    calls.push(body)
    if (fail) return { ok: false, text: async () => 'Could not find public.search_dav_drugs in schema cache' }
    const filtered = body.filters?.q ? rows.filter((r) => r.tenThuoc.includes(body.filters.q)) : rows
    const items = filtered.slice((body.page || 0) * body.size, ((body.page || 0) + 1) * body.size)
    return {
      ok: true,
      json: async () => ({ total: filtered.length, page: body.page || 0, size: body.size, items }),
    }
  }
  let controller
  function Harness() {
    controller = useDavSearch({ localMode: true })
    return null
  }
  let root
  try {
    await act(async () => {
      root = create(React.createElement(Harness))
      await flush()
    })
    await act(flush)
    assert.equal(controller.data.total, 125)
    assert.equal(controller.metricsTotal, 125)
    assert.equal(controller.metricsCards.length, 4)
    assert.equal(controller.loading, false)
    const metrics = require('react-dom/server').renderToStaticMarkup(
      React.createElement(DavMetricCards, {
        items: controller.metricsItems,
        cards: null,
        total: 125,
        activeId: null,
        onFilter() {},
        loading: false,
        error: '',
        onRetry() {},
      }),
    )
    for (const title of ['Mật độ SĐK', 'Tag hồ sơ', 'Dạng bào chế', 'SĐK mới cấp'])
      assert.ok(metrics.includes(title))
    const before = calls.length
    await act(async () => controller.setF('q', 'Thuốc 1'))
    assert.equal(calls.length, before, 'draft input must not auto-apply')
    await act(async () => {
      controller.runSearch()
      await flush()
    })
    assert.equal(controller.data.total, 36)
    await act(async () => {
      controller.setF('q', '')
      await flush()
    })
    await act(async () => {
      controller.runSearch()
      await flush()
    })
    await act(async () => {
      await controller.search(1)
    })
    assert.equal(controller.page, 1)
    assert.equal(controller.data.items.length, 25)
    await act(async () =>
      controller.sel.setMany(
        controller.data.items.map((row, i) => [controller.rowKey(row, i), row]),
        true,
      ),
    )
    assert.equal(controller.sel.size, 25)
    await act(async () => {
      await controller.doExport()
    })
    assert.match(download, /^DAV_thuoc_.*\.xlsx$/)
    const bytes = new Uint8Array(await downloadedBlob.arrayBuffer())
    assert.equal(String.fromCharCode(...bytes.slice(0, 2)), 'PK')
    assert.ok(new TextDecoder().decode(bytes).includes('VN-100'))
    let table
    await act(async () => {
      table = create(React.createElement(DavDataTable, { controller }))
    })
    const headerLabels = () =>
      table.root
        .findAllByType('span')
        .filter((node) => node.props.className === 'th-label')
        .map((node) => node.children.join(''))
    assert.ok(headerLabels().includes('Số đăng ký'))
    const visible = table.root.findAllByType('input').find((node) => {
      if (node.props.type !== 'checkbox' || node.props.checked !== true) return false
      const label = node.parent?.children?.find((child) => typeof child === 'string')
      return label === 'Số đăng ký'
    })
    assert.ok(visible, 'column picker is separate from the column-filter control')
    await act(async () => visible.props.onChange())
    assert.equal(headerLabels().includes('Số đăng ký'), false)
    await act(async () => table.unmount())
    fail = true
    await act(async () => {
      await controller.search(0)
    })
    assert.equal(controller.loading, false)
    assert.match(controller.err, /nguồn dự phòng/i)
    assert.equal(controller.data.total, 125, 'retain previous data on failure')
    fail = false
    await act(async () => {
      await controller.search(0)
    })
    assert.equal(controller.err, '')
    await act(async () => controller.sel.clear())
    await act(async () => {
      await controller.doExport()
    })
    assert.ok(
      new TextDecoder().decode(await downloadedBlob.arrayBuffer()).includes('VN-124'),
      'all-page export includes final row',
    )
  } finally {
    if (root) await act(async () => root.unmount())
    global.fetch = originalFetch
    URL.createObjectURL = savedCreate
    delete global.window
    delete global.document
    delete global.localStorage
  }
})
