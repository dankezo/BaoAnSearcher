"""MSC requests for quotation: public search, durable detail archive, daily replay."""
from __future__ import annotations
from contextlib import closing

import json
import os
import re
import sqlite3
import ssl
import sys
import threading
import time
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlencode

from .common import DATA_DIR, ROOT, VN, fold, now_iso, update_status
from .baoan_match import public_lines, _tender_group

DB = DATA_DIR / 'msc_ycbg.sqlite3'
ARCHIVE = DATA_DIR / 'msc_ycbg'
BASE = 'https://muasamcong.mpi.gov.vn'
SERVICES = BASE + '/o/egp-portal-contractor-selection-v2/services/'
_thread = None
_guard = threading.Lock()


def payload(page=0):
    return {'pageSize': '50', 'pageNumber': page, 'query': [{
        'index': 'es-contractor-selection', 'keyWord': 'thầu thuốc',
        'matchType': 'all-1', 'matchFields': ['notifyNo', 'name'],
        'filters': [{'fieldName': 'type', 'searchType': 'in', 'fieldValues': ['es-ycbg']}],
    }]}


def connect():
    DB.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB, timeout=30)
    con.execute('PRAGMA journal_mode=WAL')
    con.execute('CREATE TABLE IF NOT EXISTS quotes (id TEXT PRIMARY KEY, normalized TEXT NOT NULL, detail TEXT, fetched_at TEXT, error TEXT)')
    con.execute('CREATE TABLE IF NOT EXISTS crawl_meta (key TEXT PRIMARY KEY, value TEXT)')
    return con


def _json(value, default):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return default
    return value if value is not None else default


def extract_lots(detail):
    """Walk embedded formValue, including all form tables and child rows."""
    found = []
    def walk(value):
        if isinstance(value, str):
            if value.lstrip().startswith(('{', '[')):
                walk(_json(value, None))
        elif isinstance(value, list):
            for row in value:
                walk(row)
        elif isinstance(value, dict):
            if value.get('tenHoatChat') or value.get('dangBaoChe'):
                row = dict(value)
                row['groupMedicine'] = str(row.get('nhomTCKT') or row.get('groupMedicine') or '')
                found.append(row)
                walk(value.get('children'))
            else:
                for child in value.values():
                    walk(child)
    walk(detail.get('bidoRequestQuote', detail).get('formValue'))
    return found


def normalize(item, detail=None):
    quote = (detail or {}).get('bidoRequestQuote') or {}
    no = quote.get('requestQuoteNo') or item.get('notifyNo') or ''
    ident = str(quote.get('id') or item.get('id') or '')
    locations = _json(quote.get('location') or item.get('locations'), [])
    province = ', '.join(dict.fromkeys(str(row.get('provName') or '') for row in locations if isinstance(row, dict) and row.get('provName'))) if isinstance(locations, list) else ''
    return {
        'id': ident, 'tender_no': no, 'version': quote.get('requestQuoteVersion') or item.get('notifyVersion') or '00',
        'name': quote.get('requestQuoteName') or item.get('name') or '',
        'bid_name': quote.get('bidName') or item.get('bidName') or '',
        'buyer': quote.get('investorName') or item.get('investorName') or '', 'province': province,
        'published': quote.get('publicDate') or item.get('publicDate') or '',
        'close_date': quote.get('receptionDateTo') or item.get('bidCloseDate') or '',
        'receive_from': quote.get('receptionDateFrom') or item.get('bidOpenDate') or '',
        'status_code': quote.get('status') or item.get('status') or '',
        'bid_form': quote.get('requestQuoteForm') or '',
        'contact_name': quote.get('responsibleName') or '', 'contact_phone': quote.get('responsiblePhoneNumber') or '',
        'contact_email': quote.get('responsibleEmail') or '', 'contact_address': quote.get('responsibleAddress') or '',
        'content': quote.get('requestQuoteContent') or '',
        'cancel_reason': quote.get('cancelReason') or '',
        'source_url': BASE + '/web/guest/contractor-selection?' + urlencode({
            'p_p_id': 'egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2',
            '_egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2_render': 'detail-v2',
            'type': 'es-ycbg', 'stepCode': 'request-quote-step-1', 'id': ident, 'notifyNo': no,
        }),
    }


