import assert from 'node:assert/strict'
import test from 'node:test'
import Module from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { act, create } from 'react-test-renderer'

const dir = fileURLToPath(new URL('..', import.meta.url))
const bundle = await build({
  entryPoints: [`${dir}/src/App.jsx`],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  external: ['react'],
  define: { 'import.meta.env': '{"BASE_URL":"/"}' },
  loader: { '.css': 'empty' },
  plugins: [{
    name: 'routing-fixtures',
    setup(buildApi) {
      buildApi.onResolve({ filter: /\/(api|auth|components|supabaseCloud|DavSection|MscSection|VssSection|AdminSection|HomeDashboard|PortfolioCockpit|BaoAnCatalog|MapSection)$/ }, (args) => ({ path: args.path, namespace: 'fixture' }))
      buildApi.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => {
        if (args.path.endsWith('/api')) return { contents: 'export const api = { health: () => globalThis.routingHealth() }' }
        if (args.path.endsWith('/auth')) return { contents: 'export const useAuth = () => ({ user: null, signOut: async () => {} })' }
        if (args.path.endsWith('/supabaseCloud')) return { contents: 'export const supabaseConfigured = false' }
        if (args.path.endsWith('/components')) return { contents: `
          import React from 'react';
          export const PaneOverlayContext = React.createContext(null);
        ` }
        return { contents: `
          import React from 'react';
          export default function Section(props) {
            globalThis.routingSectionProps = props;
            return React.createElement('div', { 'data-local-mode': String(props.localMode), 'data-section': '${args.path.split('/').at(-1)}' }, 'section');
          }
        ` }
      })
    },
  }],
})
const compiled = new Module(`${dir}/tests/local-routing.cjs`)
compiled.paths = Module._nodeModulePaths(dir)
compiled._compile(bundle.outputFiles[0].text, 'local-routing.cjs')
const App = compiled.exports.default

const tick = () => new Promise(resolve => setTimeout(resolve, 10))

async function renderedMode(hostname) {
  const previous = { window: global.window, health: global.routingHealth, props: global.routingSectionProps }
  global.routingSectionProps = null
  global.routingHealth = () => Promise.reject(new Error('local health unavailable'))
  let hash = '#map'
  global.window = {
    location: { hostname, get hash() { return hash } },
    history: { replaceState: (_state, _title, url) => { hash = String(url).startsWith('#') ? String(url) : hash } },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
  }
  let root
  try {
    await act(async () => { root = create(React.createElement(App)); await tick(); await tick() })
    assert.ok(global.routingSectionProps, `map section should render for ${hostname}`)
    const nav = root.root.findByType('nav')
    assert.deepEqual(nav.findAllByType('summary').map((node) => String(node.children[0]).trim()), ['Tra cứu', 'Nâng cao'])
    assert.deepEqual(nav.children.filter((node) => node.type === 'button').map((node) => node.children[0]), ['Bảng tin', 'Quản lý danh mục', 'Dữ liệu'])
    const prices = nav.findAllByType('button').find((node) => node.children[0] === 'MSC - Đơn giá')
    const menu = { open: true, contains: () => false }
    for (const dropdown of nav.findAllByType('details')) {
      menu.open = true
      dropdown.props.onBlur({ currentTarget: menu, relatedTarget: null })
      assert.equal(menu.open, true, 'touch blur must not hide the option before its click')
      dropdown.props.onBlur({ currentTarget: menu, relatedTarget: {} })
      assert.equal(menu.open, false, 'keyboard focus leaving the menu still closes it')
    }
    menu.open = true
    await act(async () => { prices.props.onClick({ currentTarget: { closest: () => menu } }); await tick() })
    assert.equal(menu.open, false)
    assert.ok(root.root.findAllByProps({ 'data-section': 'MscSection' }).length)
    for (const [label, target] of [['Thuốc DAV', '#dav'], ['MSC - Gói thầu', '#msc'], ['BHYT VSS', '#vss'], ['Bản đồ', '#map']]) {
      const option = nav.findAllByType('button').find((node) => node.children[0] === label)
      menu.open = true
      await act(async () => { option.props.onClick({ currentTarget: { closest: () => menu } }); await tick() })
      assert.equal(hash, target, `${label} must navigate after a touch blur`)
      assert.equal(menu.open, false)
    }
    return global.routingSectionProps.localMode
  } finally {
    if (root) await act(async () => { root.unmount() })
    global.window = previous.window
    global.routingHealth = previous.health
    global.routingSectionProps = previous.props
  }
}

test('local health failure stays local on localhost and uses cloud on a production hostname', async () => {
  assert.equal(await renderedMode('localhost'), true)
  assert.equal(await renderedMode('app.example.com'), false)
})
