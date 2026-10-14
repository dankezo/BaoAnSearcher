"""Use the existing Playwright client with optional Cloudflare Browser Run."""
import os
import re
import html
import json
import requests

WORKER_URLS = ('https://crawl.baoanpharma.com', 'https://baoan-public-crawl.dannyphan190.workers.dev')


def cloud_worker_post(path, body, timeout=(10, 110)):
    """Invoke the allowlisted public crawl Worker without logging its key."""
    worker = (os.environ.get('CLOUDFLARE_YCBG_WORKER_URL') if path.startswith('/ycbg/') or path=='/quota' else None) or os.environ.get('CLOUDFLARE_CRAWL_WORKER_URL', '')
    worker = worker.strip().rstrip('/')
    ycbg_route = path.startswith('/ycbg/') or path == '/quota'
    key_name = 'CLOUDFLARE_YCBG_KEY' if ycbg_route else 'CLOUDFLARE_CRAWL_WORKER_KEY'
    key = (os.environ.get(key_name) or (os.environ.get('CLOUDFLARE_CRAWL_WORKER_KEY') if ycbg_route else '') or '').strip()
    if worker not in WORKER_URLS or not key:
        raise ValueError(f'Configure the BaoAn crawl Worker URL and {key_name}.')
    response = requests.post(worker + path, headers={'Authorization': f'Bearer {key}'},
                             json=body, timeout=timeout)
    status = getattr(response, 'status_code', 200)
    if isinstance(status, int) and status >= 400:
        message = 'daily MSC browser budget reached; retry next window.' if status == 429 else 'public source unavailable; check Worker logs.'
        raise RuntimeError(f'Crawl Worker HTTP {status}: {message}')
    data = response.json()
    if not isinstance(data, dict):
        raise ValueError('Crawl Worker returned an invalid response.')
    return data


def open_browser(runtime):
    account = os.environ.get('CLOUDFLARE_BROWSER_ACCOUNT_ID', '').strip()
    token = os.environ.get('CLOUDFLARE_BROWSER_TOKEN', '').strip()
    if not account and not token:
        return runtime.chromium.launch(headless=True)
    if not re.fullmatch('[0-9a-f]{32}', account) or not token:
        raise ValueError('Configure both Cloudflare browser account ID and scoped token.')
    # Keep the token in a header, never in a URL or log.
    return runtime.chromium.connect_over_cdp(
        f'wss://api.cloudflare.com/client/v4/accounts/{account}/browser-run/devtools/browser',
        headers={'Authorization': f'Bearer {token}'}, timeout=45000,
    )


def cloud_search_page(body):
    """Call the website's normal search handler in a bounded Quick Action."""
    worker = os.environ.get('CLOUDFLARE_CRAWL_WORKER_URL', '').strip().rstrip('/')
    if worker:
        data = cloud_worker_post('/msc/search', {'page': body['pageNumber']})
        if not isinstance(data.get('page'), dict):
            raise ValueError('Crawl Worker returned no MSC result page.')
        return data
    from browser_update import COMPONENT, URL
    account = os.environ.get('CLOUDFLARE_BROWSER_ACCOUNT_ID', '').strip()
    token = os.environ.get('CLOUDFLARE_BROWSER_TOKEN', '').strip()
    if not re.fullmatch('[0-9a-f]{32}', account) or not token:
        raise ValueError('Configure both Cloudflare browser account ID and scoped token.')
    script = r"""(() => {
      const wanted=PAYLOAD; let started=false;
      const finish=value=>{if(document.getElementById('baoan-search-result'))return;const e=document.createElement('pre');e.id='baoan-search-result';e.textContent=JSON.stringify(value);document.body.appendChild(e)};
      const timer=setTimeout(()=>finish({error:'search_timeout'}),35000);
      const poll=setInterval(()=>{
        const v=COMPONENT;
        if(!v || started || typeof axios==='undefined')return;
        started=true;clearInterval(poll);
        axios.interceptors.response.use(r=>{
          let sent;try{sent=JSON.parse(r.config.data);if(Array.isArray(sent))sent=sent[0]}catch{return r}
          if(r.config.url.split('?')[0]===v.elasticSearch && Number(sent.pageNumber)===wanted.pageNumber && Number(sent.pageSize)===Number(wanted.pageSize) && JSON.stringify(sent.query)===JSON.stringify(wanted.query)){
            clearTimeout(timer);finish({status:r.status,page:r.data&&r.data.page});
          }
          return r;
        },err=>{if(err.config&&err.config.url.split('?')[0]===v.elasticSearch){clearTimeout(timer);finish({error:'search_http_error'})}return Promise.reject(err)});
        v.quickSearchPayload.pageSize=wanted.pageSize;v.currentPage=wanted.pageNumber;v.axiosSearch(wanted);
      },250);
    })()""".replace('COMPONENT', COMPONENT).replace('PAYLOAD', json.dumps(body))
    response = requests.post(
        f'https://api.cloudflare.com/client/v4/accounts/{account}/browser-rendering/content',
        headers={'Authorization': f'Bearer {token}'},
        json={'url': URL, 'actionTimeout': 45000, 'gotoOptions': {'waitUntil': 'domcontentloaded', 'timeout': 25000},
              'addScriptTag': [{'content': script}],
              'waitForSelector': {'selector': '#baoan-search-result', 'timeout': 40000}}, timeout=(10, 110),
    )
    response.raise_for_status()
    data = response.json()
    match = re.search(r'<pre[^>]*id="baoan-search-result"[^>]*>(.*?)</pre>', data.get('result') or '', re.S)
    if not data.get('success') or not match:
        raise RuntimeError('Cloudflare did not return a completed MSC search.')
    result = json.loads(html.unescape(match.group(1)))
    if result.get('status') != 200 or not isinstance(result.get('page'), dict):
        raise RuntimeError('MSC search did not return a valid public result page.')
    return {'page': result['page']}