def present(item, detail=None, error=''):
    row = dict(item)
    close = str(row.get('close_date') or '')[:19]
    row['status_label'] = 'Đã hủy' if row.get('cancel_reason') or row.get('status_code') in ('03', 'CANCEL') else ('Chưa hết hạn nhận báo giá' if close and close >= datetime.now(VN).strftime('%Y-%m-%dT%H:%M:%S') else 'Đã hết hạn nhận báo giá' if close else 'Cần rà soát thời hạn')
    row['scope_lines'] = public_lines(extract_lots(detail)) if detail else None
    lines = row['scope_lines'] or []
    row['baoan_match'] = 'exact' if any(x['match'] == 'exact' for x in lines) else 'near' if any(x['match'] == 'near' for x in lines) else ''
    row['document_status'] = 'Lỗi tải hồ sơ: ' + error if error else 'Đã tải danh mục' if lines else 'Cần rà soát hồ sơ đính kèm' if detail else 'Chưa tải hồ sơ'
    return row


def meta_info():
    with closing(connect()) as con:
        count = con.execute('SELECT count(*) FROM quotes').fetchone()[0]
        meta = dict(con.execute('SELECT key,value FROM crawl_meta'))
        details = con.execute('SELECT count(*) FROM quotes WHERE detail IS NOT NULL').fetchone()[0]
        errors = con.execute("SELECT count(*) FROM quotes WHERE coalesce(error,'')!=''").fetchone()[0]
    return {'count': count, 'details': details, 'errors': errors, 'updated': meta.get('completed_at'), 'fullScanComplete': meta.get('full_scan_complete') == '1', 'sourceTotal': int(meta.get('source_total') or 0)}


def completed_today(meta):
    return bool(meta['count'] and meta['fullScanComplete'] and meta['details']==meta['count'] and not meta['errors'] and str(meta.get('updated') or '')[:10]==datetime.now(VN).date().isoformat())


def search(filters=None, page=0, size=100):
    filters = filters or {}
    page, size = max(0, int(page)), min(5000, max(1, int(size)))
    groups=filters.get('group_name') or []
    needs_lines=bool(filters.get('ingredient') or filters.get('dosage_form') or groups or filters.get('metricQuick') in ('exact','near'))
    with closing(connect()) as con:
        records = con.execute('SELECT normalized,'+('detail' if needs_lines else 'NULL')+',error FROM quotes').fetchall()
    items = []
    for norm, raw, error in records:
        row = present(json.loads(norm), json.loads(raw) if raw else None, error or '')
        text = fold(' '.join(str(row.get(k) or '') for k in ('tender_no','name','buyer','province','bid_name')))
        if filters.get('q') and not all(word in text for word in fold(filters['q']).split()):
            continue
        if any(filters.get(k) and not all(word in fold(row.get(k) or '') for word in fold(filters[k]).split()) for k in ('name','tender_no')):
            continue
        if any(filters.get(k) and not any(fold(v) in fold(row.get(k) or '') for v in (filters[k] if isinstance(filters[k],list) else [filters[k]])) for k in ('buyer','province')):
            continue
        date = str(row.get('published') or '')[:10]
        if filters.get('publishedFrom') and date < filters['publishedFrom'] or filters.get('publishedTo') and date > filters['publishedTo']:
            continue
        lines = row['scope_lines'] or []
        groups = filters.get('group_name') or []
        groups = groups if isinstance(groups,list) else [groups]
        if any(filters.get(k) for k in ('ingredient','dosage_form','group_name')) and not any(
            all(word in fold(line.get('name') or '') for word in fold(filters.get('ingredient') or '').split())
            and all(word in fold(line.get('form') or '') for word in fold(filters.get('dosage_form') or '').split())
            and (not groups or _tender_group(line.get('group')) in {_tender_group(g) for g in groups}) for line in lines):
            continue
        quick = filters.get('metricQuick') or ''
        if quick in ('exact','near') and row['baoan_match'] != quick or quick == 'open' and row['status_label'] != 'Chưa hết hạn nhận báo giá':
            continue
        items.append(row)
    items.sort(key=lambda row: (row.get('published') or '',row['id']), reverse=True)
    selected=items[page*size:(page+1)*size]
    if not needs_lines and selected:
        with closing(connect()) as con:
            records=con.execute('SELECT id,normalized,detail,error FROM quotes WHERE id IN ('+','.join('?' for row in selected)+')',[row['id'] for row in selected]).fetchall()
        hydrated={ident:present(json.loads(norm),json.loads(raw) if raw else None,error or '') for ident,norm,raw,error in records}
        selected=[hydrated[row['id']] for row in selected]
    return {'total':len(items),'page':page,'size':size,'hasMore':len(items)>(page+1)*size,'items':selected}


def fetch_detail(ident):
    context = ssl.create_default_context()
    context.set_ciphers('DEFAULT:@SECLEVEL=1')
    req = urllib.request.Request(SERVICES + 'get-request-quote',data=json.dumps({'id':ident}).encode(),headers={'Content-Type':'application/json','User-Agent':'Mozilla/5.0'},method='POST')
    with urllib.request.urlopen(req,timeout=35,context=context) as res:
        data = json.load(res)
    if not isinstance(data.get('bidoRequestQuote'),dict) or data['bidoRequestQuote'].get('id') != ident:
        raise ValueError('Nguồn không trả đúng hồ sơ YCBG')
    return data


