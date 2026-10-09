import {useEffect,useRef,useState,useId} from 'react'
import { Search, X, Save, FileDown } from 'lucide-react'
import {loadSuggestions,presets,savePreset} from './client'
import {Dialog} from './ui'
import type {AnalyticsQuery,EntitySuggestion,Preset} from './types'
const filterLabels={group:'Nhóm kỹ thuật',strength:'Hàm lượng',form:'Dạng bào chế',route:'Đường dùng',province:'Địa bàn'}
export default function OmniFilterBar({query,onApply,onExport,onExportHtml,exporting}:{query:AnalyticsQuery;onApply:(q:AnalyticsQuery)=>void;onExport:()=>void;onExportHtml?:()=>void;exporting:boolean}){
  const [draft,setDraft]=useState(query),[text,setText]=useState(query.entity),[items,setItems]=useState<EntitySuggestion[]>([]),[active,setActive]=useState(-1),[advanced,setAdvanced]=useState(false),[saved,setSaved]=useState<Preset[]>([]),[saveOpen,setSaveOpen]=useState(false),[name,setName]=useState(''),[error,setError]=useState(''),[saving,setSaving]=useState(false)
  const input=useRef<HTMLInputElement>(null),generation=useRef(0),selected=useRef<EntitySuggestion>()
  const [resolving,setResolving]=useState(false),[suggestError,setSuggestError]=useState('')
  const listId=useId()
  useEffect(()=>{generation.current++;selected.current=undefined;setResolving(false);setDraft(query);setText(query.entity);setItems([]);setSuggestError('')},[query])
  useEffect(()=>{generation.current++;setResolving(false)},[draft.mode,draft.role,draft.entityField,draft.territoryField])
  useEffect(()=>{
    const ctrl=new AbortController()
    const timer=setTimeout(()=>{if(text.trim().length<2||text===draft.entity){setItems([]);return}loadSuggestions(text,ctrl.signal).then(r=>{if(ctrl.signal.aborted)return;setItems(r.items);setActive(-1);setSuggestError(r.items.length?'':'Chưa tìm thấy tên trong dữ liệu. Thử tên đầy đủ hoặc SĐK.')}).catch(e=>{if(!ctrl.signal.aborted&&e.name!=='AbortError'){setItems([]);setSuggestError('Chưa tải được gợi ý. Bấm Áp dụng để thử lại.')}})},250)
    return()=>{clearTimeout(timer);ctrl.abort()}
  },[text,draft.entity])
  const selectedQuery=(q:AnalyticsQuery,item:EntitySuggestion):AnalyticsQuery=>({...q,entity:item.label,entityField:item.entityField||'ingredient',territoryField:item.territoryField||'province',mode:item.mode,role:item.mode==='company'?'all':item.role,companyFocus:item.mode==='company'?(item.role==='manufacturer'||item.roles?.includes('manufacturer')&&!item.roles.includes('winner')?'manufacturer':'business'):undefined,entityMatch:item.mode==='company'?'contains':'exact'})
  const select=(item:EntitySuggestion)=>{generation.current++;selected.current=item;setResolving(false);setText(item.label);setItems([]);setSuggestError('');setDraft(q=>selectedQuery(q,item));input.current?.focus()}
  const apply=async(next=draft)=>{
    if(resolving)return
    const entity=text.trim();setError('')
    if(!entity){setItems([]);onApply({...next,mode:'macro',entity:'',role:'winner'});return}
    if(selected.current?.label===entity){setItems([]);onApply(selectedQuery(next,selected.current));return}
    if(entity===query.entity){setItems([]);onApply({...next,entity});return}
    setResolving(true)
    const id=++generation.current
    try{
      const suggestions=(await loadSuggestions(entity,AbortSignal.timeout(8000))).items
      if(generation.current!==id)return
      const folded=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/gi,'d').toLowerCase().replace(/\s+/g,' ').trim()
      const company=/(?:cong ty|co phan|duoc my pham|pharma|ctcp|tnhh)/i.test(folded(entity))
      const base=(s:string)=>folded(s).replace(/^(?:cong ty\s+)?(?:co phan\s+|cp\s+|tnhh\s+)?/,'').trim()
      const exact=suggestions.filter(i=>folded(i.label)===folded(entity)||i.mode==='company'&&base(i.label)===base(entity))
      const eligible=(exact.length?exact:suggestions).filter(i=>!company||i.mode==='company')
      if(company&&eligible.some(i=>i.mode==='company')){const manufacturers=eligible.every(i=>i.role==='manufacturer'||i.roles?.includes('manufacturer')&&!i.roles.includes('winner'));setItems([]);onApply({...next,mode:'company',role:'all',entity,entityMatch:'contains',companyFocus:manufacturers?'manufacturer':'business'});return}
      const fullNames=eligible.filter(i=>i.mode==='company'&&/cong ty co phan/.test(folded(i.label)))
      const candidates=exact.length&&fullNames.length?fullNames:eligible
      const names=new Set(candidates.map(i=>folded(i.label)))
      if(names.size===1){const item=candidates[0];setItems([]);onApply(selectedQuery(next,item));return}
      if(candidates.length){setItems(candidates);setActive(0);setError('Có nhiều chủ thể phù hợp. Chọn một gợi ý để tránh phân tích nhầm.');return}
      setError('Chưa tìm thấy chủ thể trong dữ liệu. Thử tên đầy đủ hoặc chọn một gợi ý. Không thể xác định phạm vi báo cáo.');setItems([])
    }catch{if(generation.current!==id)return;setError('Chưa xác minh được chủ thể. Bấm Áp dụng để thử lại.')}
    finally{if(generation.current===id)setResolving(false)}
  }
  async function openPresets(){try{setSaved(await presets());setError('')}catch(e){setError((e as Error).message)}}
  async function save(){setSaving(true);try{await savePreset(name.trim(),query);setSaveOpen(false);setName('');await openPresets()}catch(e){setError((e as Error).message)}finally{setSaving(false)}}
  return <div className="analytics-filter">
    <div className="analytics-search-row"><div className="analytics-search"><Search size={19}/><input ref={input} aria-label="Tìm thuốc, doanh nghiệp, địa bàn" role="combobox" aria-expanded={items.length>0} aria-controls={listId} aria-activedescendant={active>=0?`${listId}-${active}`:undefined} value={text} placeholder="Hoạt chất, thuốc/SĐK, doanh nghiệp hoặc địa bàn…" onChange={e=>{generation.current++;selected.current=undefined;setResolving(false);setError('');setText(e.target.value)}} onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setActive(i=>Math.min(i+1,items.length-1))}if(e.key==='ArrowUp'){e.preventDefault();setActive(i=>Math.max(0,i-1))}if(e.key==='Escape')setItems([]);if(e.key==='Enter'){e.preventDefault();if(active>=0&&items[active])select(items[active]);else apply()}}}/>{text&&<button aria-label="Xóa tìm kiếm" onClick={()=>{generation.current++;setResolving(false);setText('');setDraft(d=>({...d,entity:''}))}}><X size={16}/></button>}
      {!!items.length&&<ul id={listId} role="listbox" className="analytics-suggestions">{(['drug','company','territory'] as const).filter(mode=>items.some(i=>i.mode===mode)).map(mode=><li key={mode} role="presentation"><strong>{mode==='drug'?'Thuốc / Hoạt chất':mode==='company'?'Doanh nghiệp':'Địa bàn'}</strong>{items.map((item,i)=>item.mode===mode&&<button id={`${listId}-${i}`} role="option" aria-selected={i===active} key={`${item.label}-${item.role}-${item.entityField}`} className={i===active?'active':''} onClick={()=>select(item)}>{item.label}<small>{item.mode==='company'?(item.role==='all'?'Doanh nghiệp · MSC / VSS / DAV':item.role==='winner'?'Nhà thầu':item.role==='manufacturer'?'Nhà sản xuất':'Đơn vị đăng ký'):item.mode==='drug'?(item.entityField==='registration'?'SĐK':item.entityField==='name'?'Tên thuốc':'Hoạt chất'):''}</small></button>)}</li>)}</ul>}
    </div><button className="btn" disabled={resolving} onClick={()=>apply()}>{resolving?'Đang nhận diện…':'Áp dụng'}</button></div>
    {suggestError&&<p className="muted small" role="status">{suggestError}</p>}
    <div className="analytics-controls analytics-toolbar">{([3,6,12,24,'all'] as const).map(n=><button disabled={resolving} className={`btn ${draft.months===n&&!draft.start?'':'ghost'}`} key={n} onClick={()=>{const next={...draft,months:n,comparison:n==='all'?'none' as const:draft.comparison==='none'?'yoy' as const:draft.comparison,start:undefined,end:undefined};setDraft(next);apply(next)}}>{n==='all'?'ALL':n+' tháng'}</button>)}<label>Từ<input type="date" disabled={draft.months==='all'} value={draft.start||''} onChange={e=>setDraft(d=>({...d,start:e.target.value||undefined}))}/></label><label>Đến<input type="date" disabled={draft.months==='all'} value={draft.end||''} onChange={e=>setDraft(d=>({...d,end:e.target.value||undefined}))}/></label><label>Đối chiếu<select disabled={draft.months==='all'} value={draft.comparison} onChange={e=>setDraft(d=>({...d,comparison:e.target.value as AnalyticsQuery['comparison']}))}><option value="none" disabled={draft.months!=='all'}>Không đối chiếu</option><option value="yoy">Cùng kỳ năm trước</option><option value="previous">Kỳ liền trước</option></select></label><button className="btn ghost" aria-expanded={advanced} onClick={()=>setAdvanced(v=>!v)}>Bộ lọc nâng cao</button>{Object.entries(query.filters).filter(([,v])=>v).map(([key,value])=><button className="analytics-chip" key={key} onClick={()=>{const filters={...query.filters};delete filters[key as keyof typeof filters];onApply({...query,filters})}}>{filterLabels[key as keyof typeof filterLabels]}: {value}<X size={13}/></button>)}<button className="btn ghost" onClick={()=>setSaveOpen(true)}><Save size={15}/> Lưu bộ lọc</button><button className="btn ghost" onClick={openPresets}>Bộ lọc đã lưu</button>{saved.length>0&&<select aria-label="Chọn bộ lọc đã lưu" defaultValue="" onChange={e=>{const p=saved.find(x=>x.id===e.target.value);if(p?.version===1)onApply(p.configuration)}}><option value="">Chọn bộ lọc…</option>{saved.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>}<button className="btn ghost" onClick={onExport} disabled={exporting}><FileDown size={15}/>{exporting?'Đang chuẩn bị bản in…':'In / Xuất PDF'}</button>{onExportHtml&&<button className="btn ghost" onClick={onExportHtml} disabled={exporting} title="Lưu bố cục cùng toàn bộ nội dung đã tải"><FileDown size={15}/>Tải HTML</button>}</div>
    {advanced&&<div className="analytics-controls">{Object.entries(filterLabels).map(([key,label])=><label key={key}>{label}{key==='group'?<select value={draft.filters.group||''} onChange={e=>setDraft(d=>({...d,filters:{...d.filters,group:e.target.value}}))}><option value="">Tất cả</option>{[1,2,3,4,5].map(n=><option key={n} value={n}>Nhóm {n}</option>)}</select>:<input value={draft.filters[key as keyof typeof filterLabels]||''} onChange={e=>setDraft(d=>({...d,filters:{...d.filters,[key]:e.target.value}}))}/>}</label>)}<label>Tuyến viện<select disabled><option>Chưa có nguồn phân hạng</option></select></label><label>Giảm giá<select disabled><option>Chưa có giá kế hoạch</option></select></label></div>}

    {error&&<p role="alert">{error}</p>}<Dialog open={saveOpen} onClose={()=>setSaveOpen(false)} title="Lưu bộ lọc"><label>Tên bộ lọc<input maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></label><p>Bộ lọc đang áp dụng sẽ được lưu theo tài khoản của bạn.</p><button className="btn" onClick={save} disabled={!name.trim()||saving}>{saving?'Đang lưu…':'Lưu'}</button>{error&&<p role="alert">{error}</p>}</Dialog>
  </div>
}
