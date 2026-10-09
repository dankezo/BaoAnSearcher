import {useEffect,useMemo,useRef,useState} from 'react'
import {ResponsiveContainer,LineChart,Line,XAxis,YAxis,Tooltip,CartesianGrid,BarChart,Bar,PieChart,Pie,Cell} from 'recharts'
import {Card} from './ui'
import {SOURCE_LABELS} from './types'
import type {SourceStats,Source,AggregateRow,AnalyticsQuery} from './types'
export const COLORS=['#155e75','#2563eb','#14b8a6','#a855f7','#f59e0b','#ef4444']
export const money=(n:unknown)=>n==null?'—':new Intl.NumberFormat('vi-VN',{notation:'compact',maximumFractionDigits:2}).format(Number(n))+' ₫'
const exactMoney=(n:number)=>new Intl.NumberFormat('vi-VN',{maximumFractionDigits:20}).format(n)+' ₫'
function donutLabel({cx,cy,midAngle,outerRadius,innerRadius,percent,value}:{cx?:number;cy?:number;midAngle?:number;outerRadius?:number;innerRadius?:number;percent?:number;value?:number|string}){
  if(cx==null||cy==null||midAngle==null||outerRadius==null||percent==null||value==null||percent<.12)return null
  const angle=-midAngle*Math.PI/180,radius=((innerRadius||outerRadius*.65)+outerRadius)/2,x=cx+radius*Math.cos(angle),y=cy+radius*Math.sin(angle)
  const rounded=new Intl.NumberFormat('vi-VN',{notation:'compact',maximumFractionDigits:0}).format(Number(value))
  return <g pointerEvents="none" style={{filter:'drop-shadow(0 1px 1px #0008)'}}><text x={x} y={y-2} textAnchor="middle" fontSize={9} fontWeight={700} fill="#fff">{rounded}</text><text x={x} y={y+9} textAnchor="middle" fontSize={8} fill="#fff">{Math.round(percent*100)}%</text></g>
}
const dateLabel=(value?:string)=>value?new Intl.DateTimeFormat('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'UTC'}).format(new Date(`${value.slice(0,10)}T00:00:00Z`)):''
const rangeLabel=(start?:string,end?:string)=>start||end?` (${dateLabel(start)}–${dateLabel(end)})`:''
export const count=(n:unknown)=>n==null?'—':new Intl.NumberFormat('vi-VN',{maximumFractionDigits:3}).format(Number(n))
export function series(rows:AggregateRow[]){
  const points=new Map<string,Record<string,string|number>>()
  for(const row of rows.filter(r=>r.period==='current'&&r.kind==='month'&&r.label))points.set(row.label!,{month:row.label!,total:Number(row.amount||0)})
  for(const row of rows.filter(r=>r.period==='current'&&r.kind==='month_group'&&r.label)){
    const [month,group]=row.label!.split('|');const point=points.get(month);if(point&&/^[1-5]$/.test(group))point[`N${group}`]=Number(row.amount||0)
  }
  return [...points.values()].sort((a,b)=>String(a.month).localeCompare(String(b.month)))
}
export function Trend({stats,source}:{stats:SourceStats;source:Source}){
  const [group,setGroup]=useState(''),[month,setMonth]=useState(''),container=useRef<HTMLDivElement>(null)
  const reset=()=>{setGroup('');setMonth('')}
  useEffect(reset,[stats.rows])
  useEffect(()=>{if((!group&&!month)||typeof document==='undefined')return;const clear=(event:PointerEvent)=>{if(!container.current?.contains(event.target as Node))reset()};document.addEventListener('pointerdown',clear);return()=>document.removeEventListener('pointerdown',clear)},[group,month])
  const data=useMemo(()=>series(stats.rows),[stats.rows])
  const breakdown=stats.rows.filter(r=>r.kind===(month?'unit_month':'price_coordinate')&&r.period==='current'&&(!month||r.label?.startsWith(month+'|'))).map(r=>({...r,label:month?r.label?.split('|').slice(1).join('|')||'':r.label})).filter(r=>r.label?.split(' · ').length===5)
  const visibleBreakdown=breakdown.filter(r=>!group||r.label?.split(' · ')[3]===group)
  const groupRows=stats.rows.filter(r=>r.kind===(month?'month_group':'group')&&r.period==='current'&&(!month||r.label?.startsWith(month+'|'))).map(r=>({...r,label:month?r.label?.split('|').slice(1).join('|'):r.label}))
  const groupTotal=groupRows.reduce((sum,r)=>sum+Number(r.amount||0),0)
  const selectGroup=(value:string)=>{if(group===value)reset();else setGroup(value)}
  const isVss=source==='vss'
  return <Card exportable={!!(data.length||breakdown.length||groupRows.length)} title={`${SOURCE_LABELS[source]} · biến động theo tháng`} hint="Giá trị trúng thầu theo tháng, đơn vị trục tung tỷ đồng. Bấm nhóm hoặc tháng để chọn; bấm lại, bấm ra ngoài, nhấp đúp hoặc Escape để xem tổng.">
    <div ref={container} className="analytics-trend" onDoubleClick={reset} onKeyDown={event=>{if(event.key==='Escape')reset()}} onClick={event=>{if(!(event.target as Element).closest('button,.recharts-dot,.recharts-curve'))reset()}}>
      <div className="analytics-chart">{data.length?<ResponsiveContainer width="100%" height={270}><LineChart data={data} onClick={event=>{if(event?.activeLabel)setMonth(value=>value===String(event.activeLabel)?'':String(event.activeLabel));else reset()}}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="month"/><YAxis tickFormatter={n=>count(Number(n)/1e9)} width={48}/><Tooltip formatter={v=>money(v)} labelFormatter={v=>`Tháng ${v} · giá trị trúng thầu`}/><Line dataKey="total" name="Tổng" stroke={COLORS[0]} strokeWidth={3} dot={{r:3}} onClick={reset}/>{[1,2,3,4,5].map((n,i)=><Line key={n} dataKey={`N${n}`} stroke={COLORS[i+1]} strokeOpacity={!group||group===String(n)?0.8:0.2} strokeWidth={group===String(n)?3:1.5} dot={{r:3}} onClick={()=>selectGroup(String(n))}/>)}</LineChart></ResponsiveContainer>:<p className="analytics-empty-chart">Chưa có dữ liệu theo tháng.</p>}</div>
      <div className="analytics-math">
        <div className="analytics-trend-heading"><h3>{isVss?'Cơ cấu giá trị trúng thầu theo nhóm':'Cơ cấu quy cách'} · {group?`Nhóm ${group}`:'tất cả nhóm'} · {month||'toàn kỳ'}</h3><div className="analytics-group-dots" role="group" aria-label={`Chọn nhóm ${SOURCE_LABELS[source]}`}><button type="button" aria-pressed={!group&&!month} onClick={reset}>Tổng</button>{[1,2,3,4,5].map((n,i)=><button type="button" key={n} aria-pressed={group===String(n)} onClick={()=>selectGroup(String(n))}><i style={{background:COLORS[i+1]}}/>N{n}</button>)}</div></div>
        {month&&<button className="analytics-link small" onClick={()=>setMonth('')}>Xem toàn kỳ</button>}
        {isVss?(groupRows.length?<div className="analytics-table"><table><thead><tr><th>Nhóm</th><th>Giá trị trúng thầu</th><th>Tỷ trọng</th><th>Bản ghi</th></tr></thead><tbody>{groupRows.filter(r=>!group||r.label===group).sort((a,b)=>Number(b.amount||0)-Number(a.amount||0)).map(r=><tr key={r.label||'unknown'}><td>{r.label?`Nhóm ${r.label}`:'Chưa xác định'}</td><td><strong>{money(r.amount)}</strong></td><td>{groupTotal>0?count(Number(r.amount||0)/groupTotal*100)+'%':'—'}</td><td>{count(r.count)}</td></tr>)}</tbody></table></div>:<p className="analytics-empty-chart">Chưa có cơ cấu nhóm trong phạm vi này.</p>):visibleBreakdown.length?<div className="analytics-table"><table><thead><tr><th>Hoạt chất · hàm lượng · dạng</th><th>Nhóm</th><th>Đơn vị</th><th>Số lượng</th><th>Đơn giá</th><th>Giá trị</th></tr></thead><tbody>{visibleBreakdown.map(r=>{const [ingredient,strength,form,g,unit]=r.label!.split(' · ');const qty=Number(r.priced_quantity),amount=Number(r.priced_amount);return <tr key={r.label}><td>{ingredient} · {strength} · {form}</td><td>{g}</td><td>{unit}</td><td>{count(qty)}</td><td>{qty>0?money(amount/qty):'—'}</td><td><strong>{money(amount)}</strong></td></tr>})}</tbody></table></div>:<p className="analytics-empty-chart">Chưa có cơ cấu quy cách cho lựa chọn này.</p>}
      </div>
    </div>
  </Card>
}
export function PriceComparison({stats,query}:{stats:SourceStats;query?:AnalyticsQuery}){
  const units=stats.rows.filter(r=>r.kind==='unit'&&r.label).reduce<Record<string,{current:number|null;previous:number|null}>>((out,row)=>{const amount=Number(row.amount);if(!Number.isFinite(amount))return out;const item=out[row.label!]||(out[row.label!]={current:null,previous:null});item[row.period]=amount;return out}, {})
  const choices=Object.entries(units).map(([name,values])=>({name,...values})).sort((a,b)=>(b.current||0)-(a.current||0))
  const [selected,setSelected]=useState('')
  useEffect(()=>setSelected(''),[stats.rows])
  const container=useRef<HTMLDivElement>(null)
  useEffect(()=>{if(!selected||typeof document==='undefined')return;const reset=(event:PointerEvent)=>{if(!container.current?.contains(event.target as Node))setSelected('')};document.addEventListener('pointerdown',reset);return()=>document.removeEventListener('pointerdown',reset)},[selected])
  const selectUnit=(name:string)=>setSelected(value=>value===name?'':name)
  const current=choices.filter(r=>r.current!==null).map(r=>({name:r.name,value:r.current as number}))
  const previous=choices.filter(r=>r.previous!==null).map(r=>({name:r.name,value:r.previous as number}))
  const item=choices.find(r=>r.name===selected)||{name:'Tổng',current:current.length?current.reduce((sum,r)=>sum+r.value,0):null,previous:previous.length?previous.reduce((sum,r)=>sum+r.value,0):null}
  const change=item&&item.current!==null&&item.previous!==null&&item.previous>0?(item.current!-item.previous!)/item.previous!*100:null
  const delta=change===null?null:{value:change,color:change>0?'#15803d':change<0?'#b91c1c':'#475569',label:change>0?'tăng':change<0?'giảm':'không đổi'}
  const unitDonut=(title:string,data:{name:string;value:number}[],range:string)=><section className={`analytics-unit-chart ${title!=='Kỳ đối chiếu'?'analytics-unit-current':''}`}><h3>{title}<small>{range}</small></h3>{data.length?<div className="analytics-donut-layout"><ResponsiveContainer width="100%" height={190}><PieChart><Pie isAnimationActive={false} data={data} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={0} stroke="none" labelLine={false} label={donutLabel} onClick={entry=>selectUnit(String(entry.name))}>{data.map(r=><Cell key={r.name} stroke="none" fill={COLORS[choices.findIndex(c=>c.name===r.name)%COLORS.length]} fillOpacity={!selected||selected===r.name?1:.5}/>)}</Pie><Tooltip formatter={v=>exactMoney(Number(v))}/></PieChart></ResponsiveContainer><div className="analytics-donut-legend" aria-label={`${title} theo đơn vị`}>{data.map(r=><button type="button" className={`analytics-legend-button ${selected===r.name?'selected':''}`} key={r.name} aria-pressed={selected===r.name} onClick={()=>selectUnit(r.name)}><i style={{background:COLORS[choices.findIndex(c=>c.name===r.name)%COLORS.length]}}/>{r.name}<strong>{exactMoney(r.value)}</strong><small>{count(r.value/(data.reduce((sum,x)=>sum+x.value,0)||1)*100)}%</small></button>)}</div></div>:<p className="analytics-empty-chart">Chưa có dữ liệu kỳ này.</p>}</section>
  return <Card exportable={!!choices.length} title="Cơ cấu giá trị trúng thầu theo đơn vị" hint="Phân phối giá trị trúng thầu theo đơn vị tính. Chọn một miếng hoặc dòng chú giải để xem biến động của riêng đơn vị đó; đây không phải doanh thu đã ghi nhận."><div ref={container} onDoubleClick={()=>setSelected('')} onClick={event=>{if(!(event.target as Element).closest('.analytics-legend-button,.recharts-pie-sector'))setSelected('')}} onKeyDown={event=>{if(event.key==='Escape')setSelected('')}}>{choices.length?<><div className="analytics-unit-comparison">{query?.months!=='all'&&unitDonut('Kỳ đối chiếu',previous,rangeLabel(query?.previousStart,query?.previousEnd))}{unitDonut(query?.months==='all'?'Toàn bộ thời gian':'Kỳ hiện tại',current,query?.months==='all'?` (đến ${dateLabel(query?.end)})`:rangeLabel(query?.start,query?.end))}</div><div className="analytics-unit-delta"><strong>{item.name}</strong><span>Kỳ trước: {item.previous===null?'—':exactMoney(item.previous)} · Kỳ hiện tại: {item.current===null?'—':exactMoney(item.current)}</span>{delta?<strong style={{color:delta.color}}>{delta.value>0?'+':''}{count(delta.value)}% · {delta.label}</strong>:<span>Chưa có cơ sở tính tăng trưởng.</span>}</div></>:<p className="analytics-empty-chart">Chưa có cơ cấu giá trị theo đơn vị cho hai kỳ.</p>}</div></Card>
}
export function GroupChart({stats}:{stats:SourceStats}){
  const [selected,setSelected]=useState(''),container=useRef<HTMLDivElement>(null)
  const selectGroup=(name:string)=>setSelected(value=>value===name?'':name)
  useEffect(()=>{if(!selected||typeof document==='undefined')return;const clear=(event:PointerEvent)=>{if(!container.current?.contains(event.target as Node))setSelected('')};document.addEventListener('pointerdown',clear);return()=>document.removeEventListener('pointerdown',clear)},[selected])
  useEffect(()=>setSelected(''),[stats.rows])
  const data=stats.rows.filter(r=>r.kind==='group'&&r.period==='current').map(r=>({name:r.label?`Nhóm ${r.label}`:'Chưa xác định',value:Number(r.amount||0)}))
  const total=data.reduce((sum,r)=>sum+r.value,0)
  return <Card exportable={!!data.length} title="Cơ cấu nhóm kỹ thuật" hint="Tỷ trọng giá trị trúng thầu theo nhóm kỹ thuật trong kỳ, bao gồm nhóm chưa xác định.">{data.length?<div ref={container} className="analytics-donut-layout analytics-group-donut" onDoubleClick={()=>setSelected('')} onKeyDown={event=>{if(event.key==='Escape')setSelected('')}} onClick={event=>{if(!(event.target as Element).closest('.analytics-legend-button,.recharts-pie-sector'))setSelected('')}}><ResponsiveContainer width="100%" height={220}><PieChart><Pie isAnimationActive={false} data={data} dataKey="value" nameKey="name" innerRadius={56} outerRadius={84} paddingAngle={0} stroke="none" labelLine={false} label={donutLabel} onClick={entry=>selectGroup(String(entry.name))}>{data.map(r=><Cell key={r.name} stroke="none" fill={COLORS[Math.max(0,Number(r.name.replace('Nhóm ',''))-1)]||'#64748b'} fillOpacity={!selected||selected===r.name?1:.5}/>)}</Pie><Tooltip formatter={v=>exactMoney(Number(v))}/></PieChart></ResponsiveContainer><div className="analytics-donut-legend" aria-label="Giá trị và tỷ trọng theo nhóm">{data.map(r=><button type="button" className={`analytics-legend-button ${selected===r.name?'selected':''}`} key={r.name} aria-pressed={selected===r.name} onClick={()=>selectGroup(r.name)}><i style={{background:COLORS[Math.max(0,Number(r.name.replace('Nhóm ',''))-1)]||'#64748b'}}/><span>{r.name}</span><strong>{exactMoney(r.value)}</strong><small>{total>0?`${count(r.value/total*100)}%`:'—'}</small></button>)}</div></div>:<p>Chưa có nhóm kỹ thuật phù hợp.</p>}</Card>
}
export function CompanyGroups({stats}:{stats:SourceStats}){
  return <GroupChart stats={stats}/>
}
export function TenderChart({stats}:{stats:SourceStats}){
  const data=stats.rows.filter(r=>r.kind==='month'&&r.period==='current').map(r=>({month:r.label,value:Number(r.amount||0),count:Number(r.count)}))
  return <Card exportable={!!data.length} title="Nhịp gói thầu MSC" hint="Số gói công bố theo tháng trong phạm vi đã chọn; mỗi mã gói được tính một lần.">{data.length?<><div className="analytics-chart"><ResponsiveContainer width="100%" height={180}><BarChart data={data} margin={{top:20,right:6,bottom:0,left:0}}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="month"/><YAxis allowDecimals={false}/><Tooltip formatter={v=>count(v)} labelFormatter={v=>`Tháng ${v}`}/><Bar dataKey="count" name="Số bản ghi gói thầu" fill={COLORS[0]} label={{position:'top',formatter:v=>count(v)}}/></BarChart></ResponsiveContainer></div></>:<p className="analytics-empty-chart">Chưa có dữ liệu nhịp gói thầu.</p>}{stats.linkedTenderCoverage&&<p className="muted small">{stats.linkedTenderCoverage}</p>}{stats.rows.filter(r=>r.kind==='status'&&r.period==='current'&&r.label).map(r=><span className="analytics-chip" key={r.label}>{r.label}: {count(r.count)}</span>)}</Card>
}
