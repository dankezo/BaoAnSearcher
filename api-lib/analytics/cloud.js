import { query } from '../db/tidb.js'
import {readFileSync} from 'node:fs'
import {suggestionItems,suggestionFields} from './suggestions.js'
import {sdkFormsSql,sdkKeySql} from '../db/sdkForms.js'
const tables = { msc_prices: 'msc_prices', msc_tenders: 'msc_tenders', vss: 'vss_bids', dav: 'dav_drugs' }
export const mappings = {
  msc_prices: { id:'source_id',name:'name',ingredient:'ingredient',strength:'strength',form:'dosage_form',route:'route',registration:'registration',manufacturer:'manufacturer',company:'winner',province:'province',facility:'buyer',group_name:'group_name',unit:'unit',price:'unit_price',quantity:'quantity',date:'published',tender_no:'tender_no',source_url:'source_url',updated_at:'updated_at' },
  msc_tenders: {id:'source_id',name:'name',company:'winner',province:'province',facility:'buyer',amount:'bid_price',date:'published',status:'status_label',tender_no:'tender_no',source_url:'source_url',updated_at:'updated_at'},
  vss: {id:'fp_hash',name:'ten',ingredient:'hoatchat',strength:'hamluong',form:'dangbaoche',route:'duongdung',registration:'sodk',manufacturer:'nhasx',company:'tennhathau',province:'ten_tinh',facility:'ten_cskcb',group_name:'nhomthau',unit:'donvitinh',price:'gia',quantity:'soluong',amount:'thanhtien',date:'tungay_hd',updated_at:'updated_at'},
  dav: {id:'id',name:'ten_thuoc',ingredient:'hoat_chat',strength:'ham_luong',form:'dang_bao_che',registration:'so_dang_ky',manufacturer:'cty_san_xuat',registrant:'cty_dang_ky',date:'ngay_cap',expiry:'ngay_het_han',updated_at:'updated_at'},
}
export const fields = ['id','name','ingredient','strength','form','route','registration','manufacturer','registrant','company','province','facility','group_name','unit','price','quantity','amount','date','expiry','status','tender_no','source_url','updated_at']
const relations = new Map()
export const cloudAdapter = {
  geoSources:[],
  text(expression){return `CONVERT(${expression} USING utf8mb4) COLLATE utf8mb4_unicode_ci`},
  async suggestions(term){
    const rows=[]
    try{
      const doc=JSON.parse(readFileSync(new URL('../../web/public/data/suggest-static.json',import.meta.url),'utf8'))
      for(const bucket of Object.values(doc))for(const field of ['province','ten_tinh'])for(const item of bucket?.[field]||[])rows.push({field,value:typeof item==='string'?item:item.label||item.value})
    }catch{/* Static province list may not be deployed. */}
    const tokens=term.replace(/[^\p{L}\p{N}]+/gu,' ').split(/\s+/).filter(Boolean).slice(0,12)
    if(tokens.length)try{
      const patterns=tokens.map(t=>`%${t.replace(/[\\%_]/g,c=>'\\'+c)}%`)
      const result=await query(`SELECT field,value,cnt FROM (SELECT field,value,cnt,ROW_NUMBER() OVER (PARTITION BY field ORDER BY cnt DESC) AS rank_in_field FROM suggest_values WHERE field IN (${suggestionFields.map(()=>'?').join(',')}) AND ${tokens.map(()=> 'value COLLATE utf8mb4_unicode_ci LIKE ?').join(' AND ')}) ranked WHERE rank_in_field <= 12 ORDER BY cnt DESC LIMIT 240`,[...suggestionFields,...patterns]);rows.push(...result.rows)
    }catch{/* Never scan fact tables for typeahead. */}
    return suggestionItems(rows,term)
  },
  async relation(source,q={}) {
    const relationKey=source+':'+(q.companyFocus||'business')
    if (relations.has(relationKey)) return relations.get(relationKey)
    const table = tables[source]
    const rs = await query('SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=?', [table])
    const columns = new Map(rs.rows.map(r=>[r.COLUMN_NAME || r.column_name, r.DATA_TYPE || r.data_type]))
    if (!columns.size) throw new Error('Nguồn chưa được đồng bộ.')
    const map = mappings[source]
    let geography=false
    if(source==='dav')try{const geo=await query("SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='company_profiles'");geography=Number(geo.rows[0]?.count)>0;if(geography)cloudAdapter.geoSources=['dav']}catch{}
    const expr = field => {
      const col = map[field]
      if(field==='form'&&source==='vss')return columns.has(col)?`COALESCE(NULLIF(TRIM(\`${col}\`),''),vss_forms.dav_form)`:'vss_forms.dav_form'
      if(field==='province'&&source==='dav'&&geography){const company=q.companyFocus==='manufacturer'?'cty_san_xuat':'cty_dang_ky',location=q.companyFocus==='manufacturer'?'factory_province':'office_province',match=columns.has(company+'_f')?`cp.name_key = LOWER(TRIM(\`${company}_f\`)) COLLATE utf8mb4_bin`:`cp.name_key COLLATE utf8mb4_unicode_ci = REPLACE(REGEXP_REPLACE(LOWER(TRIM(CONVERT(\`${company}\` USING utf8mb4))), '[[:space:]]+', ' '), 'đ', 'd') COLLATE utf8mb4_unicode_ci`;return `CONVERT((SELECT cp.${location} FROM company_profiles cp WHERE ${match} LIMIT 1) USING utf8mb4) COLLATE utf8mb4_unicode_ci`}
      if (field === 'amount' && source === 'msc_prices') return columns.has('unit_price') && columns.has('quantity') ? '`unit_price` * `quantity`' : 'NULL'
      if (!columns.has(col)) return 'NULL'
      if (['price','quantity','amount'].includes(field) && !['decimal','double','float','int','bigint'].includes(columns.get(col))) return 'NULL'
      if (['date','expiry'].includes(field) && !['date','datetime','timestamp'].includes(columns.get(col))) return 'NULL'
      if(!['price','quantity','amount','date','expiry','updated_at'].includes(field))return `CONVERT(\`${col}\` USING utf8mb4) COLLATE utf8mb4_unicode_ci`
      return `\`${col}\``
    }
    const selected = fields.map(f=>`${expr(f)} AS ${f}`)
    for (const field of ['ingredient','name','registration','manufacturer','registrant','company','province','facility','strength','form','route']) {
      const folded = `${map[field]}_f`
      selected.push(`${columns.has(folded) ? `CONVERT(\`${folded}\` USING utf8mb4) COLLATE utf8mb4_unicode_ci` : `REPLACE(REGEXP_REPLACE(LOWER(TRIM(${expr(field)})), '[[:space:]]+', ' '), 'đ', 'd')`} AS ${field}_key`)
    }
    selected.push(`CASE WHEN ${expr('group_name')} REGEXP '[1-5]' THEN REGEXP_SUBSTR(${expr('group_name')}, '[1-5]') ELSE '' END AS group_key`)
    let sql = `SELECT /*+ READ_FROM_STORAGE(TIFLASH[${table}]) */ ${selected.join(', ')} FROM ${table}`
    if(source==='vss')sql+=` LEFT JOIN (${sdkFormsSql()}) vss_forms ON ${sdkKeySql('vss_bids.sodk')} = vss_forms.sdk_form_key`
    if(source==='msc_tenders')sql=`SELECT * FROM (SELECT tender_rows.*,ROW_NUMBER() OVER (PARTITION BY COALESCE(NULLIF(tender_no,''),id) ORDER BY date DESC,updated_at DESC,id DESC) AS latest FROM (${sql}) tender_rows) latest_rows WHERE latest=1`
    relations.set(relationKey, sql)
    return sql
  },
  async query(_source, sql, args) { return (await query(sql, args)).rows },
}
