import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { brief, ruleInsight } from '../../lib/regulatory/brief.js'
import { categoryOf, relevant } from '../../lib/regulatory/parser.js'
import { crawlSource } from '../../lib/regulatory/crawler.js'
import { seedSources } from '../../lib/regulatory/seed.js'

test('medicine prices based on winning bids and pharmaceutical law reach editorial coverage', () => {
  const title = 'Giá bán thuốc tối đa từ doanh nghiệp không được vượt quá 30% giá trúng thầu thực tế'
  assert.equal(categoryOf(title), 'Đấu thầu')
  assert.equal(ruleInsight({ title, summary: '', legal_status: 'unknown' }).priority, 85)
  assert.equal(ruleInsight({ title: 'Hướng dẫn thực hiện đấu thầu theo các Hiệp định CPTPP, EVFTA, UKVFTA', summary: 'Gói thầu thuộc dự án của cơ quan mua sắm trong phụ lục.' }).priority, 70)
  assert.equal(relevant('Dự thảo sửa đổi Luật Dược'), true)
  assert.equal(relevant('Danh mục dịch vụ sự nghiệp công thuộc phạm vi quản lý của Bộ Y tế'), false)
})

test('brief selects publication dates before archive limits and deduplicates dual dates', async () => {
  const recent = new Date().toISOString().slice(0, 10)
  const documents = Array.from({ length: 180 }, (_, i) => ({ id: `old${i}`, title: 'Danh mục thuốc đấu thầu cũ', summary: '', issued_at: '2020-01-01', published_at: null, origin: 'crawl' }))
  documents.push(
    { id: 'news', title: 'Giá bán thuốc căn cứ giá trúng thầu', summary: '', issued_at: null, published_at: recent, origin: 'crawl', content: 'Do not send full content' },
    { id: 'dual', title: 'Danh mục thuốc đấu thầu mới', summary: '', issued_at: recent, published_at: recent, origin: 'crawl' },
    { id: 'seed', title: 'Thuốc đấu thầu tham khảo', summary: '', issued_at: recent, published_at: null, origin: 'seed' },
  )
  const requests = []
  const db = createClient('https://fixture.supabase.co', 'fixture-key', { global: { fetch: async input => {
    const url = new URL(input), table = url.pathname.split('/').at(-1)
    requests.push(url)
    let rows = table === 'regulatory_documents' ? [...documents] : []
    for (const key of ['published_at', 'issued_at']) {
      const filter = url.searchParams.get(key)
      if (filter?.startsWith('gte.')) rows = rows.filter(d => d[key] && d[key] >= filter.slice(4))
    }
    if (url.searchParams.has('or')) rows = rows.filter(d => d.origin === 'crawl' || d.source_id || d.published_at)
    const order = url.searchParams.get('order')?.split('.')[0]
    if (order) rows.sort((a, b) => String(b[order] || '').localeCompare(String(a[order] || '')))
    if (url.searchParams.has('limit')) rows = rows.slice(0, Number(url.searchParams.get('limit')))
    return new Response(JSON.stringify(rows), { headers: { 'Content-Type': 'application/json' } })
  } }, auth: { persistSession: false } })
  const result = await brief(db)
  assert.equal(result.total, 2)
  assert.deepEqual(result.items.map(d => d.id).sort(), ['dual', 'news'])
  assert.equal(result.items[0].content, undefined)
  assert.ok(requests.some(url => url.searchParams.has('published_at')))
})

test('source seeding repairs only the legacy procurement homepage URL', async () => {
  const requests = []
  const db = createClient('https://fixture.supabase.co', 'fixture-key', { global: { fetch: async (input, init) => {
    requests.push({ url: new URL(input), method: init.method, body: JSON.parse(init.body) })
    return new Response(null, { status: 204 })
  } }, auth: { persistSession: false } })
  await seedSources(db)
  const patch = requests.find(r => r.method === 'PATCH')
  assert.deepEqual(patch.body, { url: 'https://baochinhphu.vn/dau-thau.html' })
  assert.equal(patch.url.searchParams.get('id'), 'eq.baochinhphu-procurement')
  assert.equal(patch.url.searchParams.get('url'), 'eq.https://baochinhphu.vn/')
  assert.equal(patch.url.searchParams.get('kind'), 'eq.html')
})

test('failed source, empty official news list and malformed page have distinct results', async () => {
  const db = { rpc: async () => ({ data: true }), from: () => ({ insert: async () => ({ data: null }), update: () => ({ eq: async () => ({ data: null }) }) }) }
  const source = { id: 'gov', url: 'https://baochinhphu.vn/dau-thau.html', kind: 'html' }
  const empty = ['Hoạt động văn hóa trong tuần này', 'Kết quả hội nghị kinh tế mới nhất', 'Khai mạc sự kiện du lịch quốc tế'].map((title, i) => `<a href="/event-10226100812345678${i}.htm">${title}</a>`).join('')
  const run = get => crawlSource(db, source, { force: true, get, discoverLinks: async () => ({ links: [], attempted: false }) })
  assert.equal((await run(async () => { throw new Error('HTTP 503') })).state, 'error')
  const result = await run(async () => empty)
  assert.equal(result.state, 'ok'); assert.equal(result.count, 0); assert.deepEqual(result.errors, [])
  assert.equal((await run(async () => '<h1>Access denied</h1>')).state, 'error')
})


test('prescribing proposals and significant older policy news reach the shared brief without claiming legal effect',async()=>{
 const days=n=>new Date(Date.now()-n*86400000).toISOString().slice(0,10)
 const rows=[
  {id:'prescribing',title:'Đề xuất kê đơn thuốc ngoại trú tối đa 90 ngày',summary:'Bộ Y tế đang lấy ý kiến dự thảo.',legal_status:'draft',published_at:days(18),origin:'crawl'},
  {id:'law-proposal',title:'Đề xuất sửa Luật Đấu thầu',summary:'Dự thảo luật.',legal_status:'draft',published_at:days(63),origin:'crawl'},
  {id:'origin-price',title:'Thủ tướng: Kiểm soát chặt chẽ giá thành từ gốc với thuốc, thiết bị y tế',summary:'Giảm chi phí trung gian.',published_at:days(31),origin:'crawl'},
  {id:'old',title:'Thuốc đấu thầu từ năm trước',published_at:days(120),origin:'crawl'},
  {id:'future',title:'Thuốc đấu thầu trong tương lai',published_at:days(-2),origin:'crawl'}]
 const db=createClient('https://fixture.supabase.co','fixture-key',{auth:{persistSession:false},global:{fetch:async input=>{
  const u=new URL(input);let data=u.pathname.endsWith('regulatory_documents')?[...rows]:[]
  for(const key of ['published_at','issued_at']){const f=u.searchParams.get(key);if(f?.startsWith('gte.'))data=data.filter(d=>d[key]&&d[key]>=f.slice(4))}
  return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}})
 }}})
 const result=await brief(db)
 assert.deepEqual(result.items.map(d=>d.id).sort(),['law-proposal','origin-price','prescribing'])
 assert.equal(result.items.find(d=>d.id==='prescribing').insight.priority,50)
 assert.match(result.items.find(d=>d.id==='prescribing').insight.action,/chưa áp dụng/)
})
