import assert from 'node:assert/strict'
import test from 'node:test'
import Module from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { act, create } from 'react-test-renderer'

const dir = fileURLToPath(new URL('..', import.meta.url))
const bundle = await build({
  entryPoints: [`${dir}/src/MapSection.jsx`],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  external: ['react'],
  define: { 'import.meta.env': '{"BASE_URL":"/","VITE_API_BASE":""}' },
  loader: { '.css': 'empty' },
  plugins: [{
    name: 'map-fixtures',
    setup(buildApi) {
      buildApi.onResolve({ filter: /^leaflet$/ }, () => ({ path: 'leaflet', namespace: 'fixture' }))
      buildApi.onResolve({ filter: /\/(api|supabaseCloud|areaStats|components|metrics)$/ }, (args) => ({ path: args.path, namespace: 'fixture' }))
      buildApi.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => {
        if (args.path === 'leaflet') return { contents: 'export default {}' }
        if (args.path.endsWith('/api')) return { contents: `
          export const api = {
            metricsMap: (...args) => globalThis.mapMetrics(...args),
            mapFacilityIngredients: (...args) => globalThis.mapIngredients(...args),
            baoanCatalog: async () => ({ items: [] }),
          };
          export const fmtDateTime = value => value || '';
        ` }
        if (args.path.endsWith('/supabaseCloud')) return { contents: `
          export const cloudCatalog = async () => ({ items: [] });
          export const cloudMap = (...args) => globalThis.mapMetrics(...args);
          export const cloudMapFacilityIngredients = (...args) => globalThis.mapIngredients(...args);
          export const cloudMscSearch = async () => ({ items: [] });
          export const cloudSuggest = async () => ({ items: [] });
        ` }
        if (args.path.endsWith('/areaStats')) return { contents: `
          import React from 'react';
          export const StatCards = () => React.createElement('div', null, 'stats');
        ` }
        if (args.path.endsWith('/components')) return { contents: `
          import React from 'react';
          export const DetailModal = () => null;
          export const Field = ({ children, label }) => React.createElement('label', null, label, children);
          export const SuggestField = ({ label, value, onChange }) => React.createElement('label', null, label,
            React.createElement('input', { value: value || '', onChange }));
        ` }
        return { contents: `
          export const fmtInt = value => String(value ?? 0);
          export const fmtMoney = value => String(value ?? 0);
          export const fmtVndCompact = value => String(value ?? 0);
        ` }
      })
    },
  }],
})
const compiled = new Module(`${dir}/tests/map-initial.cjs`)
compiled.paths = Module._nodeModulePaths(dir)
compiled._compile(bundle.outputFiles[0].text, 'map-initial.cjs')
const MapSection = compiled.exports.default

const textOf = (node) => {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return textOf(node.children)
}
const wait = () => new Promise(resolve => setTimeout(resolve, 10))

test('map renders before facility selection and reports selected detail loading/error', async () => {
  const previous = { fetch: global.fetch, window: global.window, metrics: global.mapMetrics, ingredients: global.mapIngredients }
  global.window = {
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: (callback) => setTimeout(callback, 0),
    clearTimeout: (timer) => clearTimeout(timer),
  }
  global.fetch = async () => ({ ok: true, headers: { get: () => null }, body: null, json: async () => ({ type: 'FeatureCollection', features: [] }) })
  let detailReject
  global.mapMetrics = async () => ({
    dots: [{ id: 'facility-01', kind: 'facility', name: 'Bệnh viện Hà Nội', provinceCode: '01', province: 'Hà Nội', value: 100, ingredients: [] }],
    summary: { value: 100 }, ingredients: [],
  })
  global.mapIngredients = () => new Promise((_resolve, reject) => { detailReject = reject })
  let root
  try {
    await act(async () => { root = create(React.createElement(MapSection, { localMode: true })); await wait() })
    assert.match(textOf(root.toJSON()), /Bản đồ nhiệt/)
    assert.match(textOf(root.toJSON()), /Chưa có hoạt chất trong 12 tháng này\./)

    const facilityButton = root.root.findAllByType('button').find(button => textOf(button.children).includes('Bệnh viện Hà Nội'))
    assert.ok(facilityButton, 'facility is listed and selectable')
    await act(async () => { facilityButton.props.onClick(); await wait() })
    assert.match(textOf(root.toJSON()), /Đang tải hoạt chất của cơ sở…/)
    assert.doesNotMatch(textOf(root.toJSON()), /Chưa có hoạt chất trong 12 tháng này\./)

    await act(async () => { detailReject(new Error('Không tải được hoạt chất')); await wait() })
    assert.match(textOf(root.toJSON()), /Không tải được hoạt chất/)
    assert.doesNotMatch(textOf(root.toJSON()), /Chưa có hoạt chất trong 12 tháng này\./)
  } finally {
    if (root) await act(async () => { root.unmount() })
    global.fetch = previous.fetch
    global.window = previous.window
    global.mapMetrics = previous.metrics
    global.mapIngredients = previous.ingredients
  }
})
