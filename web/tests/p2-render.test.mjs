import assert from 'node:assert/strict'
import { test } from 'node:test'
import Module, { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import React, { useRef, useState } from 'react'
import { create, act } from 'react-test-renderer'

const require = createRequire(import.meta.url)
const dir = fileURLToPath(new URL('..', import.meta.url))
const bundle = await build({
  stdin: {
    contents: 'export { FilterDraft } from "./src/filterDraft.jsx"; export { DataTable } from "./src/components.jsx";',
    resolveDir: dir,
    loader: 'jsx',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  define: { 'import.meta.env': '{}' },
})
const compiled = new Module(fileURLToPath(new URL('./p2-render.cjs', import.meta.url)))
compiled.paths = Module._nodeModulePaths(dir)
compiled._compile(bundle.outputFiles[0].text, compiled.filename || 'p2-render.cjs')
const { FilterDraft, DataTable } = compiled.exports

function Probe() {
  const renders = useRef(0)
  renders.current += 1
  globalThis.__p2ParentRenders = renders
  const [applied, setApplied] = useState({ q: '' })
  const draftRef = useRef(null)
  globalThis.__p2Apply = () => setApplied(draftRef.current.commit())
  return React.createElement(
    FilterDraft,
    { ref: draftRef, applied },
    (draft, setF) => React.createElement('input', {
      value: draft.q,
      onChange: (e) => setF('q', e.target.value),
    }),
  )
}

test('typing in the filter draft does not re-render the parent', () => {
  let tree
  act(() => { tree = create(React.createElement(Probe)) })
  const before = globalThis.__p2ParentRenders.current
  const input = tree.root.findByType('input')
  act(() => { input.props.onChange({ target: { value: 'cillin' } }) })
  act(() => { input.props.onChange({ target: { value: 'cillin-x' } }) })
  assert.equal(globalThis.__p2ParentRenders.current, before)
  act(() => { globalThis.__p2Apply() })
  assert.equal(globalThis.__p2ParentRenders.current, before + 1)
  assert.equal(tree.root.findByType('input').props.value, 'cillin-x')
})

test('a 200-row table keeps a short DOM window', () => {
  const rows = Array.from({ length: 200 }, (_, i) => ({ id: i, name: `row-${i}` }))
  let tree
  act(() => {
    tree = create(React.createElement(DataTable, {
      columns: [{ key: 'name', label: 'Tên' }],
      rows,
      rowKey: (r) => String(r.id),
      selectable: false,
      showIndex: false,
      filtersVisible: false,
    }))
  })
  const bodyRows = tree.root.findAll((node) => (
    node.type === 'tr'
    && node.props?.className !== 'virt-spacer'
    && node.props?.className !== 'labels'
  ))
  assert.ok(bodyRows.length > 0, 'expected a visible window')
  assert.ok(bodyRows.length < 60, `rendered ${bodyRows.length} rows`)
})
