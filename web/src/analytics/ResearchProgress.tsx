import {useEffect,useState} from 'react'
import {Pill} from 'lucide-react'
import {SOURCE_LABELS,type Source,type AnalyticsProgress} from './types'

export default function ResearchProgress({loading,researching,profiling=false,complete,error,sources=[],queries={}}:{loading:boolean;researching:boolean;profiling?:boolean;complete:boolean;error:boolean;sources?:Source[];queries?:Partial<Record<Source,AnalyticsProgress>>}){
  const [elapsed,setElapsed]=useState(0)
  const busy=loading||researching||profiling
  useEffect(()=>{
    setElapsed(0)
    if(!busy)return
    const started=Date.now(),timer=setInterval(()=>setElapsed(Math.floor((Date.now()-started)/1000)),1000)
    return()=>clearInterval(timer)
  },[loading,researching,profiling])
  if(!busy&&!complete&&!error)return null
  const sourceNames=Object.keys(SOURCE_LABELS) as Source[]
  const waiting=sourceNames.filter(source=>!sources.includes(source)).map(source=>SOURCE_LABELS[source]).join(' · ')
  const finished=Object.values(queries).reduce((sum,item)=>sum+(item?.completed||0),0)
  const total=Object.values(queries).reduce((sum,item)=>sum+(item?.total||0),0)
  const plansKnown=sourceNames.every(source=>queries[source]||sources.includes(source))
  const done=complete&&!busy&&!error
  const message=loading?`Đã xử lý ${sources.length}/4 nguồn · đang chờ ${waiting||'hoàn tất báo cáo'}`:researching?`Đang viết đánh giá AI${profiling?' và tra cứu hồ sơ doanh nghiệp':''}`:profiling?'Đang tra cứu hồ sơ doanh nghiệp':error?'Có phần chưa hoàn tất · có thể thử lại':'Nghiên cứu hoàn tất'
  return <div className="analytics-research-progress" role="status" aria-live="polite" data-export-pending={busy||undefined}>
    <Pill size={19} className={busy?'research-pill spinning':'research-pill'} aria-hidden="true"/>
    <strong>{done?'100%':loading&&total?`${finished}/${total}`:loading?'Dữ liệu':researching?'AI':profiling?'Hồ sơ':'Cần thử lại'}</strong>
    <progress value={done?1:loading&&plansKnown&&total?finished:undefined} max={done?1:total||1} aria-label={loading?'Truy vấn tổng hợp hoàn tất':'Tiến trình nghiên cứu'}/>
    <span>{message}<small>{loading&&total?`${finished}/${total} truy vấn tổng hợp đã hoàn tất · `:''}{busy?`Đã chờ ${elapsed} giây`:done?'Sẵn sàng lưu vào túi dữ liệu':'Số liệu đã tải vẫn được giữ'}</small>
      {loading&&<small>{sourceNames.map(source=>`${SOURCE_LABELS[source]}: ${sources.includes(source)?'đã xử lý':queries[source]?`${queries[source]!.completed}/${queries[source]!.total}`:'đang chuẩn bị'}`).join(' · ')}</small>}
    </span>
  </div>
}