def crawl(full=False, report=None, fetch_page=None, fetch=fetch_detail):
    """Full first pass; subsequent 7-day overlap plus active and failed details."""
    if not _guard.acquire(blocking=False):
        raise RuntimeError('YCBG đang chạy')
    runtime = browser = None
    owns_lease = False
    force_details = full
    if fetch_page is None:
        from dotenv import load_dotenv
        load_dotenv(ROOT / '.env')
    remote = fetch_page is None and bool(os.environ.get('CLOUDFLARE_YCBG_WORKER_URL') or os.environ.get('CLOUDFLARE_CRAWL_WORKER_URL'))
    report = report or (lambda message: update_status('msc_ycbg',state='running',message=message,updated=now_iso()))
    try:
        con = connect()
        con.execute('BEGIN IMMEDIATE')
        lease = con.execute("SELECT value FROM crawl_meta WHERE key='running_until'").fetchone()
        if lease and float(lease[0]) > time.time():
            raise RuntimeError('YCBG đang chạy ở tiến trình khác')
        con.execute("INSERT OR REPLACE INTO crawl_meta VALUES ('running_until',?)",(str(time.time()+7200),))
        con.commit()
        owns_lease = True
        old_meta = dict(con.execute('SELECT key,value FROM crawl_meta'))
        full = full or old_meta.get('full_scan_complete') != '1'
        cutoff = (datetime.fromisoformat(old_meta.get('completed_at') or now_iso()) - timedelta(days=7)).date().isoformat()
        if remote:
            from .ycbg_cloud import search_page, fetch_details, DETAIL_BATCH_SIZE
            fetch_page = lambda number: search_page(number,fresh=force_details)
        if fetch_page is None:
            proc = ROOT / 'test zone' / 'procurement'
            for directory in (proc,proc/'vendor'):
                if str(directory) not in sys.path:
                    sys.path.insert(0,str(directory))
            from playwright.sync_api import sync_playwright
            from browser_update import URL, COMPONENT, same_search, TENDER_API
            runtime = sync_playwright().start()
            browser = runtime.chromium.launch(channel='msedge' if sys.platform=='win32' else None,headless=True)
            page = browser.new_page(locale='vi-VN')
            page.goto(BASE+'/web/guest/contractor-selection?render=index',wait_until='domcontentloaded',timeout=60000)
            page.wait_for_function('Boolean('+COMPONENT+')',timeout=60000)
            def fetch_page(number):
                body = payload(number)
                def matches(res):
                    try:
                        return res.url.split('?')[0] == TENDER_API and same_search(res.request.post_data_json,body)
                    except Exception:
                        return False
                with page.expect_response(matches,timeout=60000) as pending:
                    page.evaluate('(p)=>{const v='+COMPONENT+';v.quickSearchPayload.pageSize=p.pageSize;v.currentPage=p.pageNumber;v.axiosSearch(p)}',body)
                response = pending.value
                if response.status != 200:
                    raise RuntimeError('MSC không trả trang YCBG')
                return response.json()['page']
        seen = set()
        source_total = 0
        for number in range(1000):
            result = fetch_page(number)
            rows = result.get('content')
            if not isinstance(rows,list) or not isinstance(result.get('totalPages'),int):
                raise ValueError('Trang YCBG không hợp lệ')
            source_total = int(result.get('totalElements') or 0)
            ids = {str(row.get('id') or '') for row in rows}
            if rows and ('' in ids or ids.intersection(seen) or len(ids)!=len(rows)):
                raise ValueError('Nguồn trả trang lặp / thiếu mã YCBG')
            seen.update(ids)
            for item in rows:
                normalized = normalize(item)
                if not re.fullmatch(r'[a-zA-Z0-9-]{1,64}',normalized['id']) or not normalized['tender_no'].startswith('RQ'):
                    raise ValueError('Nguồn trả bản ghi ngoài YCBG')
                existing = con.execute('SELECT detail FROM quotes WHERE id=?',(normalized['id'],)).fetchone()
                if existing and existing[0]:
                    previous = normalize(item,json.loads(existing[0]))
                    # Search fields are the newest authority for publication/version/deadline.
                    previous.update({k:v for k,v in normalized.items() if v and k not in ('bid_form','source_url')})
                    normalized=previous
                con.execute('INSERT INTO quotes(id,normalized) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET normalized=excluded.normalized',(normalized['id'],json.dumps(normalized,ensure_ascii=False)))
            con.commit()
            report(f'YCBG · trang {number+1}/{result["totalPages"]} · {len(seen)} bản ghi')
            if number+1 >= result['totalPages']:
                break
            dates = [str(item.get('publicDate') or '')[:10] for item in rows]
            if not full and number >= 2 and dates and all(value and value < cutoff for value in dates):
                break
            time.sleep(.3)
        else:
            raise RuntimeError('Chưa duyệt hết trang YCBG; sẽ tiếp tục lần sau')
        if full and len(seen) != source_total:
            raise RuntimeError('Tổng YCBG thay đổi trong lúc quét; dữ liệu đã lưu, chưa đánh dấu đủ lịch sử')
        ARCHIVE.mkdir(parents=True,exist_ok=True)
        pending = con.execute('SELECT id,normalized,detail,error,fetched_at FROM quotes').fetchall()
        failed = 0
        consecutive_failures = 0
        stamp = now_iso()
        required = []
        for record in pending:
            ident,norm,raw,error,fetched = record
            item = json.loads(norm)
            active = str(item.get('close_date') or '')[:19] >= datetime.now(VN).strftime('%Y-%m-%dT%H:%M:%S')
            if not force_details and raw and not error and fetched and datetime.fromisoformat(fetched) > datetime.now(VN)-timedelta(hours=24):
                continue
            if not full and raw and not error and not active and str(item.get('published') or '')[:10] < cutoff:
                continue
            required.append(record)
        remote_cache = {}
        for i,(ident,norm,raw,error,fetched) in enumerate(required):
            item = json.loads(norm)
            try:
                if remote:
                    if ident not in remote_cache:
                        remote_cache.update(fetch_details([row[0] for row in required[i:i+DETAIL_BATCH_SIZE]],fresh=force_details))
                    result = remote_cache.pop(ident)
                    if result.get('error'):
                        raise RuntimeError(result['error'])
                    detail = result['detail']
                else:
                    detail = fetch(ident)
                if not isinstance(detail,dict) or detail.get('bidoRequestQuote',{}).get('id') != ident:
                    raise ValueError('Nguồn không trả đúng hồ sơ YCBG')
                packed = json.dumps(detail,ensure_ascii=False)
                (ARCHIVE / (ident+'.json')).write_text(packed,encoding='utf-8')
                item = normalize(item,detail)
                con.execute('UPDATE quotes SET normalized=?,detail=?,fetched_at=?,error=NULL WHERE id=?',(json.dumps(item,ensure_ascii=False),packed,stamp,ident))
                consecutive_failures=0
            except Exception as exc:
                failed+=1
                consecutive_failures+=1
                con.execute('UPDATE quotes SET error=? WHERE id=?',(type(exc).__name__,ident))
            con.commit()
            if consecutive_failures >= 3:
                raise RuntimeError('Nguồn lỗi ba hồ sơ liên tiếp; giữ dữ liệu và thử lại lượt sau')
            if i%20==0:
                report(f'YCBG · hồ sơ {i+1}/{len(required)} · {failed} lỗi')
        if full:
            con.execute("INSERT OR REPLACE INTO crawl_meta VALUES ('full_scan_complete','1')")
        checkpoints=[('source_total',str(source_total))]
        if not failed:
            checkpoints.append(('completed_at',stamp))
        for key,value in checkpoints:
            con.execute('INSERT OR REPLACE INTO crawl_meta VALUES (?,?)',(key,value))
        con.commit()
        return meta_info()
    finally:
        if browser:
            browser.close()
        if runtime:
            runtime.stop()
        if 'con' in locals():
            if owns_lease:
                con.execute("DELETE FROM crawl_meta WHERE key='running_until'")
                con.commit()
            con.close()
        _guard.release()


def start_crawl(full=False):
    global _thread
    if _thread and _thread.is_alive() or _guard.locked():
        return {'ok':False,'message':'YCBG đang chạy'}
    def work():
        update_status('msc_ycbg',state='running',progress=0,message='Bắt đầu lấy MSC - YCBG',updated=now_iso())
        try:
            result = crawl(full=full)
            update_status('msc_ycbg',state='error' if result['errors'] else 'idle',progress=100,count=result['count'],meta=result,message=f'YCBG: {result["count"]} bản ghi · {result["details"]} hồ sơ · {result["errors"]} lỗi',updated=now_iso())
        except Exception as exc:
            update_status('msc_ycbg',state='error',message='YCBG chưa hoàn tất ('+type(exc).__name__+'). Đã giữ dữ liệu tải được; cập nhật lại khi nguồn MSC hoạt động.',updated=now_iso())
    _thread=threading.Thread(target=work,daemon=True,name='msc-ycbg')
    _thread.start()
    return {'ok':True,'message':'Đã bắt đầu lấy YCBG; lần đầu duyệt tất cả các trang 50 bản ghi.'}
