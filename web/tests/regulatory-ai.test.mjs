import {test} from 'node:test'
import assert from 'node:assert/strict'
import {ruleInsight,fingerprint,guardedInsight} from '../../lib/regulatory/brief.js'
import {makeRequest,validateAnalysis} from '../../lib/regulatory/ai.js'
import {authorized} from '../../api-lib/routes/regulatoryDaily.js'

const doc={id:'test',title:'Danh mục thuốc đáp ứng quy định đấu thầu thuốc',summary:'Công bố danh mục thuốc để kiểm tra hồ sơ đấu thầu.',legal_status:'unknown',code:'800/QĐ-QLD'}
test('editorial prioritization excludes cosmetics, flags drafts and avoids treating sanctions as bans',()=>{
  assert.equal(ruleInsight(doc).priority,85)
  assert.equal(ruleInsight({...doc,title:'Thu hồi số tiếp nhận công bố mỹ phẩm',summary:''}).priority,0)
  assert.equal(ruleInsight({...doc,title:'Thu hồi thuốc do vi phạm chất lượng',summary:''}).priority,95)
  assert.equal(ruleInsight({...doc,legal_status:'draft'}).priority,50)
  const sanction=ruleInsight({...doc,title:'Quyết định xử phạt Công ty dược',summary:''})
  assert.equal(sanction.priority,60);assert.match(sanction.impact,/không tự đồng nghĩa bị cấm thầu/)
  assert.notEqual(fingerprint(doc),fingerprint({...doc,summary:'Changed'}))
})
test('AI requires exact evidence and IDs; request bounded with no grounding tools',()=>{
  const item={id:'test',priority:90,reason:'Liên quan quy định thầu thuốc.',impact:'Có thể cần đối chiếu hồ sơ.',action:'Kiểm tra bản gốc và phụ lục.',evidence_quote:'Danh mục thuốc đáp ứng'}
  assert.equal(validateAnalysis({items:[item]},[doc])[0].method,'ai')
  assert.throws(()=>validateAnalysis({items:[{...item,id:'invented'}]},[doc]))
  assert.throws(()=>validateAnalysis({items:[{...item,evidence_quote:'Một câu không có trong nguồn'}]},[doc]))
  assert.throws(()=>validateAnalysis({items:[item,item]},[doc]))
  assert.equal(validateAnalysis({items:[item]},[{...doc,legal_status:'draft'}])[0].priority,50)
  assert.equal(validateAnalysis({items:[item]},[{...doc,summary:doc.summary+' Đang lấy ý kiến dự thảo.'}])[0].priority,50)
  const request=makeRequest([doc]);assert.equal(request.tools,undefined);assert.equal(request.generationConfig.maxOutputTokens,4096)
  assert.ok(Buffer.byteLength(JSON.stringify(request))<24000)
})
test('cron refuses missing or invalid credentials',()=>{
  assert.equal(authorized(undefined,undefined),false)
  assert.equal(authorized('Bearer undefined',undefined),false)
  assert.equal(authorized('Bearer bad','secret'),false)
  assert.equal(authorized('Bearer secret','secret'),true)
})

test('a genuine citation does not authorize invented tender eligibility or scoring',()=>{
  const base={method:'ai',impact:'Có thể làm tăng số thuốc đủ điều kiện tham gia dự thầu.',action:'Cập nhật hồ sơ.'}
  assert.equal(guardedInsight(doc,base).method,'rules')
  assert.equal(guardedInsight(doc,{...base,impact:'Có thể ảnh hưởng điểm đánh giá năng lực nhà thầu.'}).method,'rules')
  assert.equal(guardedInsight(doc,{...base,impact:'Đảm bảo tính liên tục của nguồn cung thuốc.'}).method,'rules')
  assert.equal(guardedInsight(doc,{...base,impact:'Có thể ảnh hưởng hồ sơ nếu có thuốc thuộc danh mục.'}).method,'ai')
})
