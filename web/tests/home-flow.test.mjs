import assert from 'node:assert/strict'
import { test } from 'node:test'
import Module from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { create, act } from 'react-test-renderer'

const dir = fileURLToPath(new URL('..', import.meta.url))
const bundle = await build({
  entryPoints: [`${dir}/src/home/HomeDashboard.jsx`],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  external: ['react'],
  define: { 'import.meta.env': '{"BASE_URL":"/","VITE_API_BASE":""}' },
  loader: { '.css': 'empty' },
  plugins: [{
    name: 'fixture',
    setup(b) {
      b.onResolve({ filter: /regulatoryService$|supabaseCloud$|geminiService$/ }, args => ({ path: args.path, namespace: 'fixture' }))
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => {
        if (args.path.includes('regulatory')) return { contents: 'export const regulatoryRequest = (...a) => globalThis.homeReg(...a)' }
        if (args.path.includes('gemini')) return { contents: 'export const analyzeNews = b => globalThis.homeAi(b); export const analyzeLegal = b => globalThis.homeLegal(b)' }
        return { contents: 'export const cloudMscSearch = b => globalThis.homeMsc(b); export const cloudMetricsSlice = b => globalThis.homeSlice?.(b) || Promise.resolve({})' }
      })
    },
  }],
})
const compiled = new Module(`${dir}/tests/home-flow.cjs`)
compiled.paths = Module._nodeModulePaths(dir)
compiled._compile(bundle.outputFiles[0].text, 'home-flow.cjs')
const Home = compiled.exports.default
const content = node => {
  if (node == null || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(content).join('')
  return content(node.children ?? node.props?.children)
}
const rendered = node => {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(rendered).join('')
  return rendered(node.children)
}
const button = (root, label) => root.root.findAllByType('button').find(node => rendered(node.children).includes(label) || content(node.props?.children).includes(label))
const wait = () => new Promise(resolve => setTimeout(resolve, 30))
const hostClass = (node) => {
  const cls = node?.props?.className
  return typeof cls === 'string' ? cls.split(/\s+/) : []
}
const walk = (node, visit) => {
  if (node == null || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach(child => walk(child, visit)); return }
  visit(node)
  walk(node.children, visit)
}

test('home cockpit keeps one row of three cards and confirms a watch topic from a popup', async () => {
  const previous = global.fetch
  const previousStorage = global.localStorage
  const mem = new Map()
  const stamp = (offsetDays) => {
    const date = new Date(Date.now() + offsetDays * 86400000)
    const pad = (value) => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:00`
  }
  global.localStorage = {
    getItem: (key) => (mem.has(key) ? mem.get(key) : null),
    setItem: (key, value) => { mem.set(String(key), String(value)) },
    removeItem: (key) => { mem.delete(key) },
  }
  global.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body || '{}')
    const open = body.filters?.metricQuick === 'open_all'
    const items = open
      ? [{ tender_no: 'IB260001', name: 'Thuốc generic bệnh viện', buyer: 'Sở Y tế Hà Nội', province: 'Hà Nội', status_code: '', close_date: stamp(3), published: stamp(-2), bid_price: 1200000000, baoan_match: 'exact', scope_lines: [{ name: 'Metformin', strength: '500mg', form: 'Viên', group: 'Nhóm 4', price: 800, match: 'exact' }], source_url: 'https://muasamcong.mpi.gov.vn/web/guest/contractor-selection?id=1' }]
      : [{ tender_no: 'IB260002', name: 'Gói mới tuần này', buyer: 'Bệnh viện Bạch Mai', province: 'Hà Nội', status_code: '', close_date: stamp(20), published: stamp(-1), bid_price: 500000000 }]
    return { ok: true, json: async () => ({ items, hasMore: false }) }
  }
  global.homeReg = async () => ({ sources:[{id:'good',name:'Chính phủ',enabled:true,last_success:'2026-10-09T02:00:00Z'},{id:'bad',name:'Nguồn DAV',enabled:true,last_error:'Kết nối timeout',last_success:'2026-10-08T02:00:00Z'},{id:'disabled',name:'Nguồn tắt',enabled:false,last_error:'Không hoạt động'}], items: [
    { id: 'n1', title: 'Công bố danh mục thuốc đáp ứng điểm c khoản 1 Điều 4 Thông tư 40/2025', summary: 'Danh mục dùng cho đấu thầu.', source_url: 'https://dav.gov.vn/tin', source_name: 'Cục Quản lý Dược', category: 'Đấu thầu', published_at: '2026-09-18', insight: { priority: 90, impact: 'Có thể đổi cách xét nhóm 2.', action: 'Giao phòng thầu đối chiếu phụ lục.', method: 'rules' } },
    { id: 'n2', title: 'Lịch họp ngành dược', summary: 'Tin theo dõi.', source_url: 'https://moh.gov.vn/tin', category: 'Khác', insight: { priority: 35, impact: 'Chưa thấy tác động trực tiếp.', action: 'Đọc nếu có thuốc liên quan.', method: 'rules' } },
  ] })
  global.homeLegal = async () => ({
    doc_summary: 'Dự thảo có thể thêm hoạt chất vào danh mục bắt buộc BE.',
    transition_warning: 'Chưa có hiệu lực.',
    impact_matrix: { group_2_import: 'Không làm BE nên không chào phần bắt buộc BE.', group_4_domestic: 'Rà ngách còn lại.', bhyt_reimbursement: 'Chưa đổi tỷ lệ thanh toán.' },
    executive_recommendations: ['Theo dõi dự thảo, chưa sửa hồ sơ thầu.'],
  })
  let root
  const opened = []
  try {
    await act(async () => { root = create(React.createElement(Home, { localMode: true, onOpenMsc: () => opened.push('msc'), onOpenAdmin: () => opened.push('admin'), onOpenLaw: () => opened.push('law') })); await wait() })
    assert.match(content(root.toJSON()), /Bàn điều hành thầu/)
    assert.match(content(root.toJSON()), /Công bố danh mục thuốc/)
    assert.match(content(root.toJSON()), /Kiểm tra nguồn: 09:00 9\/10\/2026|Kiểm tra nguồn: 09:00.*09\/10\/2026/)
    assert.match(content(root.toJSON()), /1 nguồn chưa cập nhật được/)
    assert.match(content(root.toJSON()), /Nguồn DAV.*Kết nối timeout/)
    assert.doesNotMatch(content(root.toJSON()), /Nguồn tắt/)
    assert.match(content(root.toJSON()), /1 gói khớp/)
    assert.doesNotMatch(content(root.toJSON()), /Gói thầu khớp/)
    assert.match(content(root.toJSON()), /mới tuần này/)
    assert.match(content(root.toJSON()), /sắp đóng/)
    assert.doesNotMatch(content(root.toJSON()), /Gói mới tuần này/)
    assert.match(content(root.toJSON()), /Mục theo dõi/)
    assert.match(content(root.toJSON()), /Chưa có mục theo dõi/)
    const radarCards = () => {
      let row = null
      walk(root.toJSON(), node => { if (hostClass(node).includes('home-radar-row')) row = node })
      return (Array.isArray(row?.children) ? row.children : []).filter(node => hostClass(node).includes('home-radar-card'))
    }
    const panelOf = () => {
      let panel = null
      let count = 0
      walk(root.toJSON(), node => {
        if (hostClass(node).includes('home-radar-panel')) { panel = node; count += 1 }
      })
      return { panel, count }
    }
    const toneCount = (node, tone) => {
      let n = 0
      walk(node, child => {
        const names = hostClass(child)
        if (names.includes('home-tender') && names.includes(tone)) n += 1
      })
      return n
    }
    const tenderCount = (node) => {
      let n = 0
      walk(node, child => { if (hostClass(child).includes('home-tender')) n += 1 })
      return n
    }
    const cards = radarCards()
    assert.equal(cards.length, 3)
    assert.match(content(cards[0]), /Đang mở/)
    assert.match(content(cards[0]), /1 gói khớp/)
    assert.doesNotMatch(content(cards[0]), /IB260001/)
    assert.match(content(cards[1]), /mới tuần này/)
    assert.match(content(cards[1]), /sắp đóng/)
    assert.doesNotMatch(content(cards[1]), /Gói mới tuần này/)
    assert.match(content(cards[2]), /Mục theo dõi/)
    assert.match(content(cards[2]), /Thêm/)
    assert.equal(tenderCount(cards[0]) + tenderCount(cards[1]) + tenderCount(cards[2]), 0)
    assert.equal(panelOf().panel, null)
    await act(async () => button(root, 'mới tuần này').props.onClick())
    const week = panelOf()
    assert.equal(week.count, 1)
    assert.match(content(week.panel), /Mới tuần này/)
    assert.match(content(week.panel), /Sắp đóng/)
    assert.match(content(week.panel), /Gói mới tuần này/)
    assert.ok(toneCount(week.panel, 'fresh') >= 1)
    assert.ok(toneCount(week.panel, 'closing') >= 1)
    const weekCards = radarCards()
    assert.equal(tenderCount(weekCards[0]) + tenderCount(weekCards[1]) + tenderCount(weekCards[2]), 0)
    await act(async () => button(root, 'mới tuần này').props.onClick())
    assert.equal(panelOf().panel, null)
    await act(async () => button(root, 'Gói thầu đang mở').props.onClick())
    const openPanel = panelOf()
    assert.equal(openPanel.count, 1)
    assert.match(content(openPanel.panel), /IB260001/)
    assert.match(content(openPanel.panel), /Khớp SKU/)
    assert.doesNotMatch(content(openPanel.panel), /Gói mới tuần này/)
    assert.equal(tenderCount(radarCards()[0]), 0)
    await act(async () => button(root, 'IB260001').props.onClick())
    assert.match(content(root.toJSON()), /Metformin/)
    assert.match(content(root.toJSON()), /Tải E-HSMT gốc/)
    assert.match(content(root.toJSON()), /Lịch họp ngành dược/)
    await act(async () => button(root, 'Thu gọn').props.onClick())
    await act(async () => button(root, 'Xem thêm 1 tin').props.onClick())
    assert.match(content(root.toJSON()), /Lịch họp ngành dược/)
    await act(async () => button(root, 'Dự thảo').props.onClick())
    assert.match(content(root.toJSON()), /Dự thảo Phụ lục BE/)
    assert.match(content(root.toJSON()), /Danh mục thuốc BHYT mới/)
    await act(async () => button(root, 'Phân tích tác động').props.onClick())
    await act(async () => {})
    assert.match(content(root.toJSON()), /Theo dõi dự thảo/)
    const launch = () => root.root.findAllByType('button').find(node => String(node.props.className || '').includes('home-watch-launch'))
    assert.equal(rendered(launch().children), 'Thêm')
    assert.equal(button(root, 'Xác nhận'), undefined)
    await act(async () => launch().props.onClick())
    assert.equal(root.root.findAll(node => node.props?.role === 'dialog' && node.props['aria-label'] === 'Thêm mục theo dõi').length, 1)
    const field = (label) => root.root.findAllByType('input').find(node => node.props['aria-label'] === label)
    const ingredientField = () => root.root.findAllByType('label').find(node => String(node.props.className || '').includes('home-watch-field') && content(node.props.children).includes('Hoạt chất') && !content(node.props.children).includes('SĐK'))
    assert.equal(field('Giá trị hoạt chất').props.disabled, true)
    assert.match(ingredientField().props.className, /is-off/)
    await act(async () => field('Hoạt chất').props.onChange({ target: { checked: true } }))
    assert.equal(field('Giá trị hoạt chất').props.disabled, false)
    assert.match(ingredientField().props.className, /is-on/)
    await act(async () => field('Giá trị hoạt chất').props.onChange({ target: { value: 'Metformin' } }))
    await act(async () => field('Hoạt chất').props.onChange({ target: { checked: false } }))
    assert.equal(field('Giá trị hoạt chất').props.value, '')
    assert.equal(field('Giá trị hoạt chất').props.disabled, true)
    assert.match(ingredientField().props.className, /is-off/)
    await act(async () => field('Hoạt chất').props.onChange({ target: { checked: true } }))
    await act(async () => field('Giá trị hoạt chất').props.onChange({ target: { value: 'Metformin' } }))
    const nameField = () => root.root.findAllByType('input').find(node => node.props['aria-label'] === 'Tên tiêu chí')
    assert.equal(nameField().props.value, 'Metformin')
    await act(async () => nameField().props.onChange({ target: { value: 'Metformin bệnh viện' } }))
    assert.equal(nameField().props.value, 'Metformin bệnh viện')
    await act(async () => button(root, 'Xác nhận').props.onClick())
    assert.match(content(radarCards()[2]), /1 gói trên trang đã tải/)
    assert.doesNotMatch(content(radarCards()[2]), /gói mới gồm hoạt chất Metformin/)
    assert.equal(tenderCount(radarCards()[2]), 0)
    assert.equal(rendered(launch().children), 'Quản lý mục theo dõi')
    assert.equal(button(root, 'Thêm'), undefined)
    const watchToggle = () => root.root.findAllByType('button').find(node => node.props['aria-label'] === 'Mục theo dõi' && node.props['aria-expanded'] != null)
    await act(async () => watchToggle().props.onClick())
    const watchPanel = panelOf()
    assert.equal(watchPanel.count, 1)
    assert.match(content(watchPanel.panel), /gói mới gồm hoạt chất Metformin/)
    assert.match(content(watchPanel.panel), /IB260001/)
    assert.doesNotMatch(content(watchPanel.panel), /Gói mới tuần này/)
    const tagText = (node, tenderNo) => {
      const found = []
      walk(node, child => {
        if (!hostClass(child).includes('home-tender') || !content(child).includes(tenderNo)) return
        walk(child, tag => { if (hostClass(tag).includes('home-topic-tag')) found.push(content(tag)) })
      })
      return found.join(' | ')
    }
    assert.match(tagText(watchPanel.panel, 'IB260001'), /Metformin bệnh viện/)
    assert.doesNotMatch(content(radarCards()[2]), /Metformin bệnh viện/)
    assert.equal(tenderCount(radarCards()[2]), 0)
    await act(async () => watchToggle().props.onClick())
    assert.equal(panelOf().panel, null)
    const saved = [...mem.entries()].find(([key]) => String(key).includes('home.watchTopics'))
    assert.match(saved?.[1] || '', /Metformin bệnh viện/)
    await act(async () => launch().props.onClick())
    const renameField = () => root.root.findAllByType('input').find(node => node.props['aria-label'] === 'Sửa tên tiêu chí')
    assert.equal(renameField().props.value, 'Metformin bệnh viện')
    await act(async () => renameField().props.onChange({ target: { value: 'Thuốc tiểu đường' } }))
    assert.match([...mem.entries()].find(([key]) => String(key).includes('home.watchTopics'))?.[1] || '', /Thuốc tiểu đường/)
    await act(async () => field('Tỉnh').props.onChange({ target: { checked: true } }))
    const provinceSelect = () => root.root.findAllByType('select').find(node => node.props['aria-label'] === 'Chọn tỉnh')
    await act(async () => provinceSelect().props.onChange({ target: { value: 'Hà Nội' } }))
    assert.equal(nameField().props.value, 'Hà Nội')
    await act(async () => nameField().props.onChange({ target: { value: 'Khu vực Hà Nội' } }))
    await act(async () => button(root, 'Xác nhận').props.onClick())
    await act(async () => watchToggle().props.onClick())
    const named = panelOf()
    assert.match(tagText(named.panel, 'IB260001'), /Thuốc tiểu đường/)
    assert.match(tagText(named.panel, 'IB260001'), /Khu vực Hà Nội/)
    assert.match(tagText(named.panel, 'IB260002'), /Khu vực Hà Nội/)
    assert.doesNotMatch(tagText(named.panel, 'IB260002'), /Thuốc tiểu đường/)
    assert.equal(tenderCount(radarCards()[2]), 0)
    await act(async () => launch().props.onClick())
    await act(async () => root.root.findAllByType('button').find(node => node.props['aria-label'] === 'Bỏ Hoạt chất').props.onClick())
    await act(async () => root.root.findAllByType('button').find(node => node.props['aria-label'] === 'Bỏ Tỉnh').props.onClick())
    assert.match(content(root.toJSON()), /Chưa có mục theo dõi/)
    assert.equal(rendered(launch().children), 'Thêm')
    await act(async () => button(root, 'Crawl tin').props.onClick())
    assert.deepEqual(opened, ['admin'])
  } finally {
    await act(async () => root?.unmount())
    global.fetch = previous
    global.localStorage = previousStorage
    delete global.homeReg
    delete global.homeLegal
  }
})
