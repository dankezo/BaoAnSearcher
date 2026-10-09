import {useCallback,useState,type KeyboardEvent,type MouseEvent} from 'react'
import type {AnalyticsQuery,Mode,Role} from './types'
import EntityContextMenu from './EntityContextMenu'

export type EntityTargetQuery=Omit<AnalyticsQuery,'mode'>&{mode:Exclude<Mode,'macro'>;companyFocus?:string}
export interface EntityValueProps{
  value?:string|null
  parentQuery:AnalyticsQuery
  mode:'drug'|'company'|'territory'
  role?:Role
  field?:'ingredient'|'name'|'registration'|'province'|'facility'|'region'
  onContextMenu?:(query:EntityTargetQuery,event:MouseEvent<HTMLSpanElement>|KeyboardEvent<HTMLSpanElement>)=>void
  onRelated?:(query:EntityTargetQuery)=>void
  onNavigate?:(query:EntityTargetQuery)=>void
}
export function entityTargetQuery(parent:AnalyticsQuery,value:string,mode:EntityValueProps['mode'],role:Role='winner',field:EntityValueProps['field']='ingredient'):EntityTargetQuery{
  const query:EntityTargetQuery={...parent,mode,entity:value,role:mode==='company'?'all':role,entityField:mode==='drug'&&(field==='ingredient'||field==='name'||field==='registration')?field:'ingredient',territoryField:mode==='territory'&&(field==='province'||field==='facility'||field==='region')?field:'province',filters:{...parent.filters}}
  if(mode==='company'){query.companyFocus=role==='manufacturer'?'manufacturer':'business';query.entityMatch='contains'}
  else delete query.companyFocus
  return query
}
export default function EntityValue({value,parentQuery,mode,role='winner',field='ingredient',onContextMenu,onRelated}:EntityValueProps){
  const [menu,setMenu]=useState<{query:EntityTargetQuery;x:number;y:number}|null>(null)
  const closeMenu=useCallback(()=>setMenu(null),[])
  if(!value)return <>—</>
  const query=entityTargetQuery(parentQuery,value,mode,role,field)
  const openMenu=(event:MouseEvent<HTMLSpanElement>|KeyboardEvent<HTMLSpanElement>)=>{event.preventDefault();event.stopPropagation();if(onContextMenu){onContextMenu(query,event);return}const rect=event.currentTarget.getBoundingClientRect(),mouse=event as MouseEvent<HTMLSpanElement>;setMenu({query,x:mouse.clientX||rect.left,y:mouse.clientY||rect.bottom})}
  const keyDown=(event:KeyboardEvent<HTMLSpanElement>)=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10')openMenu(event)}
  return <>{value?<span className="analytics-entity-value" tabIndex={0} aria-haspopup="menu" title="Nhấp đúp để xem nội dung liên quan · chuột phải hoặc Shift+F10 để mở lựa chọn" onContextMenu={openMenu} onKeyDown={keyDown} onDoubleClick={event=>{event.preventDefault();event.stopPropagation();onRelated?.(query)}}>{value}</span>:<>—</>}{menu&&<EntityContextMenu menu={menu} onClose={closeMenu}/>}</>
}
