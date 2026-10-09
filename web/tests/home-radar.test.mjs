import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { filterLegal, LEGAL_CORE } from '../src/home/legalCatalog.js'
import { natureOf, sourceBadge, splitBrief } from '../src/home/briefSplit.js'
import { classifyTender, countdownLabel, radarView } from '../src/home/tenderRadar.js'
import { countTopic, defaultTopicName, normalizeTopics, topicSentence } from '../src/home/watchTopics.js'
import { validateLegal, validateNews } from '../../lib/regulatory/onDemand.js'

const now = Date.parse('2026-09-29T08:00:00+07:00')

test('radar separates open matches from this week’s notices', () => {
  const open = [
    { tender_no: 'IB1', status_code: '', close_date: '2026-10-02 09:00:00', published: '2026-09-20', baoan_match: 'exact', bid_price: 2e9 },
    { tender_no: 'IB2', status_code: 'DXT', close_date: '2026-09-01', published: '2026-09-28', baoan_match: 'exact' },
  ]
  const recent = [
    { tender_no: 'IB3', status_code: '', close_date: '2026-10-10', published: '2026-09-26', baoan_match: '' },
    ...open,
  ]
  const view = radarView(open, recent, 'fresh', now)
  assert.equal(view.counts.open, 1)
  assert.equal(view.counts.match, 1)
  assert.deepEqual(view.list.map(row => row.tender_no), ['IB3', 'IB2'])
  assert.equal(classifyTender(open[1], now).isOpen, false)
  assert.equal(classifyTender(open[0], now).closing, true)
  assert.deepEqual(view.closing.map(row => row.tender_no), ['IB1'])
  assert.match(countdownLabel(Date.parse('2026-10-02T09:00:00+07:00'), now), /Còn \d+ ngày/)
})

test('summary cards stretch to the same height', () => {
  const css = readFileSync(new URL('../src/home.css', import.meta.url), 'utf8')
  assert.match(css, /\.home-radar-row\s*\{[^}]*align-items:\s*stretch/)
  assert.match(css, /\.home-radar-card\s*\{[^}]*height:\s*100%/)
  assert.match(css, /\.home-radar-card\s*\{[^}]*min-height:\s*176px/)
  assert.match(css, /\.home-topic-tags\s*\{[^}]*top:\s*8px/)
  assert.match(css, /\.home-topic-tags\s*\{[^}]*right:\s*10px/)
})

test('watch topic keeps an editable name beside the criteria', () => {
  assert.equal(defaultTopicName({ ingredient: 'Metformin', province: 'Hà Nội' }, 4), 'Metformin')
  assert.equal(defaultTopicName({ province: 'Hà Nội' }, 2), 'Hà Nội')
  assert.equal(defaultTopicName({}, 1), 'Tiêu chí 1')
  const topics = normalizeTopics([
    { id: 'a', criteria: { ingredient: 'Metformin' } },
    { id: 'b', name: '  Khu vực Hà Nội  ', criteria: { province: 'Hà Nội' } },
    { id: 'c', criteria: {} },
  ])
  assert.equal(topics.length, 2)
  assert.equal(topics[0].name, 'Metformin')
  assert.equal(topics[1].name, 'Khu vực Hà Nội')
})

test('watch topic sentence stacks criteria and counts only the loaded page', () => {
  const criteria = { contractor: 'Dược Bảo An', ingredient: 'Metformin', form: 'Viên', strength: '500mg', province: 'Hà Nội' }
  assert.equal(topicSentence(criteria), 'Nhà thầu Dược Bảo An · gói mới gồm hoạt chất Metformin, dạng Viên, hàm lượng 500mg · ở Hà Nội')
  const rows = [
    { tender_no: 'IB1', status_code: '', close_date: '2026-10-06', published: '2026-09-27', province: 'Hà Nội', winner: 'Dược Bảo An', scope_lines: [{ name: 'Metformin', strength: '500mg', form: 'Viên' }] },
    { tender_no: 'IB9', status_code: '', close_date: '2026-10-20', published: '2026-09-01', province: 'Hà Nội', winner: 'Dược Bảo An', scope_lines: [{ name: 'Metformin', strength: '500mg', form: 'Viên' }] },
  ]
  const hit = countTopic(criteria, rows, now)
  assert.equal(hit.kind, 'live')
  assert.equal(hit.live, 1)
  assert.equal(hit.rows.length, hit.live)
  assert.equal(hit.rows[0].tender_no, 'IB1')
  const sdk = countTopic({ sdkIngredient: 'Metformin' }, rows, now)
  assert.equal(sdk.kind, 'stored')
  assert.equal(sdk.live, null)
  assert.deepEqual(sdk.rows, [])
  const status = countTopic({ status: 'open' }, rows, now)
  assert.equal(status.live, 2)
})

