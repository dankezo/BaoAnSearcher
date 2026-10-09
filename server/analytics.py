"""Local analytics runs the shared Node engine over read-only SQLite."""
import re
import hashlib
import json
import os
import subprocess
import sys
import threading
import time
from concurrent.futures import Future

import requests
from fastapi import APIRouter, HTTPException, Request
from starlette.concurrency import run_in_threadpool
from .common import ROOT, DAV_DB, MSC_DB, VSS_DB, DATA_DIR

router = APIRouter()
_lock = threading.Lock()
_cache = {}
_flights = {}
_auth = {}
_allowed = {'sales@baoanpharma.com','importer@baoanpharma.com','admin@baoanpharma.com','sonnguyen@baoanpharma.com','tuanvu@baoanpharma.com','qa.cursor@baoanpharma.com'}


def dataset_signature():
    """Include WAL commits, so any crawl/pull invalidates derived reports."""
    from datetime import datetime
    from zoneinfo import ZoneInfo
    values = [datetime.now(ZoneInfo('Asia/Bangkok')).date().isoformat()]
    for path in (DAV_DB, MSC_DB, VSS_DB, DATA_DIR/'company_profiles.json', DATA_DIR/'analytics_production_baseline.json'):
        for item in (path, path.with_name(path.name + '-wal')):
            try:
                stat = item.stat()
                values.append((str(item), stat.st_mtime_ns, stat.st_size))
            except OSError:
                values.append((str(item), None))
    return values


def clear_cache():
    with _lock:
        _cache.clear()


def warm_overview():
    def work():
        try:
            compute('overview', {'mode':'macro','entity':'','role':'winner','months':12,'comparison':'yoy','filters':{}})
        except Exception:
            pass  # A failed warm-up never delays startup or a subsequent retry.
    threading.Thread(target=work, daemon=True, name='analytics-warmup').start()


