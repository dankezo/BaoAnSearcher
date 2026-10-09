import type {AnalyticsQuery} from './types'

// Preserve the rendered report, including vector charts and source links.
export function reportHtml(root:HTMLElement,query:AnalyticsQuery,print=false):string{
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
      copy.style.height=Math.min(original.clientHeight,print?220:original.clientHeight)+'px';copy.style.minWidth='0'
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
    const style=getComputedStyle(original)
    if(print&&original.classList.contains('analytics-related-news')){copy.style.setProperty('max-height','none','important');copy.style.overflow='visible';continue}
    if(!print||!['auto','scroll'].includes(style.overflowY)||original.scrollHeight<=original.clientHeight+2||original.clientHeight===0)continue
    if(original.closest('.analytics-filter,.analytics-heading'))continue
    copy.classList.add('analytics-print-scroll')
    const height=Math.min(original.clientHeight,original.classList.contains('analytics-related-news-list')?160:320)
    copy.style.setProperty('max-height',height+'px','important')
    const table=original.querySelector('table'),tableCopy=copy.querySelector('table')
    if(table&&tableCopy){
      let used=table.tHead?.getBoundingClientRect().height||0
      const rows=[...table.querySelectorAll('tbody tr')],rowCopies=[...tableCopy.querySelectorAll('tbody tr')]
      rows.forEach((row,index)=>{used+=row.getBoundingClientRect().height;if(used>height-24&&index>0)rowCopies[index]?.remove()})
    }
    if(original.matches('.analytics-related-news-list,.analytics-ranking,.analytics-donut-legend')){
      let used=0
      ;[...original.children].forEach((child,index)=>{used+=child.getBoundingClientRect().height;if(used>height-24&&index>0)copy.children[index]?.setAttribute('data-export-overflow','true')})
      copy.querySelectorAll('[data-export-overflow]').forEach(child=>child.remove())
      copy.style.setProperty('max-height','none','important')
    }
    const card=original.closest<HTMLElement>('.analytics-card')
    if(card?.id){
      const more=document.createElement('a')
      liveUrl.searchParams.set('analyticsSection',card.id)
      more.href=liveUrl.toString();more.textContent='Xem đầy đủ mục này ↗';more.className='analytics-export-more'
      copy.after(more)
    }
  }
  clone.querySelectorAll('.analytics-filter,.analytics-report-tabs,.analytics-context-actions,.analytics-help-wrap,[role="alert"],[role="status"],.analytics-guidance,.analytics-trend-heading label').forEach(node=>node.remove())
  if(print)clone.querySelectorAll('[data-export-empty],details:not([open])').forEach(node=>node.remove())
  else clone.querySelectorAll('details').forEach(node=>node.setAttribute('open',''))
  clone.querySelectorAll('button').forEach(button=>{
    if(button.classList.contains('analytics-legend-button')){const span=document.createElement('div');span.className=button.className;span.append(...button.childNodes);button.replaceWith(span)}
    else button.remove()
  })
  clone.querySelectorAll('.analytics-controls').forEach(node=>node.remove())
  clone.querySelectorAll('.analytics-grid,.analytics-detail-grid,[data-analytics-context]').forEach(node=>{if(!node.children.length)node.remove()})
  const styles=[...document.styleSheets].map(sheet=>{try{return [...sheet.cssRules].map(rule=>rule.cssText).join('\n').replace(/url\((['"]?)([^)'"\s]+)\1\)/g,(_match,_quote,value)=>`url("${new URL(value,sheet.href||document.baseURI).href}")`)}catch{return ''}}).join('\n')
  const extra=`
    :root{color-scheme:light}*{box-sizing:border-box;animation:none!important;transition:none!important}html,body{height:auto!important;overflow:visible!important;background:white!important}
    body{margin:0;padding:24px;color:#172b3a;font-family:Arial,sans-serif}.analytics-app{display:grid;gap:14px;max-width:1180px;margin:auto}
    .analytics-card{min-width:0}.analytics-card h2{line-height:1.35}.analytics-export-more{display:block;margin-top:6px;font-size:11px;color:#155e75}
    .recharts-surface{max-width:100%;height:auto}.analytics-report{display:grid;gap:14px}.analytics-heading{display:block}
    ${print?`.analytics-print-scroll,.analytics-table,.analytics-math,.analytics-ranking,.analytics-donut-legend{overflow:visible!important;max-height:none!important}.analytics-table table{table-layout:fixed}.analytics-table th,.analytics-table td{min-width:0!important;width:auto!important;overflow-wrap:anywhere;padding:6px;font-size:10px}.analytics-table th{position:static}.analytics-card{break-inside:avoid;box-shadow:none}.analytics-empty-chart{display:none}`:`.analytics-table,.analytics-math,.analytics-ranking,.analytics-related-news,.analytics-related-news-list,.analytics-donut-legend{max-height:none!important;overflow:visible!important}.analytics-detail-grid{grid-template-columns:1fr!important}`}
    @page{size:A4 landscape;margin:10mm}@media print{body{padding:0}.analytics-app{width:100%;max-width:none;font-size:12px}.analytics-app,.analytics-report{display:block}.analytics-app>*,.analytics-report>*{margin-bottom:12px}.analytics-card{padding:12px}.analytics-card h2{font-size:14px;margin-bottom:8px}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}a{color:#155e75}.analytics-grid,.analytics-unit-comparison{grid-template-columns:repeat(2,minmax(0,1fr))}.analytics-grid,.analytics-kpis,.analytics-detail-grid{break-inside:avoid}.analytics-trend{display:flex;gap:16px}.analytics-trend>.analytics-chart{flex:3;min-width:0}.analytics-math{flex:2;min-width:0}.analytics-card h2{display:block}.analytics-unit-comparison{display:flex}.analytics-unit-chart{flex:1;min-width:0}.analytics-unit-chart{padding:10px}.analytics-kpis{grid-template-columns:repeat(4,minmax(0,1fr))}.analytics-detail-grid{grid-template-columns:1fr}.analytics-app .analytics-sdk{width:11%!important;min-width:0!important;max-width:none!important}.analytics-sdk .analytics-entity-value{max-width:none}.analytics-donut-layout{grid-template-columns:minmax(110px,38%) minmax(0,1fr)}}
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
