import {useEffect,useState} from 'react'
import {loadProducts} from './client'
import EntityValue from './EntityValue'
import {Card} from './ui'
import {money} from './Charts'
import {SOURCE_LABELS} from './types'
import type {AnalyticsQuery,DetailPage,Source} from './types'

export default function ProductRanking({query,source,onRelated}:{query:AnalyticsQuery;source:Source;onRelated:(query:AnalyticsQuery)=>void}){
 const [data,setData]=useState<DetailPage>(),[error,setError]=useState(''),[retry,setRetry]=useState(0)
 useEffect(()=>{let active=true;setData(undefined);setError('');loadProducts(query,source).then(value=>{if(active)setData(value)}).catch(reason=>{if(active)setError(reason.message)});return()=>{active=false}},[query,source,retry])
 return <Card title="Sản phẩm dẫn đầu" exportable={!!data?.items.length} hint="Top 30 theo giá trị trúng thầu của từng sản phẩm, hàm lượng, dạng bào chế, đơn vị, SĐK và nhóm. Công ty đăng ký đối chiếu hồ sơ DAV bằng SĐK.">
  {!data&&!error&&<p role="status">Đang tải xếp hạng sản phẩm…</p>}
  {error&&<p role="alert">{error} <button className="btn ghost" onClick={()=>setRetry(value=>value+1)}>Thử lại</button></p>}
  {!!data?.items.length&&<div className="analytics-table analytics-product-table" tabIndex={0} aria-label="Xếp hạng sản phẩm"><table><thead><tr><th>Sản phẩm</th><th>Hàm lượng</th><th>Dạng bào chế</th><th>Đơn vị</th><th className="analytics-sdk">SĐK</th><th>Nhóm</th><th>Công ty đăng ký</th><th>Giá trị trúng thầu</th></tr></thead><tbody>{data.items.map(row=><tr key={JSON.stringify([row.name,row.strength,row.form,row.unit,row.registration,row.group_key])}>
   <td><EntityValue value={row.name} mode="drug" field="name" parentQuery={query} onRelated={onRelated}/></td><td>{row.strength||'—'}</td><td>{row.form||'—'}</td><td>{row.unit||'—'}</td>
   <td className="analytics-sdk"><EntityValue value={row.registration} mode="drug" field="registration" parentQuery={query} onRelated={onRelated}/></td><td>{row.group_key?`N${row.group_key}`:'—'}</td>
   <td>{row.registrant?row.registrant.split('; ').map(name=><div key={name}><EntityValue value={name} mode="company" role="registrant" parentQuery={query} onRelated={onRelated}/></div>):<span className="muted">{data.registrantUnavailable?'DAV chưa sẵn sàng':'Chưa đối chiếu DAV'}</span>}</td><td><strong title={Number(row.amount||0).toLocaleString('vi-VN')+' ₫'}>{money(row.amount)}</strong></td>
  </tr>)}</tbody></table></div>}
  {data&&!data.items.length&&<p className="muted">Không có sản phẩm trong phạm vi này.</p>}
  <small className="muted">Top 30 · {SOURCE_LABELS[source]} · Công ty đăng ký: DAV</small>
 </Card>
}