def verify(authorization):
    if not authorization.startswith('Bearer '):
        raise HTTPException(401, 'Cần đăng nhập.')
    key = hashlib.sha256(authorization.encode()).hexdigest()
    if time.time() - _auth.get(key, 0) < 60:
        return
    from dotenv import load_dotenv
    load_dotenv(ROOT / '.env')
    load_dotenv(ROOT / 'web' / '.env.local')
    url = os.environ.get('SUPABASE_URL') or os.environ.get('VITE_SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
    anon = os.environ.get('SUPABASE_ANON_KEY') or os.environ.get('VITE_SUPABASE_ANON_KEY') or os.environ.get('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    if not url or not anon:
        raise HTTPException(503, 'Chưa cấu hình Supabase Auth local.')
    try:
        response = requests.get(url.rstrip('/')+'/auth/v1/user', headers={'Authorization':authorization,'apikey':anon}, timeout=8)
        if response.status_code != 200:
            raise HTTPException(401, 'Phiên đăng nhập không hợp lệ.')
        if str(response.json().get('email','')).lower() not in _allowed:
            raise HTTPException(403, 'Tài khoản chưa được cấp quyền.')
    except requests.RequestException as exc:
        raise HTTPException(503, 'Chưa xác minh được phiên đăng nhập.') from exc
    if len(_auth) > 128:
        _auth.clear()
    _auth[key] = time.time()


def compute(action, body=None, q=''):
    payload = {'action':action,'body':body or {},'q':q}
    signature = dataset_signature()
    key = json.dumps([payload, signature], sort_keys=True, ensure_ascii=False)
    report_path = DATA_DIR / 'analytics_reports' / (hashlib.sha256(('v5:' + key).encode()).hexdigest() + '.json')
    with _lock:
        hit = _cache.get(key)
        if hit and time.time()-hit[0]<300:
            return dict(hit[1], cached=True)
        future = _flights.get(key)
        owner = future is None
        if owner:
            future = _flights[key] = Future()
    if not owner:
        return future.result(timeout=90)
    try:
        if action == 'overview':
            try:
                value = json.loads(report_path.read_text(encoding='utf-8'))
                if value.get('version') == 2 and value.get('sources'):
                    value = dict(value, cached=True)
                    with _lock:
                        _cache[key] = (time.time(), value)
                    future.set_result(value)
                    return value
            except (OSError, ValueError, AttributeError):
                pass
        if action == 'ai-insight' and not (body or {}).get('snapshot'):
            payload['overview'] = dict(compute('overview', (body or {}).get('query') or body), news=(body or {}).get('_news', []), newsStatus=(body or {}).get('_newsStatus', 'unavailable'),_refreshAt=(body or {}).get('refreshAt'))
        env = dict(os.environ, ANALYTICS_PYTHON=sys.executable)
        result = subprocess.run(['node',str(ROOT/'scripts'/'analytics_local.mjs')], input=json.dumps(payload,ensure_ascii=False), text=True, encoding='utf-8', capture_output=True, cwd=ROOT, timeout=90, env=env, creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
        value = json.loads(result.stdout or '{}')
        if result.returncode or 'error' in value:
            raise HTTPException(value.get('status',503),value.get('error','Chưa đọc được dữ liệu phân tích.'))
        if action == 'overview' and signature == dataset_signature() and all(s.get('status') != 'unavailable' for s in value.get('sources', {}).values()):
            try:
                report_path.parent.mkdir(parents=True, exist_ok=True)
                temporary = report_path.with_suffix('.tmp')
                temporary.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
                temporary.replace(report_path)
                # Derived reports are bounded and may be discarded at any time.
                old = sorted(report_path.parent.glob('*.json'), key=lambda p: p.stat().st_mtime, reverse=True)
                for item in old[128:]:
                    item.unlink(missing_ok=True)
            except OSError:
                pass
        with _lock:
            if len(_cache)>=128:
                _cache.pop(next(iter(_cache)))
            _cache[key]=(time.time(),value)
        future.set_result(value)
        return value
    except (OSError,subprocess.TimeoutExpired,json.JSONDecodeError) as exc:
        error=HTTPException(503,'Phân tích local chưa hoàn tất. Thử bộ lọc hẹp hơn.')
        future.set_exception(error)
        raise error from exc
    except Exception as exc:
        future.set_exception(exc)
        raise
    finally:
        with _lock:
            _flights.pop(key,None)


def news_context(authorization):
    """Read through the user's RLS; never send server credentials to Node."""
    from datetime import datetime, timedelta, timezone
    url = os.environ.get('SUPABASE_URL') or os.environ.get('VITE_SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
    anon = os.environ.get('SUPABASE_ANON_KEY') or os.environ.get('VITE_SUPABASE_ANON_KEY') or os.environ.get('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    if not url or not anon:
        return [], 'unavailable'
    cutoff=(datetime.now(timezone.utc)-timedelta(days=30)).date().isoformat()
    try:
        response=requests.get(url.rstrip('/')+'/rest/v1/regulatory_documents',headers={'Authorization':authorization,'apikey':anon},params={'select':'id,title,summary,source_url,published_at,issued_at,effective_at,legal_status,category','category':'in.(Đấu thầu,BE,BHYT)','or':f'(published_at.gte.{cutoff},issued_at.gte.{cutoff})','order':'published_at.desc.nullslast','limit':'6'},timeout=5)
        response.raise_for_status()
        return response.json(), 'available'
    except (requests.RequestException, ValueError):
        return [], 'unavailable'


@router.get('/api/analytics/suggest')
async def analytics_suggest(request:Request,q:str=''):
    await run_in_threadpool(verify,request.headers.get('authorization',''))
    return await run_in_threadpool(compute,'suggest',None,q[:100])


@router.post('/api/analytics/{action}')
async def analytics_action(action:str,request:Request):
    if action not in ('overview','detail','ai-insight','awards','company-profile'):
        raise HTTPException(404)
    await run_in_threadpool(verify,request.headers.get('authorization',''))
    raw=await request.body()
    if len(raw)>(1048576 if action == 'ai-insight' else 16000):
        raise HTTPException(413,'Bộ lọc quá lớn.')
    try:
        body=json.loads(raw)
        if not isinstance(body,dict):
            raise ValueError()
    except (ValueError,TypeError):
        raise HTTPException(400,'Bộ lọc không hợp lệ.')
    if action == 'ai-insight':
        body['_news'],body['_newsStatus']=await run_in_threadpool(news_context,request.headers.get('authorization',''))
    if action == 'company-profile':
        return await run_in_threadpool(company_profile,body)
    return await run_in_threadpool(compute,action,body)


def company_profile(body):
    from scripts.tidb.company_profiles import PATH, key, mirror, upsert, province
    from scripts.tidb.connect import connect,require_config
    q=body.get('query') or {}
    if not isinstance(q,dict) or q.get('mode')!='company' or not isinstance(q.get('entity'),str) or not q['entity'].strip():
        raise HTTPException(400,'Cần tên doanh nghiệp.')
    phrase=key(q['entity'])
    try:
        records=json.loads(PATH.read_text(encoding='utf-8'))
    except (OSError,ValueError):
        records={}
    profiles=[value for name,value in records.items() if phrase in name][:20]
    if not body.get('refresh'):
        return {'profiles':profiles}
    name=body.get('legalName') or q['entity']
    if not isinstance(name,str) or len(name)>700:raise HTTPException(400,'Tên pháp nhân không hợp lệ.')
    def legal_tokens(value):return re.sub(r'^(?:cong ty\s+)?(?:co phan\s+|cp\s+|tnhh\s+)?','',key(value)).split()
    requested=legal_tokens(q['entity']);candidate=legal_tokens(name)
    if not any(candidate[i:i+len(requested)]==requested for i in range(len(candidate))): raise HTTPException(400,'Tên pháp nhân không thuộc phạm vi tìm kiếm.')
    found=compute('company-profile',{'query':q,'legalName':name,'_refreshAt':time.time_ns()})
    if found.get('status')!='verified':return {'profiles':profiles,'reason':found.get('reason') or 'Chưa xác minh được hồ sơ từ nguồn web.'}
    previous=records.get(key(found['legalName'])) or {}
    profile=dict(previous,**found)
    profile['status']='web_verified'
    for field in ('taxId','phone','email','website','imageUrl','introduction'):
        if not profile.get(field) and previous.get(field):profile[field]=previous[field]
    profile['sourceUrls']=list(dict.fromkeys([*(found.get('sourceUrls') or []),*(previous.get('sourceUrls') or [])]))[:10]
    profile['officeAddress']=found.get('address') or previous.get('officeAddress')
    profile['officeProvince']=province(found.get('address')) or previous.get('officeProvince')
    connection=connect(require_config())
    try:
        upsert(connection,profile);connection.commit();mirror(connection)
    finally:connection.close()
    clear_cache()
    return {'profiles':[profile,*[p for p in profiles if key(p.get('legalName'))!=key(profile['legalName'])]]}
