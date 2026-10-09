import {useEffect,useRef} from 'react'
import {createPortal} from 'react-dom'
import {openAnalytics} from './navigation'

export default function EntityContextMenu({menu,onClose}){
 const root=useRef(null)
 useEffect(()=>{
  const previous=document.activeElement
  root.current?.querySelector('button')?.focus()
  const close=e=>{if(!root.current?.contains(e.target))onClose()}
  const key=e=>{if(e.key==='Escape'){e.preventDefault();onClose()}}
  window.addEventListener('pointerdown',close);window.addEventListener('keydown',key);window.addEventListener('scroll',onClose,true);window.addEventListener('resize',onClose)
  return()=>{window.removeEventListener('pointerdown',close);window.removeEventListener('keydown',key);window.removeEventListener('scroll',onClose,true);window.removeEventListener('resize',onClose);if(previous?.isConnected)previous.focus({preventScroll:true})}
 },[onClose])
 return createPortal(<div ref={root} className="analytics-entity-menu" role="menu" aria-label="Phân tích đối tượng" style={{left:Math.max(8,Math.min(menu.x,window.innerWidth-288)),top:Math.max(8,Math.min(menu.y,window.innerHeight-112))}}><strong>{menu.query.entity}</strong><button type="button" role="menuitem" onClick={()=>{openAnalytics(menu.query);onClose()}}>Phân tích · {menu.query.mode==='company'?(menu.query.role==='manufacturer'?'Nhà sản xuất':menu.query.role==='registrant'?'Đơn vị đăng ký':'Nhà thầu'):menu.query.mode==='territory'?(menu.query.territoryField==='facility'?'Cơ sở y tế':menu.query.territoryField==='region'?'Khu vực':'Tỉnh / Thành phố'):menu.query.entityField==='registration'?'Số đăng ký':menu.query.entityField==='name'?'Thuốc':'Hoạt chất'}</button></div>,document.body)
}
