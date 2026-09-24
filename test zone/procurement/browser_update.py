"""Visible browser, normal site search, transactional page checkpoints.

The app never reads or saves passwords, cookies or request tokens.
"""
import json
import os
import queue
import sys
import threading
import time
import uuid
from datetime import date,timedelta
from pathlib import Path
from core import ROOT, BASE, TENDER_API, connect, save_records, now, search, tender_key

sys.path.insert(0,str(ROOT/'vendor'))
URL=BASE+'/web/guest/contractor-selection?p_p_id=egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2&p_p_lifecycle=0&p_p_state=normal&p_p_mode=view&_egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2_render=index&indexSelect=-1'
COMPONENT="Array.from(document.querySelectorAll('[id]')).map(e=>e.__vue__).find(v=>v && typeof v.axiosSearch==='function')"

class Stopped(Exception):pass

def payload(page=0,code=''):
    return {'pageSize':'50','pageNumber':page,'query':[{'index':'es-contractor-selection',
      'keyWord':code,'matchType':'all-1','matchFields':['notifyNo'] if code else ['notifyNo','bidName'],
      'filters':[{'fieldName':'type','searchType':'in','fieldValues':['es-notify-contractor']},
      {'fieldName':'isMedicine','searchType':'in','fieldValues':[1]},
      {'fieldName':'caseKHKQ','searchType':'not_in','fieldValues':['1']}]}]}

def same_search(body,request):
    try:
        item=body[0] if isinstance(body,list) else body
        q=item['query'][0];expected=request['query'][0]
        return (int(item['pageSize'])==int(request['pageSize']) and int(item['pageNumber'])==int(request['pageNumber'])
          and q.get('keyWord','')==expected['keyWord'] and q.get('index')==expected['index']
          and q.get('matchFields')==expected['matchFields'] and q.get('filters')==expected['filters'])
    except (KeyError,TypeError,ValueError,IndexError):return False

def browser_channel():
    preferred='msedge'
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,r'Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice') as key:
            if 'chrome' in winreg.QueryValueEx(key,'ProgId')[0].lower():preferred='chrome'
    except OSError:pass
    return [preferred,'chrome' if preferred=='msedge' else 'msedge']

class SiteBrowser:
    def __init__(self,stop,report,retry):
        self.stop=stop;self.report=report;self.retry=retry;self.browser=None;self.runtime=None;self.page=None

    def check(self):
        if self.stop.is_set():raise Stopped()

    def open(self):
        from playwright.sync_api import sync_playwright
        if self.browser and self.browser.is_connected() and self.page and not self.page.is_closed():return
        self.close()
        self.runtime=sync_playwright().start()
        for channel in browser_channel():
            try:
                self.browser=self.runtime.chromium.launch(channel=channel,headless=False)
                break
            except Exception:continue
        if not self.browser:raise RuntimeError('Không mở được Edge hoặc Chrome. Hãy cài một trong hai trình duyệt rồi thử lại.')
        context=self.browser.new_context(no_viewport=True,locale='vi-VN')
        self.page=context.new_page()
        self.page.goto(URL,wait_until='domcontentloaded',timeout=60000)
        self.page.wait_for_timeout(2000)
        signed=self.page.evaluate("Boolean(window.Liferay?.ThemeDisplay?.isSignedIn())")
        if not signed:
            self.report('Đăng nhập trong cửa sổ trình duyệt vừa mở. App sẽ tự tiếp tục khi nhận được phiên đăng nhập.')
            self.page.goto(BASE+'/c/portal/login',wait_until='domcontentloaded',timeout=60000)
            while True:
                self.check()
                if self.page.is_closed():raise RuntimeError('Trình duyệt đã đóng. Bấm tải tiếp để mở lại.')
                try:
                    if self.page.evaluate("Boolean(window.Liferay?.ThemeDisplay?.isSignedIn())"):break
                except Exception:pass
                self.page.wait_for_timeout(1000)
        self.page.goto(URL,wait_until='domcontentloaded',timeout=60000)
        self.page.wait_for_function('Boolean('+COMPONENT+')',timeout=60000)

    def fetch(self,request):
        self.check();self.open()
        while True:
            self.check()
            try:
                def matches(response):
                    if response.url.split('?')[0]!=TENDER_API:return False
                    try:
                        return same_search(response.request.post_data_json,request)
                    except Exception:return False
                with self.page.expect_response(matches,timeout=45000) as pending:
                    self.page.evaluate('(p)=>{const v='+COMPONENT+'; if(!v)throw Error("missing component");v.quickSearchPayload.pageSize=p.pageSize;v.currentPage=p.pageNumber;v.axiosSearch(p)}',request)
                response=pending.value
                if response.status!=200:raise ValueError('response')
                result=response.json()
                if not isinstance(result,dict) or not isinstance(result.get('page',{}).get('content'),list):raise ValueError('response')
                return result['page']
            except Stopped:raise
            except Exception:
                self.check();self.retry.clear()
                self.report('Nguồn chưa trả dữ liệu. Kiểm tra đăng nhập / thông báo trên trình duyệt, rồi bấm “Thử lại” trong app. Các trang đã lưu vẫn còn.')
                while not self.retry.wait(.5):self.check()
                self.open()

    def close(self):
        try:
            if self.browser:self.browser.close()
            if self.runtime:self.runtime.stop()
        except Exception:pass
        self.browser=self.runtime=self.page=None

