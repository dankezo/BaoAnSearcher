// Fallback relay: public VSS exports only, no database or browser bindings.
const SOURCE='https://quanlythuocv1.vss.gov.vn/kqdt/export';
const MAX_BYTES=10*1024*1024;
const reply=(status,error)=>Response.json({error},{status,headers:{'Cache-Control':'no-store'}});

Deno.serve(async request=>{
 const path=new URL(request.url).pathname;
 if(request.method==='GET'&&path==='/health')return Response.json({service:'BaoAn VSS export relay'});
 const key=Deno.env.get('VSS_EXPORT_RELAY_KEY');
 const encoder=new TextEncoder();const left=encoder.encode(request.headers.get('Authorization')||'');const right=encoder.encode('Bearer '+key);
 let diff=left.length^right.length;for(let i=0;i<right.length;i++)diff|=(left[i]||0)^right[i];
 if(!key||diff)return reply(401,'unauthorized');
 if(request.method!=='POST'||path!=='/vss/export')return reply(404,'not_found');
 let input;
 try{
  const reader=request.body?.getReader();if(!reader)throw Error();
  let size=0;const parts=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1024)throw Error();parts.push(value)}}finally{await reader.cancel()}
  const body=new Uint8Array(size);let offset=0;for(const part of parts){body.set(part,offset);offset+=part.length}
  input=JSON.parse(new TextDecoder().decode(body));
  if(!input||Array.isArray(input)||Object.keys(input).sort().join(',')!=='date,loai'||typeof input.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input.date)||!Number.isInteger(input.loai)||input.loai<1||input.loai>4)throw Error();
  const day=new Date(input.date+'T00:00:00Z');
  const today=new Date(new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Bangkok'}).format(new Date())+'T00:00:00Z');
  if(day.toISOString().slice(0,10)!==input.date||day>today||today-day>30*86400000)throw Error();
 }catch{return reply(400,'invalid_request')}
 try{
  const [year,month,day]=input.date.split('-');
  const url=new URL(SOURCE);url.searchParams.set('ngaycongbo',`${day}/${month}/${year}`);url.searchParams.set('loai',String(input.loai));
  const upstream=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(30000),headers:{'User-Agent':'Mozilla/5.0','Accept':'application/vnd.ms-excel,application/xml,*/*','Referer':'https://quanlythuocv1.vss.gov.vn/kqdt/chiTiet'}});
  if(upstream.status!==200||Number(upstream.headers.get('Content-Length'))>MAX_BYTES){await upstream.body?.cancel();return reply(502,'source_export_unavailable')}
  const reader=upstream.body.getReader();let size=0;const parts=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BYTES)throw Error();parts.push(value)}}finally{await reader.cancel()}
  const data=new Uint8Array(size);let offset=0;for(const part of parts){data.set(part,offset);offset+=part.length}
  const head=new TextDecoder().decode(data.slice(0,4096));
  if(!head.includes('Workbook')||head.slice(0,512).toLowerCase().includes('<html'))return reply(502,'source_export_unavailable');
  return new Response(data,{headers:{'Content-Type':'application/vnd.ms-excel','Cache-Control':'no-store'}});
 }catch{return reply(502,'source_export_unavailable')}
});
