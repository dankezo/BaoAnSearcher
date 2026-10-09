import { createServer } from 'vite'
import { mkdirSync } from 'node:fs'
import { chromium } from 'file:///C:/Users/AD/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'

const out = 'D:/BaoAnSearcher/web/preview-output'
mkdirSync(out, { recursive: true })
const rows = [
  {id:1,tenThuoc:'Paracetamol 500 mg',soDangKy:'VD-DEMO-001',hoatChat:'Paracetamol',ngayHetHan:'2028-12-31',conHieuLuc:true, name:'Paracetamol 500 mg',registration:'VD-DEMO-001',unit_price:350,province:'Hà Nội',winner:'Công ty Dược Minh Họa',tender_no:'IB-DEMO-001',buyer:'Bệnh viện Đa khoa Minh Họa',bid_price:1250000000,close_date:'2026-11-20',hoatchat:'Paracetamol',sodk:'VD-DEMO-001',ten:'Paracetamol 500 mg',thanhtien:125000000,ten_tinh:'Hà Nội'},
  {id:2,tenThuoc:'Amoxicillin 500 mg',soDangKy:'VD-DEMO-002',hoatChat:'Amoxicillin',ngayHetHan:'2029-06-30',conHieuLuc:true,name:'Amoxicillin 500 mg',registration:'VD-DEMO-002',unit_price:1200,province:'Đà Nẵng',winner:'Công ty Dược Minh Họa',tender_no:'IB-DEMO-002',buyer:'Bệnh viện Minh Họa',bid_price:850000000,close_date:'2026-12-10',hoatchat:'Amoxicillin',sodk:'VD-DEMO-002',ten:'Amoxicillin 500 mg',thanhtien:85000000,ten_tinh:'Đà Nẵng'},
]
const content = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script>
const rows=${JSON.stringify(rows)};window.fetch=async(url,opts)=>{const path=String(url);let data={};if(path.includes('/search'))data={items:rows,total:2,page:0,size:100,hasMore:false};else if(path.includes('suggest'))data={items:[]};else if(path.includes('dm93'))data=[];return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}})};
</script><script type="module">import React from 'react';import {createRoot} from 'react-dom/client';import Dav from '/src/DavSection.tsx';import Msc from '/src/MscSection.jsx';import Vss from '/src/VssSection.jsx';import '/src/styles.css';const tab=new URLSearchParams(location.search).get('tab');const C=tab==='dav'?Dav:tab==='vss'?Vss:Msc;createRoot(document.getElementById('root')).render(React.createElement('main',{className:'page'},React.createElement(C,{localMode:true,selectedKind:'prices'})));</script></body></html>`
const shell = `<!doctype html><html><head><meta charset="utf-8"><title>Preview mobile</title><style>body{margin:0;padding:20px;background:#eef2f5;font:14px Arial;color:#172b3a}h1{font-size:20px;margin:0 0 8px}p{margin:0 0 16px;color:#52616b}.screens{display:flex;gap:16px;align-items:start}section{flex:0 0 390px}h2{font-size:15px;margin:0 0 8px}iframe{width:390px;height:850px;border:1px solid #dce3ea;border-radius:12px;background:white}</style></head><body><h1>Preview điện thoại · 390px</h1><p>Component thật sau chỉnh sửa · Dữ liệu minh họa · Chạm thẻ để xem chi tiết</p><div class="screens">${['dav','msc','vss'].map((tab,i)=>`<section><h2>${['Thuốc DAV','Đơn giá MSC','BHYT VSS'][i]}</h2><iframe src="/preview-content?tab=${tab}"></iframe></section>`).join('')}</div></body></html>`
const server = await createServer({root:process.cwd(),server:{host:'127.0.0.1',port:5190,strictPort:true},plugins:[{name:'mobile-preview',enforce:'pre',resolveId(id){if(/(?:^|\/)auth$/.test(id))return '\0preview-auth'},load(id){if(id==='\0preview-auth')return 'export const useAuth=()=>({user:null});'},configureServer(s){s.middlewares.use(async(req,res,next)=>{if(!req.url?.startsWith('/preview'))return next();res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await s.transformIndexHtml('/preview',req.url.startsWith('/preview-content')?content:shell))})}}]})
await server.listen()
const browser = await chromium.launch({headless:true,channel:'msedge'})
const page = await browser.newPage({viewport:{width:1260,height:1000}})
const errors=[];page.on('pageerror',e=>errors.push(e.message))
await page.goto('http://127.0.0.1:5190/preview')
for (const frame of page.frames().filter(f=>f.url().includes('/preview-content'))) await frame.locator('.result-card').first().waitFor()
await page.screenshot({path:out+'/mobile-preview.png',fullPage:true})
console.log(JSON.stringify({url:'http://127.0.0.1:5190/preview',image:out+'/mobile-preview.png',errors}))
await browser.close()
await new Promise(()=>{})
