"""Public pricing API downloader with resumable time partitions and honest coverage."""
import hashlib
import http.cookiejar
import json
import ssl
import threading
import urllib.error
import urllib.request
from datetime import datetime,timedelta
from pathlib import Path
from core import BASE, PRICE_API, DB, connect, save_records, now, date_input

CAP=10000

def payload(start,end,medicine,page=0,size=200):
    filters=[{'fieldName':k,'searchType':'in','fieldValues':[v]} for k,v in
        [('medicines',medicine),('type','HANG_HOA'),('tab','THUOC_TAN_DUOC')]]
    filters.append({'fieldName':'ngay_dang_tai_kqlcnt','searchType':'range','from':start+'Z','to':end+'Z'})
    return [{'pageSize':size,'pageNumber':page,'query':[{'index':'es-smart-pricing',
        'keyWord':'','keyWordNotMatch':'','matchType':'all-1',
        'matchFields':['ten_thuoc','ten_hoat_chat','ma_tbmt'],'filters':filters}]}]

class Api:
    def __init__(self,stop=None,report=print):
        self.stop=stop or threading.Event(); self.report=report
        context=ssl.create_default_context()
        # Exclude legacy finite-field DH suites; certificate validation remains on.
        context.set_ciphers('DEFAULT:!DHE')
        self.session=urllib.request.build_opener(urllib.request.HTTPSHandler(context=context),
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def fetch(self,start,end,medicine,page,size=200):
        for attempt in range(5):
            if self.stop.is_set(): raise InterruptedError('Đã tạm dừng.')
            try:
                req=urllib.request.Request(PRICE_API,data=json.dumps(payload(start,end,medicine,page,size)).encode(),
                    headers={'Content-Type':'application/json','User-Agent':'Mozilla/5.0',
                        'Origin':BASE,'Referer':BASE+'/web/guest/winning-bid-data'})
                with self.session.open(req,timeout=60) as r: result=json.load(r)
                part=result.get('page') if isinstance(result,dict) else None
                if not isinstance(part,dict) or not isinstance(part.get('content'),list) or not isinstance(part.get('totalElements'),int):
                    raise ValueError('Nguồn không trả cấu trúc page.content như đã xác minh; dữ liệu chưa được coi là hoàn tất.')
                return part
            except urllib.error.HTTPError as exc:
                if exc.code in (401,403,400):
                    raise RuntimeError(f'Nguồn yêu cầu phiên hợp lệ hoặc thay đổi API (HTTP {exc.code}). Hãy nhập JSON/HAR từ trình duyệt; không bỏ qua xác thực.') from exc
                if exc.code not in (429,500,502,503,504) or attempt==4: raise
                wait=min(60,2**(attempt+1))
                if exc.code==429:
                    try:wait=min(300,max(wait,int(exc.headers.get('Retry-After',wait))))
                    except ValueError:pass
            except (urllib.error.URLError,TimeoutError,OSError) as exc:
                if attempt==4: raise RuntimeError('Kết nối bị gián đoạn. Tiến độ đã lưu; có thể tải tiếp.') from exc
                wait=min(60,2**(attempt+1))
            self.report(f'Nguồn đang bận, thử lại sau {wait} giây…')
            if self.stop.wait(wait): raise InterruptedError('Đã tạm dừng.')

def key_for(start,end,category):
    return hashlib.sha256(f'prices|{category}|{start}|{end}'.encode()).hexdigest()

class Downloader:
    def __init__(self,db=None,report=print,api=None,delay=0.4):
        self.db=Path(db or DB); self.report=report; self.stop=threading.Event(); self.delay=delay
        self.api=api or Api(self.stop,report)

    def run(self,date_from,date_to,refresh=False):
        start=datetime.fromisoformat(date_input(date_from)); end=datetime.fromisoformat(date_input(date_to)).replace(hour=23,minute=59,second=59,microsecond=999000)
        if start>end: raise ValueError('Ngày bắt đầu phải trước ngày kết thúc.')
        import msvcrt
        self.db.parent.mkdir(parents=True,exist_ok=True)
        with open(self.db.parent/'sync.lock','a+b') as lock:
            lock.seek(0)
            if not lock.read(1):lock.write(b'0');lock.flush()
            lock.seek(0)
            try: msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
            except OSError: raise RuntimeError('Một tiến trình khác đang tải đơn giá. Hãy đợi hoặc đóng tiến trình đó.')
            try:
                for category in ('0','1','2'):
                    if self.stop.is_set():break
                    self.partition(start,end,category,refresh)
            finally:
                lock.seek(0);msvcrt.locking(lock.fileno(),msvcrt.LK_UNLCK,1)
        self.report('Đã tạm dừng; có thể tải tiếp cùng khoảng ngày.' if self.stop.is_set() else 'Đã xử lý khoảng ngày đã chọn. Xem mục Phạm vi dữ liệu để biết phần hoàn tất hoặc còn thiếu.')

    def partition(self,start,end,category,refresh):
        if self.stop.is_set():return
        a=start.isoformat(timespec='milliseconds');b=end.isoformat(timespec='milliseconds');key=key_for(a,b,category)
        label={'0':'Generic','1':'Biệt dược gốc','2':'Thuốc dược liệu'}[category]
        with connect(self.db) as con:
            con.execute('INSERT OR IGNORE INTO slices(key,kind,category,date_from,date_to,updated) VALUES(?,?,?,?,?,?)',(key,'prices',category,a,b,now()))
            state=dict(con.execute('SELECT * FROM slices WHERE key=?',(key,)).fetchone())
            if state['status']=='complete' and not refresh:
                self.report(f'{label}: khoảng {a[:10]} → {b[:10]} đã tải đủ.');return
            if refresh:
                con.execute("UPDATE slices SET page=0,seen=0,status='pending',fingerprint=NULL,expected=NULL,message=NULL WHERE key=?",(key,)); state.update(page=0,seen=0,status='pending',fingerprint=None)
                con.execute('DELETE FROM slice_ids WHERE key=?',(key,))
        page=state['page'];seen=state['seen'];fingerprint=state['fingerprint']
        try:
            first=self.api.fetch(a,b,category,0)
            total=first['totalElements']
            if total>=CAP or state['status']=='split':
                if (end-start).total_seconds()<1:
                    raise RuntimeError('Một khoảng dưới 1 giây vẫn chạm giới hạn 10.000. Cần bộ lọc nguồn hẹp hơn; không báo hoàn tất.')
                milliseconds=int((end-start).total_seconds()*1000)
                mid=start+timedelta(milliseconds=milliseconds//2)
                with connect(self.db) as con: con.execute("UPDATE slices SET status='split',expected=?,updated=? WHERE key=?",(total,now(),key))
                self.report(f'{label}: khoảng rộng chạm giới hạn, đang chia nhỏ theo thời gian…')
                self.partition(start,mid,category,refresh)
                self.partition(mid+timedelta(milliseconds=1),end,category,refresh)
                return
            if state.get('expected') is not None and state['expected']!=total and page>0:
                page=0;seen=0;fingerprint=None
                with connect(self.db) as con:
                    con.execute('DELETE FROM slice_ids WHERE key=?',(key,))
                    con.execute("UPDATE slices SET page=0,seen=0,fingerprint=NULL WHERE key=?",(key,))
                self.report(f'{label}: số dòng nguồn đã đổi, quét lại khoảng này để giảm nguy cơ bỏ sót.')
            while not self.stop.is_set():
                data=first if page==0 else self.api.fetch(a,b,category,page)
                rows=data['content'];current_total=data['totalElements']
                if current_total!=total: raise RuntimeError('Nguồn vừa thay đổi trong lúc tải. Bấm tải tiếp để quét lại khoảng này.')
                if data.get('currentPage') is not None and int(data['currentPage'])!=page:
                    raise RuntimeError('Máy chủ trả sai số trang; tiến độ chưa được tăng.')
                size=int(data.get('pageSize') or 200)
                if len(rows)>size or (not rows and seen<total): raise RuntimeError('Trang dữ liệu không khớp số dòng nguồn; dừng để tránh thiếu dữ liệu.')
                fp=hashlib.sha256(json.dumps([r.get('id') for r in rows]).encode()).hexdigest()
                if rows and fp==fingerprint:raise RuntimeError('Nguồn lặp lại trang trước; đã dừng.')
                if seen+len(rows)<total and len(rows)!=size:raise RuntimeError('Trang giữa trả thiếu dòng. Chưa tăng vị trí để tránh bỏ sót.')
                for r in rows:
                    dt=r.get('ngayDangTaiKqlcnt','')
                    try: actual=datetime.fromisoformat(dt.rstrip('Z')).replace(tzinfo=None)
                    except (ValueError,TypeError): raise RuntimeError('Thiếu ngày nguồn, không thể xác minh phạm vi tải.')
                    if not start<=actual<=end:raise RuntimeError('Máy chủ không áp dụng đúng bộ lọc ngày. Dừng để tránh báo đủ sai.')
                    if str(r.get('medicines'))!=category or r.get('tab')!='THUOC_TAN_DUOC': raise RuntimeError('Máy chủ trả sai loại thuốc yêu cầu.')
                seen+=len(rows);page+=1
                with connect(self.db) as con:
                    count,skipped=save_records(con,'prices',rows)
                    if skipped:raise RuntimeError('Có dòng nguồn không nhận diện được; chưa đánh dấu hoàn tất.')
                    con.executemany('INSERT OR IGNORE INTO slice_ids VALUES(?,?)',[(key,str(r['id'])) for r in rows])
                    unique=con.execute('SELECT count(*) FROM slice_ids WHERE key=?',(key,)).fetchone()[0]
                    if seen>=total and unique!=total:
                        raise RuntimeError('Các trang có ID trùng hoặc thiếu. Hãy Cập nhật lại khoảng ngày; chưa đánh dấu tải đủ.')
                    con.execute('UPDATE slices SET page=?,seen=?,expected=?,status=?,fingerprint=?,message=NULL,updated=? WHERE key=?',
                        (page,seen,total,'complete' if seen>=total else 'running',fp,now(),key))
                self.report(f'{label} {a[:10]} → {b[:10]}: {seen:,}/{total:,} dòng')
                if seen>=total:return
                fingerprint=fp
                if self.stop.wait(self.delay):return
        except InterruptedError:
            self.stop.set()
        except Exception as exc:
            with connect(self.db) as con:con.execute("UPDATE slices SET status='error',message=?,updated=? WHERE key=?",(str(exc),now(),key))
            raise