def run_pages(adapter,pages,stop,report,db=None,resume=False,recheck=True):
    if not 1<=pages<=200:raise ValueError('Số trang phải từ 1 đến 200.')
    with connect(db) as con:
        previous=con.execute("SELECT * FROM browser_runs WHERE status IN ('running','paused') AND pages=? ORDER BY updated DESC LIMIT 1",(pages,)).fetchone() if resume else None
        run_id=previous['id'] if previous else uuid.uuid4().hex
        start=previous['next_page'] if previous else 0
        if previous:con.execute("UPDATE browser_runs SET status='running',updated=? WHERE id=?",(now(),run_id))
        else:con.execute('INSERT INTO browser_runs VALUES(?,?,0,?,?)',(run_id,pages,'running',now()))
    try:
        for page_no in range(start,pages):
            if stop.is_set():raise Stopped()
            report(f'Đang tải trang {page_no+1}/{pages} · 50 gói/trang…')
            data=adapter.fetch(payload(page_no))
            rows=data['content']
            current=data.get('currentPage',data.get('number'))
            if current is None or int(current)!=page_no:raise ValueError('Nguồn trả sai số trang; đã dừng để tránh lưu trùng.')
            total_pages=int(data.get('totalPages',0))
            if int(data.get('pageSize',0))!=50:raise ValueError(f'Nguồn trả {int(data.get("pageSize",0))} gói/trang thay vì 50; đã dừng để tránh bỏ sót trang.')
            if not rows:
                if page_no<total_pages:raise ValueError('Nguồn trả trang trống trong phạm vi còn dữ liệu. Hãy tải tiếp sau.')
                break
            if len(rows)>50 or any(r.get('isMedicine') not in (1,'1',True) for r in rows):raise ValueError('Phản hồi không đúng bộ lọc thuốc; đã dừng.')
            codes={tender_key(r.get('notifyNo') or r.get('notifyNoStand')) for r in rows}
            with connect(db) as con:
                seen={r[0] for r in con.execute('SELECT tender_no FROM browser_seen WHERE run_id=?',(run_id,))}
                if codes and codes<=seen:raise ValueError('Nguồn lặp lại trang đã tải. Đã giữ tiến độ; thử tải tiếp sau.')
                save_records(con,'tenders',rows)
                con.executemany('INSERT OR IGNORE INTO browser_seen VALUES(?,?)',[(run_id,c) for c in codes if c])
                con.execute('UPDATE browser_runs SET next_page=?,updated=? WHERE id=?',(page_no+1,now(),run_id))
            report(f'Đã lưu trang {page_no+1}/{min(pages,total_pages or pages)} · {len(seen|codes):,} mã gói trong lượt này')
            if page_no+1>=total_pages and total_pages:break
            if stop.wait(1):raise Stopped()
        if recheck:
            with connect(db) as con:seen={r[0] for r in con.execute('SELECT tender_no FROM browser_seen WHERE run_id=?',(run_id,))}
            _,records=search('tenders',size=1000000,db=db)
            pending=[r for r in records if r.get('state') in ('open','awaiting','reviewing') and r.get('tender_no') and r['tender_no'] not in seen]
            missing=0
            for i,obj in enumerate(pending):
                if stop.is_set():raise Stopped()
                report(f'Kiểm tra lại gói chưa có kết quả {i+1}/{len(pending)} · {obj["tender_no"]}')
                result=adapter.fetch(payload(0,obj['tender_no']))
                rows=[r for r in result['content'] if tender_key(r.get('notifyNo') or r.get('notifyNoStand'))==obj['tender_no']]
                if rows:
                    with connect(db) as con:save_records(con,'tenders',rows)
                else:missing+=1
                if stop.wait(1):raise Stopped()
            if missing:report(f'{missing} gói cũ không tìm thấy trong lần kiểm tra; giữ dữ liệu cũ, không tự đánh dấu đã có kết quả.')
        with connect(db) as con:
            con.execute("UPDATE browser_runs SET status='complete',updated=? WHERE id=?",(now(),run_id))
            con.execute("UPDATE browser_runs SET status='superseded' WHERE pages=? AND id!=? AND status IN ('running','paused')",(pages,run_id))
            done=con.execute('SELECT next_page FROM browser_runs WHERE id=?',(run_id,)).fetchone()[0]
        report(f'Hoàn tất {done} trang trong phạm vi đã chọn. Đây là cửa sổ kết quả của nguồn, không phải toàn bộ lịch sử.')
    except BaseException:
        with connect(db) as con:con.execute("UPDATE browser_runs SET status='paused',updated=? WHERE id=?",(now(),run_id))
        raise

