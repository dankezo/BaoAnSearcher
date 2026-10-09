"""Read-only Cloudflare Quick Action test of the normal MSC search handler."""
import html
import json
import os
import re
import sys
from pathlib import Path
import requests
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'test zone' / 'procurement'))
from browser_update import COMPONENT, URL, payload


def main():
    account = os.environ['CLOUDFLARE_BROWSER_ACCOUNT_ID']
    token = os.environ['CLOUDFLARE_BROWSER_TOKEN']
    script = r"""(() => {
      const results=[]; let started=false; let v;
      const finish=(extra)=>{const e=document.createElement('pre');e.id='baoan-probe-result';e.textContent=JSON.stringify({results,...extra});document.body.appendChild(e)};
      const timer=setTimeout(()=>finish({error:'search_timeout',component:!!v}),35000);
      const poll=setInterval(()=>{
        v=COMPONENT;
        if(!v || started || typeof axios==='undefined') return;
        started=true;clearInterval(poll);
        axios.interceptors.response.use(r=>{
          if(r.config.url.split('?')[0]===v.elasticSearch && r.config.data){
            let sent; try {sent=JSON.parse(r.config.data);if(Array.isArray(sent))sent=sent[0]} catch {return r}
            if(Number(sent.pageSize)===50 && [0,1].includes(Number(sent.pageNumber))){
              const page=r.data && r.data.page;results.push({page:sent.pageNumber,status:r.status,rows:page&&page.content&&page.content.length,totalPages:page&&page.totalPages});
              if(Number(sent.pageNumber)===0 && page && page.content && page.content.length) v.axiosSearch(PAGE1);
              else {clearTimeout(timer);finish({})}
            }
          }
          return r;
        },err=>{if(err.config && err.config.url.split('?')[0]===v.elasticSearch){clearTimeout(timer);finish({error:'search_http_error',status:err.response&&err.response.status})}return Promise.reject(err)});
        v.axiosSearch(PAGE0);
      },250);
    })()""".replace('COMPONENT', COMPONENT).replace('PAGE0', json.dumps(payload(0))).replace('PAGE1', json.dumps(payload(1)))
    response=requests.post('https://api.cloudflare.com/client/v4/accounts/'+account+'/browser-rendering/content',
      headers={'Authorization':'Bearer '+token}, json={'url':URL,'gotoOptions':{'waitUntil':'domcontentloaded','timeout':25000},'addScriptTag':[{'content':script}],'waitForSelector':{'selector':'#baoan-probe-result','timeout':40000}},timeout=75)
    data=response.json(); content=data.get('result') or ''
    match=re.search(r'<pre[^>]*id="baoan-probe-result"[^>]*>(.*?)</pre>',content,re.S)
    report={'http':response.status_code,'success':data.get('success'),'errors':data.get('errors')}
    if match:report['probe']=json.loads(html.unescape(match.group(1)))
    print(json.dumps(report,ensure_ascii=True),flush=True)

if __name__=='__main__':main()
