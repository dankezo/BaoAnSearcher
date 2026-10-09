import {useEffect,useRef,useState} from 'react'
import {regulatoryRequest} from '../services/regulatoryService'
import {cachedQuery} from '../queryCache'
import {Card} from './ui'
import {useAuth} from '../auth'

interface News {id:string;title:string;summary?:string;source_url?:string;url?:string;source_name?:string;published_at?:string|null;issued_at?:string|null;legal_status?:string}
const statuses:Record<string,string>={draft:'Dự thảo · chưa áp dụng',active:'Còn hiệu lực',expired:'Hết hiệu lực',replaced:'Bị thay thế',partial:'Hết hiệu lực một phần'}
const date=(value?:string|null)=>value?new Date(value.length===10?`${value}T00:00:00+07:00`:value).toLocaleDateString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):'Chưa rõ ngày'
const link=(item:News)=>item.source_url||item.url||''
export default function RelatedNews({entity}:{entity:string}){
 const {user}=useAuth() as {user:{id:string}|null}
 const [items,setItems]=useState<News[]>([]),[matched,setMatched]=useState<string[]>([]),[shown,setShown]=useState(6),[error,setError]=useState(''),[loading,setLoading]=useState(false),generation=useRef(0)
 useEffect(()=>{const id=++generation.current;setLoading(true);setError('');setItems([]);setShown(6)
  const fetchNews=async(params:Record<string,string>)=>{const data=await regulatoryRequest(params);return (Array.isArray(data)?data:data.items||[]) as News[]}
  const requests:Promise<News[]>[]=[cachedQuery(`analytics:news:brief:v3:${user?.id||'signed-out'}`,()=>fetchNews({view:'brief'}),{freshMs:300000,staleMs:300000})]
  if(entity.trim())requests.push(cachedQuery(`analytics:news:entity:${user?.id||'signed-out'}:${entity}`,()=>fetchNews({view:'news',q:entity,page:'0'}),{freshMs:300000,staleMs:300000}))
  Promise.all(requests).then(([general,specific=[]])=>{if(generation.current!==id)return;setMatched(specific.map(item=>item.id));setItems([...new Map([...general,...specific].map(item=>[item.id,item])).values()].sort((a,b)=>(b.published_at||b.issued_at||'').localeCompare(a.published_at||a.issued_at||'')))}).catch((e:Error)=>{if(generation.current===id)setError(e.message)}).finally(()=>{if(generation.current===id)setLoading(false)})
  return()=>{generation.current++}
 },[entity,user?.id])
 return <div data-analytics-context><Card title="Tin đấu thầu và pháp luật" exportable={!!items.length}>
  <p className="muted small">Cùng nguồn với Bảng tin chính · cập nhật hằng ngày · đối chiếu nguồn gốc trước khi áp dụng.</p>
  {loading&&<p role="status">Đang tải tin…</p>}{error&&<p role="alert">{error}</p>}
  {!loading&&!error&&<div className="analytics-related-news-list">{items.slice(0,shown).map(item=><article key={item.id}><h3>{item.title}</h3><p className="muted small analytics-news-meta"><span>{date(item.published_at||item.issued_at)}</span>{item.source_name&&<span>{item.source_name}</span>}{statuses[item.legal_status||'']&&<span>{statuses[item.legal_status||'']}</span>}{matched.includes(item.id)&&<span>Liên quan {entity}</span>}</p>{item.summary&&<p className="muted small">{item.summary}</p>}{/^https?:\/\//.test(link(item))&&<a href={link(item)} target="_blank" rel="noreferrer">Nguồn gốc ↗</a>}</article>)}{!items.length&&<p className="muted small">Chưa có tin phù hợp trong kho hiện có.</p>}{items.length>shown&&<button className="btn ghost" onClick={()=>setShown(n=>n+6)}>Xem thêm {Math.min(6,items.length-shown)} tin</button>}{shown>6&&<button className="btn ghost" onClick={()=>setShown(6)}>Thu gọn</button>}</div>}
 </Card></div>
}
