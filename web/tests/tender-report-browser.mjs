// Isolated browser acceptance surface. Inputs are read-only VSS/DAV audit extracts.
import {createServer} from 'vite'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
const root=resolve('..'),inputs=Object.fromEntries(['Lacidipin','Lisinopril','Losartan'].map(key=>[key,JSON.parse(readFileSync(resolve(root,'outputs',`tender-audit-${key}.json`),'utf8'))]))
const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kiểm chứng báo cáo BHYT</title></head><body><div id="root"></div><script type="module">import React from 'react';import{createRoot}from'react-dom/client';import{AuthProvider}from'/src/auth';import Report from'/src/TenderMarketReport.tsx';import'/src/styles.css';createRoot(document.getElementById('root')).render(React.createElement(AuthProvider,null,React.createElement(Report,{localMode:true})));</script></body></html>`
const server=await createServer({root:process.cwd(),server:{port:5192,strictPort:true},plugins:[{name:'tender-report-acceptance',configureServer(s){s.middlewares.use(async(req,res,next)=>{
 if(req.url==='/api/tender/report'){
  let text='';for await(const chunk of req)text+=chunk;const q=JSON.parse(text)
  const found=inputs[q.keyword]||inputs.Lacidipin
  const key=q.searchField==='registration'?'regNumber':q.searchField==='name'?'brandName':'activeIngredient'
  const items=found.items.filter(item=>String(item[key]).toLowerCase().includes(q.keyword.toLowerCase()) && (!q.group||item.group===q.group) && item.date>=q.start && item.date<=q.end)
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...found,items}));return
 }
 if(req.url?.startsWith('/api/suggest')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({items:Object.keys(inputs)}));return}
 if(req.url!=='/report-test')return next()
 res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/report-test',html))
})}}]})
await server.listen();console.log('Report acceptance: http://localhost:5192/report-test')
