import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { useAuth } from './auth'
import { Dialog } from './analytics/ui'
import { saveResult } from './savedResultStore'
import './savedResults.css'

export default function SaveResultButton({source,defaultName,getSnapshot,disabled=false}) {
  const {user}=useAuth()
  const [open,setOpen]=useState(false),[name,setName]=useState(defaultName),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false)
  useEffect(()=>{setOpen(false);setSaved(false);setError('')},[user?.id])
  const close=()=>{if(!busy)setOpen(false)}
  async function save(event) {
    event.preventDefault();const owner=user?.id
    setBusy(true);setError('')
    try { const snapshot=await getSnapshot();await saveResult(source,name,snapshot,owner);window.dispatchEvent(new Event('baoan-saved-results-updated'));setSaved(true) }
    catch(e) {setError(e.message||'Chưa lưu được kết quả.')} finally {setBusy(false)}
  }
  return <><button type="button" className="btn ghost sm save-result-button" disabled={disabled||!user} onClick={()=>{setName(defaultName.slice(0,100));setSaved(false);setError('');setOpen(true)}}><Save size={14}/>Lưu kết quả</button>
    <Dialog open={open} onClose={close} title="Lưu kết quả theo tài khoản" className="save-result-dialog">
      {saved?<><p role="status">Đã lưu “{name.trim()}”. Xem lại trên mọi thiết bị tại Dữ liệu → Kết quả lưu.</p><div className="saved-actions"><button className="btn" onClick={()=>{setOpen(false);try{sessionStorage.setItem('baoan.data.saved','1')}catch{}window.dispatchEvent(new Event('baoan-open-saved-results'));window.dispatchEvent(new Event('baoan-open-data'))}}>Xem kết quả lưu</button><button className="btn ghost" onClick={close}>Đóng</button></div></>:<form onSubmit={save}><label>Tên kết quả<input required maxLength={100} value={name} disabled={busy} onChange={e=>setName(e.target.value)}/></label><p className="muted">Lưu bộ lọc và dữ liệu hiện tại. Nếu đã chọn dòng, chỉ lưu các dòng đã chọn; nếu chưa chọn, lưu toàn bộ kết quả theo bộ lọc.</p>{error&&<p role="alert" className="error-note">{error}</p>}<div className="saved-actions"><button type="submit" className="btn" disabled={busy||!name.trim()}>{busy?'Đang gom và lưu dữ liệu…':'Lưu'}</button><button type="button" className="btn ghost" onClick={close} disabled={busy}>Hủy</button></div></form>}
    </Dialog></>
}
