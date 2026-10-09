import {useEffect,useRef,useState} from 'react'
import {Sparkles} from 'lucide-react'
import {loadInsight} from './client'
import {Card} from './ui'
import {SOURCE_LABELS} from './types'
import type {AnalyticsQuery,StrategicInsight,InsightItem,AnalyticsOverview} from './types'
export default function AiStrategicInsight({query,onResult,baseline,enabled=false,canRefresh=false,snapshot}:{query:AnalyticsQuery;onResult:(value:StrategicInsight|undefined,complete?:boolean)=>void;snapshot?:AnalyticsOverview;baseline?:StrategicInsight;enabled?:boolean;canRefresh?:boolean}){
  const [data,setData]=useState<StrategicInsight>(),[loading,setLoading]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0)
  const generation=useRef(0),manualRefresh=useRef(false)
  useEffect(()=>{
    const id=++generation.current;setData(baseline);setError('');const manual=manualRefresh.current,run=enabled||manual;manualRefresh.current=false;setLoading(run);onResult(baseline)
    if(!run)return
    loadInsight(query,manual,snapshot).then(value=>{if(generation.current===id){setData(value);onResult(value,true)}}).catch(e=>{if(generation.current===id)setError(e.message)}).finally(()=>{if(generation.current===id)setLoading(false)})
    return()=>{generation.current++}
  },[query,enabled,baseline,retry,onResult,snapshot])
  const item=(r:InsightItem,n:number)=>{
    const doc=data?.news?.find(d=>d.id===r.documentId)
    return <li key={n}>{r.detail} <small>({r.source==='regulatory'?'Tin / Pháp luật':SOURCE_LABELS[r.source]})</small>{doc&&/^https:\/\//.test(doc.source_url)&&<> <a href={doc.source_url} target="_blank" rel="noreferrer">Đối chiếu nguồn ↗</a></>}</li>
  }
  return <Card exportable={!!data} title="Đánh giá AI" hint="Nhận xét bám chủ thể, kỳ và nguồn đang xem; mở chi tiết để đối chiếu bằng chứng."><div className="analytics-insight-status"><small role="status"><Sparkles size={14}/> {loading?'Đang bổ sung nhận xét AI…':data?.method==='ai'?`${data.provider||'AI'} · ${data.model}`:data?'Nhận xét từ số liệu':'Đang chờ số liệu…'}</small><button className="analytics-link" disabled={loading||!canRefresh} onClick={()=>{manualRefresh.current=true;setRetry(n=>n+1)}}>Đánh giá lại</button></div>{data&&<><ul className="analytics-insight-summary">{(data.inference.length?data.inference:data.evidence).slice(0,2).map(item)}</ul>{data.actions.length>0&&<p className="analytics-next-action"><strong>Ưu tiên:</strong> {data.actions[0].detail}</p>}<details><summary>Bằng chứng và đề xuất{data.news?.length?` · ${data.news.length} nguồn tin`:''}</summary><div className="analytics-insight-main"><div><h3>Bằng chứng</h3><ul>{data.evidence.map(item)}</ul></div><div><h3>Đề xuất</h3><ul>{data.actions.map(item)}</ul></div></div>{data.inference.length>0&&<><h3>Suy luận</h3><ul>{data.inference.map(item)}</ul></>}{<><h3>Cần xác minh</h3><ul>{data.verification.map(item)}</ul>{data.reason&&<p className="muted small">{data.reason}</p>}{error&&<p role="alert">{error}</p>}</>}</details></>}{!data&&error&&<p role="alert">{error}</p>}</Card>
}