test('legal search ignores Vietnamese accents and status chips', () => {
  assert.equal(filterLegal(LEGAL_CORE, { query: '40/2025' }).length, 1)
  assert.ok(filterLegal(LEGAL_CORE, { query: 'thong tu 20' }).some(doc => doc.number === '20/2022/TT-BYT'))
  assert.equal(filterLegal(LEGAL_CORE, { status: 'draft' }).length, 2)
  assert.equal(filterLegal(LEGAL_CORE, { query: 'eu-gmp', status: 'transitional' })[0].id, 'tt-03-2024')
})

test('brief keeps two critical stories and labels the source', () => {
  const items = [
    { id: 'a', title: 'Công bố danh mục thuốc đấu thầu', summary: '', source_url: 'https://dav.gov.vn/a', category: 'Đấu thầu', insight: { priority: 90, impact: 'dau thau' } },
    { id: 'b', title: 'Thu hồi thuốc', summary: 'đình chỉ', source_url: 'https://moh.gov.vn/b', category: 'Khác', insight: { priority: 95, impact: 'thu hoi' } },
    { id: 'c', title: 'Tin họp', summary: '', source_url: 'https://baochinhphu.vn/c', category: 'Khác', insight: { priority: 40, impact: '' } },
  ]
  const split = splitBrief(items)
  assert.deepEqual(split.critical.map(item => item.id), ['b', 'a'])
  assert.deepEqual(split.secondary.map(item => item.id), ['c'])
  assert.equal(sourceBadge(items[0]), 'DAV')
  assert.equal(natureOf(items[1]), 'RISK_TRAP')
  assert.equal(natureOf(items[0]), 'OPPORTUNITY')
})

test('gemini payload must stay inside the executive schema', () => {
  const news = validateNews({
    priority: 'CRITICAL',
    headline_vietnamese: 'một hai ba bốn năm sáu bảy tám chín mười mườimột mườihai thừa',
    executive_summary: 'Sự kiện ảnh hưởng nhóm thầu đang mở.',
    tender_impact: { group_affected: 'Nhóm 2', nature: 'RISK_TRAP', detail: 'Có thể chặn chào nhập khẩu nếu đúng hoạt chất.' },
    action_order: 'Giao phòng thầu đối chiếu phụ lục trước thứ Sáu.',
  })
  assert.equal(news.headline_vietnamese.split(' ').length, 12)
  assert.throws(() => validateNews({ ...news, priority: 'HOT' }), /ưu tiên/)
  const legal = validateLegal({
    doc_summary: 'Văn bản đổi cách chia nhóm thầu thuốc công lập.',
    transition_warning: 'Danh mục cũ vẫn tra cứu đến khi có thông tư mới.',
    impact_matrix: {
      group_2_import: 'Kiểm tra EU-GMP trước khi chào nhập.',
      group_4_domestic: 'Rà ngách dưới 2 số đăng ký.',
      bhyt_reimbursement: 'Chưa đổi tỷ lệ thanh toán trong trích yếu này.',
    },
    executive_recommendations: ['Đối chiếu phụ lục với danh mục Bảo An.'],
  })
  assert.equal(legal.executive_recommendations.length, 1)
})


test('featured policy/demand stories use editorial attention without changing draft severity',()=>{
 const items=[{id:'old-recall',attention_score:60,insight:{priority:95}},...['medicine-price','distribution','prescribing','tender-law'].map((id,i)=>({id,attention_score:95-i,insight:{priority:i>1?50:85}}))]
 assert.deepEqual(splitBrief(items).critical.map(item=>item.id),['medicine-price','distribution','prescribing','tender-law'])
 assert.deepEqual(splitBrief(items).secondary.map(item=>item.id),['old-recall'])
})
