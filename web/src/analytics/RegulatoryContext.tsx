import {useEffect,useState} from 'react'
import {cachedQuery} from '../queryCache'
import {Card} from './ui'
import type {AnalyticsQuery} from './types'
interface CatalogRow {hoatChat:string;hamLuong?:string;dangBaoChe?:string;duongDung?:string;ghiChu?:string;hangDB_I?:string;hangII?:string;hangIII_IV?:string;tramYT?:string}
const norm=(x:unknown)=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').toLowerCase().replace(/\s+/g,' ').trim()
async function catalog(name:string):Promise<CatalogRow[]>{
  return cachedQuery(`analytics:catalog:v1:${name}`,async()=>{const r=await fetch(`${import.meta.env.BASE_URL}data/${name}.json`);if(!r.ok)throw new Error('Danh mục chưa sẵn sàng.');return r.json()},{freshMs:86400000,staleMs:86400000})
}
export default function RegulatoryContext({query}:{query:AnalyticsQuery}){
  const [dm,setDm]=useState<CatalogRow[]>([]),[bhyt,setBhyt]=useState<CatalogRow[]>([]),[error,setError]=useState('')
  useEffect(()=>{let live=true;Promise.all([catalog('dm93'),catalog('tt20_bhyt')]).then(([a,b])=>{if(live){setDm(a);setBhyt(b)}}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[])
  const dmMatches=dm.filter(r=>norm(r.hoatChat)===norm(query.entity))
  const bhytMatches=bhyt.filter(r=>norm(r.hoatChat)===norm(query.entity))
  const exact=dmMatches.filter(r=>query.filters.strength&&query.filters.form&&norm(r.hamLuong)===norm(query.filters.strength)&&norm(r.dangBaoChe)===norm(query.filters.form))
  return <div data-analytics-context><Card title="DM93 và điều kiện BHYT" exportable={!!(dmMatches.length||bhytMatches.length)}>{error&&<p>{error}</p>}<p>{exact.length?'Đối chiếu đủ hoạt chất, hàm lượng và dạng bào chế trong danh mục nội bộ.':dmMatches.length?'Có dòng cùng hoạt chất; cần chọn hàm lượng và dạng bào chế để đối chiếu đủ tọa độ.':'Chưa xác định đối chiếu DM93 phù hợp.'}</p><p className="muted">TT 03/2024 · danh mục nội bộ, cần kiểm tra hiệu lực và hồ sơ gốc. Chưa kết luận hạn chế thuốc nhập khẩu.</p>{dmMatches.map((r,i)=><span className="analytics-chip" key={i}>{r.hamLuong} · {r.dangBaoChe}</span>)}{bhytMatches.map((r,i)=><div key={i}><strong>{r.hoatChat} · {r.duongDung}</strong><p>ĐB–I: {r.hangDB_I||'—'} / II: {r.hangII||'—'} / III–IV: {r.hangIII_IV||'—'} / Trạm YT: {r.tramYT||'—'}</p>{r.ghiChu&&<p>{r.ghiChu}</p>}</div>)}<p className="muted small">TT20 là dữ liệu danh mục hiện có; đối chiếu văn bản cập nhật trước khi kết luận thanh toán.</p></Card></div>
}
