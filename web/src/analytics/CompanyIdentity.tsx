import {useEffect,useRef,useState} from 'react'
import {Building2,RefreshCw} from 'lucide-react'
import {request} from './client'
import {Card} from './ui'
import type {AnalyticsQuery} from './types'

type CompanyIdentityProfile={
  legalName:string;introduction?:string|null;taxId?:string|null;officeAddress?:string|null;factoryAddress?:string|null;address?:string|null
  officeProvince?:string|null;factoryProvince?:string|null;phone?:string|null;email?:string|null;website?:string|null;imageUrl?:string|null
  sourceUrls?:string[];checkedAt?:string|null;status?:string
}
type CompanyIdentityResponse={profiles:CompanyIdentityProfile[];reason?:string;matchedNames?:string[]}
const safeHttps=(value?:string|null)=>{
  if(!value)return undefined
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:undefined}catch{return undefined}
}
const dateLabel=(value?:string|null)=>{
  if(!value)return 'Chưa rõ'
  const date=new Date(value)
  return Number.isFinite(date.valueOf())?date.toLocaleString('vi-VN',{dateStyle:'medium',timeStyle:'short'}):value
}

export default function CompanyIdentity({query}:{query:AnalyticsQuery}){
  const [result,setResult]=useState<CompanyIdentityResponse>(),[selected,setSelected]=useState(''),[loading,setLoading]=useState(false),[refreshing,setRefreshing]=useState(false),[error,setError]=useState(''),[failedImage,setFailedImage]=useState('')
  const generation=useRef(0),controller=useRef<AbortController>()
  const companyQuery=query.mode==='company'&&query.entity.trim()?query:undefined
  const key=companyQuery?JSON.stringify({entity:companyQuery.entity,companyFocus:companyQuery.companyFocus,filters:companyQuery.filters}):''

  async function load(refresh:boolean,signal?:AbortSignal){
    if(!companyQuery)return
    const id=++generation.current
    if(!signal){controller.current?.abort();controller.current=new AbortController();signal=controller.current.signal}
    setError('');setRefreshing(refresh);if(!refresh)setLoading(true)
    try{
      const value=await request<CompanyIdentityResponse>('/api/analytics/company-profile',{query:companyQuery,refresh,legalName:refresh?result?.profiles?.find(p=>p.legalName+'|'+(p.taxId||'')===selected)?.legalName||result?.profiles?.[0]?.legalName:undefined},signal)
      if(generation.current!==id)return
      setResult({profiles:Array.isArray(value.profiles)?value.profiles:[],reason:value.reason,matchedNames:Array.isArray(value.matchedNames)?value.matchedNames:[]})
      setSelected('');setFailedImage('')
    }catch(e){if(generation.current===id&&(e as Error).name!=='AbortError')setError((e as Error).message||'Chưa tải được hồ sơ doanh nghiệp.')}
    finally{if(generation.current===id){setLoading(false);setRefreshing(false)}}
  }

  useEffect(()=>{
    generation.current++;controller.current?.abort();setResult(undefined);setSelected('');setError('');setFailedImage('')
    if(!companyQuery)return
    const abort=new AbortController();controller.current=abort
    void load(false,abort.signal)
    return()=>{generation.current++;abort.abort()}
  // `key` captures the company identity and filters while preserving the active query object.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[key])

  if(!companyQuery)return null
  const profiles=[...new Map((result?.profiles||[]).map(item=>[item.taxId||item.legalName,item])).values()]
  const selectedIndex=Math.max(0,profiles.findIndex(profile=>`${profile.legalName}|${profile.taxId||''}`===selected))
  const profile=profiles[selectedIndex]
  const profileKey=(value:CompanyIdentityProfile)=>`${value.legalName}|${value.taxId||''}`
  const imageUrl=safeHttps(profile?.imageUrl)
  const website=safeHttps(profile?.website)
  const sources=[...new Set((profile?.sourceUrls||[]).map(safeHttps).filter((url):url is string=>Boolean(url)))]
  const addresses:{label:string;value:string;province?:string|null}[]=[]
  if(profile?.officeAddress||profile?.officeProvince)addresses.push({label:'Địa chỉ đơn vị đăng ký / liên hệ',value:profile.officeAddress||'Chưa rõ địa chỉ',province:profile.officeProvince})
  if(profile?.factoryAddress||profile?.factoryProvince)addresses.push({label:'Nhà máy / cơ sở sản xuất',value:profile.factoryAddress||'Chưa rõ địa chỉ',province:profile.factoryProvince})
  if(profile?.address&&!profile.officeAddress&&!profile.factoryAddress)addresses.push({label:'Địa chỉ (chưa phân loại)',value:profile.address})
  return <Card title="Hồ sơ doanh nghiệp" hint="Thông tin nhận diện cần đối chiếu với hồ sơ pháp lý trước khi sử dụng.">
    {profiles.length>1&&<div className="analytics-company-choice"><label>Pháp nhân<select aria-label="Chọn pháp nhân" value={profile?profileKey(profile):''} onChange={event=>setSelected(event.target.value)}>{profiles.map((item,index)=><option key={`${profileKey(item)}-${index}`} value={profileKey(item)}>{item.legalName}{item.taxId?` · MST ${item.taxId}`:''}</option>)}</select></label><p className="analytics-company-scope">Có nhiều pháp nhân phù hợp. Chọn một hồ sơ để xem; thông tin giữa các tên không được gộp.</p></div>}
    <div className="analytics-company-actions"><button className="btn ghost" type="button" disabled={loading||refreshing} onClick={()=>void load(true)}><RefreshCw size={15}/>{refreshing?'Đang cập nhật…':'AI tra cứu hồ sơ web'}</button>{profile?.checkedAt&&<small>Kiểm tra lúc {dateLabel(profile.checkedAt)}</small>}</div>
    {loading&&!result&&<p role="status">Đang tra cứu hồ sơ doanh nghiệp…</p>}{error&&<p role="alert">{error}</p>}
    {profile&&<div className="analytics-company-identity-layout"><div className="analytics-company-image">{imageUrl&&failedImage!==`${profileKey(profile)}|${imageUrl}`?<img src={imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailedImage(`${profileKey(profile)}|${imageUrl}`)}/>:<><Building2 size={34} aria-hidden="true"/><small>Chưa có ảnh xác minh</small></>}</div><div className="analytics-company-content"><h3>{profile.legalName}</h3>{profile.status&&<small className="analytics-company-status">{profile.status==='web_verified'?'Đã đối chiếu web':profile.status==='source_verified'?'Địa chỉ từ hồ sơ DAV':'Cần xác minh'}</small>}{profile.taxId&&<p><strong>Mã số thuế:</strong> {profile.taxId}</p>}{profile.introduction&&<p>{profile.introduction}</p>}
      {addresses.length>0&&<div className="analytics-company-addresses">{addresses.map(item=><p key={item.label}><strong>{item.label}:</strong> {item.value}{item.province?` · ${item.province}`:''}</p>)}</div>}
      {(profile.phone||profile.email||website)&&<div className="analytics-company-contacts">{profile.phone&&<span>Điện thoại: {profile.phone}</span>}{profile.email&&<span>Email: {profile.email}</span>}{website&&<a href={website} target="_blank" rel="noreferrer">Website ↗</a>}</div>}
      {sources.length>0&&<p className="analytics-company-sources"><strong>Nguồn:</strong> {sources.map((url,index)=><span key={url}>{index>0?' · ':''}<a href={url} target="_blank" rel="noreferrer">Nguồn {index+1} ↗</a></span>)}</p>}
      <small>Đối chiếu thông tin với nguồn gốc trước khi dùng cho hồ sơ.</small>
    </div></div>}
    {!loading&&!profile&&<p className="muted">{result?.reason||error||'Chưa tìm thấy hồ sơ xác minh phù hợp.'}</p>}
    {!!result?.matchedNames?.length&&profiles.length===0&&result.matchedNames.length>1&&<p className="analytics-company-scope">Có nhiều tên doanh nghiệp cần phân biệt: {result.matchedNames.join(' · ')}. Không gộp thông tin giữa các pháp nhân.</p>}
    {profile&&(result?.reason||!sources.length)&&<p className="muted small">{result?.reason||`Trạng thái nguồn: ${profile.status||'chưa xác minh'}`}</p>}
  </Card>
}
