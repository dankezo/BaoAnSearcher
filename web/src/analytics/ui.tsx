// Shadcn-style primitives built on the already approved Radix packages.
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { X } from 'lucide-react'
import { useId, type ReactNode } from 'react'
export function Dialog({open,onClose,title,children,className=''}:{open:boolean;onClose:()=>void;title:string;children:ReactNode;className?:string}){
  return <DialogPrimitive.Root open={open} onOpenChange={v=>{if(!v)onClose()}}><DialogPrimitive.Portal><DialogPrimitive.Overlay className="analytics-overlay"/><DialogPrimitive.Content className={`analytics-dialog analytics-app ${className}`} aria-describedby={undefined}><DialogPrimitive.Title>{title}</DialogPrimitive.Title><DialogPrimitive.Close className="analytics-close" aria-label="Đóng"><X size={18}/></DialogPrimitive.Close>{children}</DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root>
}
export const Tabs=TabsPrimitive.Root
export const TabsList=TabsPrimitive.List
export const TabsTrigger=TabsPrimitive.Trigger
export const cardId=(title:string)=>`analytics-${title.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/gi,'d').toLowerCase().replace(/[^a-z0-9]+/g,'-')}`
export function Card({title,hint,children,exportable=true}:{title:string;hint?:string;children:ReactNode;exportable?:boolean}){const hintId=useId();return <section id={cardId(title)} className="analytics-card" data-export-empty={!exportable||undefined}><h2>{title}{hint&&<span className="analytics-help-wrap"><button type="button" className="analytics-help" aria-label={`Giải thích: ${title}`} aria-describedby={hintId}>ⓘ</button><span id={hintId} role="tooltip" className="analytics-tooltip">{hint}</span></span>}</h2>{children}</section>}
