import type {AnalyticsQuery} from './types'

// Preserve the rendered report, including vector charts and source links.
export function reportHtml(root:HTMLElement,query:AnalyticsQuery,print=false,snapshot=false):string{
  if(root.querySelector('[data-export-pending]'))throw new Error('Đợi các mục chi tiết tải xong trước khi xuất báo cáo.')
  const clone=root.cloneNode(true) as HTMLElement
  const originals=[...root.querySelectorAll<HTMLElement>('*')],copies=[...clone.querySelectorAll<HTMLElement>('*')]
  const liveUrl=new URL(window.location.pathname,window.location.origin)
  liveUrl.hash=window.location.hash
  liveUrl.searchParams.set('analyticsReport',JSON.stringify(query))
  for(let i=0;i<originals.length;i++){
    const original=originals[i],copy=copies[i]
    if(original instanceof HTMLSelectElement){copy.replaceWith(document.createTextNode(original.selectedOptions[0]?.text||''));continue}
    if(original instanceof HTMLInputElement){copy.replaceWith(document.createTextNode(original.value));continue}
    if(original.classList.contains('recharts-responsive-container')){
      copy.style.height=Math.min(original.clientHeight,print?150:original.clientHeight)+'px';copy.style.minWidth='0'
      const svg=original.querySelector('svg.recharts-surface')
      if(svg){
        const vector=svg.cloneNode(true) as SVGSVGElement
        vector.setAttribute('xmlns','http://www.w3.org/2000/svg');vector.style.fontFamily=getComputedStyle(svg).fontFamily;vector.style.fontSize=getComputedStyle(svg).fontSize
        const chart=document.createElement('img');chart.alt='Biểu đồ';chart.dataset.analyticsChart='true'
        chart.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(vector))
        chart.style.cssText='display:block;width:100%;height:100%;object-fit:contain'
        copy.replaceChildren(chart)
      }
    }
    if(!print)continue
    if(original.matches('.analytics-table,.table-wrap,.mobile-table-view,.analytics-ranking,.analytics-donut-legend,.analytics-related-news-list')){
      copy.style.setProperty('max-height','none','important');copy.style.setProperty('height','auto','important');copy.style.overflow='visible'
      const table=copy.querySelector('table'),rows=table?[...table.querySelectorAll('tbody tr')]:[...copy.children]
      const limit=original.classList.contains('analytics-related-news-list')?2:original.closest('.analytics-math')?3:original.matches('.analytics-ranking,.analytics-product-table')?4:5
      if(rows.length>limit){rows.slice(limit).forEach(row=>row.remove());const more=document.createElement('p');more.className='analytics-export-more';more.textContent=`Hiển thị ${limit}/${rows.length} dòng trong bản in. `;const link=document.createElement('a');const card=original.closest<HTMLElement>('.analytics-card');if(card?.id)liveUrl.searchParams.set('analyticsSection',card.id);link.href=liveUrl.toString();link.textContent='Xem toàn bộ trên ứng dụng ↗';more.append(link);copy.after(more)}
    }
  }

  clone.querySelectorAll('.analytics-filter,.analytics-report-tabs,.analytics-context-actions,.analytics-help-wrap,[role="alert"],[role="status"],.analytics-guidance,.analytics-trend-heading label').forEach(node=>node.remove())
  if(print)clone.querySelectorAll('[data-export-empty],details:not([open])').forEach(node=>node.remove())
  else if(!snapshot)clone.querySelectorAll('details').forEach(node=>node.setAttribute('open',''))
  clone.querySelectorAll('button').forEach(button=>{
    if(button.classList.contains('analytics-legend-button')){const span=document.createElement('div');span.className=button.className;span.append(...button.childNodes);button.replaceWith(span)}
    else if(snapshot){const span=document.createElement('span');span.className=button.className;span.append(...button.childNodes);button.replaceWith(span)}else button.remove()
  })
  clone.querySelectorAll('.analytics-controls').forEach(node=>node.remove())
  if(print)clone.querySelectorAll('.analytics-math td:first-child').forEach(cell=>{const text=cell.textContent||'';if(text.length>110){cell.textContent=text.slice(0,107)+'…';cell.setAttribute('title',text)}})
  clone.querySelectorAll('.analytics-grid,.analytics-detail-grid,[data-analytics-context]').forEach(node=>{if(!node.children.length)node.remove()})
  const styles=[...document.styleSheets].map(sheet=>{try{return [...sheet.cssRules].map(rule=>rule.cssText).join('\n').replace(/url\((['"]?)([^)'"\s]+)\1\)/g,(_match,_quote,value)=>`url("${new URL(value,sheet.href||document.baseURI).href}")`)}catch{return ''}}).join('\n')
  const extra=`
    :root{color-scheme:light}*{box-sizing:border-box;animation:none!important;transition:none!important}html,body{height:auto!important;overflow:visible!important;background:white!important}
    body{margin:0;padding:${snapshot?0:24}px;color:#172b3a;font-family:${snapshot?getComputedStyle(root).fontFamily:'Arial,sans-serif'}}${snapshot?'':'.analytics-app{display:grid;gap:14px;max-width:1180px;margin:auto}'}
    .analytics-card{min-width:0}.analytics-card h2{line-height:1.35}.analytics-export-more{display:block;margin-top:6px;font-size:11px;color:#155e75}
    .recharts-surface{max-width:100%;height:auto}${snapshot?'':'.analytics-report{display:grid;gap:14px}.analytics-heading{display:block}'}
    ${print?`.analytics-print-scroll,.analytics-table,.analytics-math,.analytics-ranking,.analytics-donut-legend{overflow:visible!important;max-height:none!important}.analytics-table table{table-layout:fixed}.analytics-table th,.analytics-table td{min-width:0!important;width:auto!important;overflow-wrap:anywhere;padding:4px!important;font-size:9px!important}.analytics-table th{position:static}.analytics-card{break-inside:avoid;box-shadow:none}.analytics-card h2,.analytics-card h3{break-after:avoid}.analytics-card tr{break-inside:avoid}.analytics-empty-chart{display:none}.analytics-math th:first-child{width:36%!important}.analytics-ranking li{padding:6px}.analytics-unit-comparison,.analytics-unit-chart{break-inside:avoid}`:snapshot?'':`.analytics-table,.analytics-math,.analytics-ranking,.analytics-related-news,.analytics-related-news-list,.analytics-donut-legend{max-height:none!important;overflow:visible!important}.analytics-detail-grid{grid-template-columns:1fr!important}`}
    @page{size:A4 landscape;margin:10mm}@media print{body{padding:0}.analytics-app{width:100%;max-width:none;font-size:11px;line-height:1.3}.analytics-app,.analytics-report{display:block}.analytics-app>*,.analytics-report>*{margin-bottom:12px}.analytics-card{padding:8px}.analytics-card p{margin:6px 0}.analytics-kpis p{margin:4px 0}.analytics-ranking-toolbar{display:none}[data-analytics-context]{font-size:10px}[data-analytics-context] p{margin:4px 0} .analytics-math{padding:8px} .analytics-company-row{display:grid;grid-template-columns:1fr 2fr;gap:12px} .analytics-company-row .analytics-card{min-height:0} .analytics-ranking-three{grid-template-columns:repeat(3,minmax(0,1fr))} .table-wrap,.mobile-table-view{max-height:none!important;overflow:visible!important} .analytics-awards-table .data{min-width:0!important;width:100%!important;table-layout:fixed} .analytics-awards-table .data th,.analytics-awards-table .data td{width:auto!important;padding:5px;font-size:9px;white-space:normal;overflow-wrap:anywhere}.analytics-card h2{font-size:14px;margin-bottom:8px}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}a{color:#155e75}.analytics-grid,.analytics-unit-comparison{grid-template-columns:repeat(2,minmax(0,1fr))}.analytics-grid.analytics-ranking-three{grid-template-columns:repeat(3,minmax(0,1fr))}.analytics-grid,.analytics-kpis,.analytics-detail-grid,.analytics-company-row{break-inside:avoid}.analytics-trend{display:flex;gap:12px;align-items:start;break-inside:avoid}.analytics-trend>.analytics-chart{flex:3;min-width:0}.analytics-math{flex:2;min-width:0}.analytics-card h2{display:block}.analytics-unit-comparison{display:flex}.analytics-unit-chart{flex:1;min-width:0}.analytics-unit-chart{padding:10px}.analytics-kpis{grid-template-columns:repeat(4,minmax(0,1fr))!important}.analytics-kpis:has(>.analytics-card:nth-child(3):last-child){grid-template-columns:repeat(3,minmax(0,1fr))!important}.analytics-detail-grid{grid-template-columns:1fr}.analytics-app .analytics-sdk{width:11%!important;min-width:0!important;max-width:none!important}.analytics-sdk .analytics-entity-value{max-width:none}.analytics-donut-layout{grid-template-columns:minmax(110px,38%) minmax(0,1fr)}}
  `
  const title=document.createElement('title');title.textContent=`Phân tích · ${query.entity||'Toàn thị trường'}`
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${title.outerHTML}<style>${styles.replace(/<\/style/gi,'<\\/style')}\n${extra}</style></head><body>${clone.outerHTML}</body></html>`
}

export async function exportPdf(root:HTMLElement,query:AnalyticsQuery,preview:Window){
  preview.document.open();preview.document.write(reportHtml(root,query,true));preview.document.close()
  await preview.document.fonts.ready
  await Promise.race([Promise.all([...preview.document.images].map(img=>img.complete?Promise.resolve():new Promise<void>(resolve=>{img.onload=()=>resolve();img.onerror=()=>resolve()}))),new Promise(resolve=>setTimeout(resolve,5000))])
  preview.focus()
  await new Promise<void>(resolve=>preview.requestAnimationFrame(()=>preview.requestAnimationFrame(()=>resolve())))
  preview.print()
}

export function exportHtml(root:HTMLElement,query:AnalyticsQuery){
  const url=URL.createObjectURL(new Blob([reportHtml(root,query)],{type:'text/html;charset=utf-8'}))
  const anchor=document.createElement('a');anchor.href=url;anchor.download=`baoan-analytics-${query.end||new Date().toISOString().slice(0,10)}.html`;anchor.click()
  setTimeout(()=>URL.revokeObjectURL(url),10000)
}