class BrowserUpdater:
    """All Playwright objects stay on a single long-lived worker thread."""
    def __init__(self,report,finished):
        def status(message):
            report(message)
            try:
                (ROOT/'data'/'update_status.json').write_text(json.dumps({'time':now(),'message':message},ensure_ascii=False),encoding='utf-8')
            except OSError:pass
        self.report=status;self.finished=finished;self.stop=threading.Event();self.retry=threading.Event()
        self.jobs=queue.Queue();self.busy=False
        self.thread=threading.Thread(target=self.work,daemon=True);self.thread.start()

    def start(self,pages,resume=False,recheck=True,prices=False):
        if self.busy:raise ValueError('Một lượt cập nhật đang chạy.')
        self.busy=True;self.stop.clear();self.jobs.put((pages,resume,recheck,prices))

    def work(self):
        adapter=SiteBrowser(self.stop,self.report,self.retry)
        try:
            while True:
                job=self.jobs.get()
                if job is None:break
                try:
                    run_pages(adapter,job[0],self.stop,self.report,resume=job[1],recheck=job[2])
                    if job[3] and not self.stop.is_set():
                        from sync import Downloader
                        loader=Downloader(report=self.report);loader.stop=self.stop
                        self.report('Đang cập nhật đơn giá thuốc trong 30 ngày gần nhất…')
                        loader.run((date.today()-timedelta(days=29)).isoformat(),date.today().isoformat(),True)
                except Stopped:self.report('Đã dừng và lưu tiến độ. Chọn cùng số trang, rồi bấm “Tải tiếp lượt dở”.')
                except Exception as e:
                    # Never display browser exception messages: they can contain token URLs.
                    self.report(str(e) if isinstance(e,(ValueError,RuntimeError)) else 'Chưa kết nối được nguồn ('+type(e).__name__+'). Kiểm tra trình duyệt rồi tải tiếp lượt dở.')
                finally:self.busy=False;self.finished()
        finally:adapter.close()

    def close(self):self.stop.set();self.retry.set();self.jobs.put(None)
