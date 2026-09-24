"""Local procurement store. Source records and provenance are retained separately."""
from __future__ import annotations
import base64
import csv
import hashlib
import json
import math
import re
import sqlite3
import unicodedata
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urlencode, urlparse
import zipfile
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent
DB = ROOT / 'data' / 'procurement.sqlite3'
BASE = 'https://muasamcong.mpi.gov.vn'
PRICE_API = BASE + '/o/egp-portal-winning-bid-data/services/smart/search_prc'
TENDER_API = BASE + '/o/egp-portal-contractor-selection-v2/services/smart/search'
VN = timezone(timedelta(hours=7))
PRICE_FIELDS = {
    'name':'Tên thuốc', 'ingredient':'Hoạt chất', 'strength':'Hàm lượng / nồng độ',
    'registration':'SĐK / GPNK gốc', 'registration_keys':'Mã SĐK trích xuất',
    'unit_price':'Đơn giá (VND)', 'unit':'Đơn vị tính', 'quantity':'Số lượng',
    'group_name':'Nhóm thuốc', 'medicine_type':'Loại thuốc', 'manufacturer':'Nhà sản xuất',
    'country':'Nước sản xuất', 'route':'Đường dùng', 'dosage_form':'Dạng bào chế',
    'packaging':'Đóng gói', 'winner':'Nhà thầu trúng', 'winner_code':'Mã nhà thầu',
    'buyer':'Chủ đầu tư / bệnh viện', 'buyer_code':'Mã chủ đầu tư', 'province':'Tỉnh / thành',
    'tender_no':'Mã TBMT', 'published':'Ngày đăng KQLCNT', 'decision':'Số quyết định',
    'decision_date':'Ngày quyết định', 'source_id':'ID nguồn', 'collected_at':'Thời điểm tải',
    'source_url':'Trang nguồn', 'source_label':'Nguồn dữ liệu',
    'import_note':'Ghi chú nhập Excel',
}
TENDER_FIELDS = {
    'tender_no':'Mã TBMT', 'name':'Tên gói thầu', 'buyer':'Chủ đầu tư / bệnh viện',
    'province':'Tỉnh / thành', 'published':'Ngày đăng', 'close_date':'Đóng thầu',
    'status_label':'Trạng thái thầu', 'collected_at':'Lần kiểm tra', 'bid_price':'Giá gói thầu (VND)',
    'bid_form':'Hình thức LCNT', 'plan_no':'Mã KHLCNT', 'version':'Phiên bản',
    'source_label':'Nguồn thông tin', 'drug_rows':'Dòng đơn giá đã lưu',
    'medicine_evidence':'Cách xác định thuốc', 'source_id':'ID nguồn', 'source_url':'Trang nguồn',
}

def now(): return datetime.now(VN).isoformat(timespec='seconds')

def fold(text):
    return ''.join(c for c in unicodedata.normalize('NFD', str(text or '').lower().replace('đ','d')) if unicodedata.category(c) != 'Mn')

def flat(value):
    if value is None: return ''
    if isinstance(value,list): return '; '.join(flat(v) for v in value if v is not None)
    if isinstance(value,dict): return '; '.join(flat(v) for v in value.values() if v is not None)
    return str(value)

def number(value):
    if value is None or value=='': return None
    if isinstance(value,list): return number(value[0]) if len(value)==1 else None
    try:
        result=float(value)
        return result if math.isfinite(result) else None
    except (TypeError,ValueError): return None

def input_number(text):
    text=str(text).strip().replace(' ','')
    if not text: return None
    if not re.fullmatch(r'\d+(\.\d+)?',text):
        raise ValueError('Giá / số lượng: nhập số không có dấu phân cách hàng nghìn, ví dụ 12500 hoặc 12500.5.')
    return float(text)

def tender_key(value):
    return re.sub(r'-(\d{2})$', '', flat(value).strip().upper())

def registration_keys(value):
    # Candidates only. Do not claim a DAV match without checking the DAV record.
    return sorted(set(re.findall(r'\b(?:[A-Z]{1,5}-\d{2,8}-\d{2,4}|\d{12})\b',flat(value).upper())))

def province(value):
    if isinstance(value,list):
        return '; '.join(dict.fromkeys(flat(x.get('provName')) for x in value if isinstance(x,dict) and x.get('provName')))
    return flat(value)

def tender_link(raw):
    ident=raw.get('notifyId') or raw.get('id')
    if not ident: return BASE+'/web/guest/contractor-selection?render=index'
    params={'p_p_id':'egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2',
        'p_p_lifecycle':'0','p_p_state':'normal','p_p_mode':'view',
        '_egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2_render':'detail-v2',
        'type':raw.get('type','es-notify-contractor'),'id':ident,'notifyId':ident,
        'step':'tbmt','notifyNo':raw.get('notifyNo','')}
    for key in ('stepCode','processApply','bidMode','planNo','isInternet','bidForm'):
        if raw.get(key) is not None: params[key]=raw[key]
    return BASE+'/web/guest/contractor-selection?'+urlencode(params)

def normalize_price(raw):
    return {
        'name':flat(raw.get('tenThuoc')), 'ingredient':flat(raw.get('tenHoatChat')),
        'strength':flat(raw.get('nongDo')), 'registration':flat(raw.get('gdklh_GPNK')),
        'registration_keys':'; '.join(registration_keys(raw.get('gdklh_GPNK'))),
        'unit_price':number(raw.get('donGia')), 'quantity':number(raw.get('soLuong')),
        'unit':flat(raw.get('donViTinh')), 'group_name':flat(raw.get('nhomThuoc')),
        'medicine_type':{'0':'Generic','1':'Biệt dược gốc','2':'Thuốc dược liệu'}.get(str(raw.get('medicines')),flat(raw.get('medicines'))),
        'manufacturer':flat(raw.get('tenCoSoSanXuat')), 'country':flat(raw.get('nuocSanXuat')),
        'route':flat(raw.get('duongDung')), 'dosage_form':flat(raw.get('dangBaoChe')),
        'packaging':flat(raw.get('quyCachDongGoi')), 'winner':flat(raw.get('winningName')),
        'winner_code':flat(raw.get('winningCode')), 'buyer':flat(raw.get('tenCdtBmt')),
        'buyer_code':flat(raw.get('maCdt')), 'province':province(raw.get('diaDiem')),
        'tender_no':tender_key(raw.get('maTbmt')), 'published':flat(raw.get('ngayDangTaiKqlcnt')),
        'decision':flat(raw.get('soQuyetDinh')), 'decision_date':flat(raw.get('ngayBanHanhQuyetDinh')),
        'source_url':BASE+'/web/guest/winning-bid-data',
        'source_label':'Excel Mua sắm công' if raw.get('_excel') else 'API Mua sắm công',
        'import_note':raw.get('_excel',{}).get('note',''),
    }

def normalize_tender(raw):
    name=flat(raw.get('bidName') or raw.get('name'))
    is_medicine=raw.get('isMedicine') in (1,'1',True)
    inferred=bool(re.search(r'\b(thuoc|duoc|vacc?in|sinh pham)\b',fold(name)))
    if not is_medicine and not inferred: return None
    return {'tender_no':tender_key(raw.get('notifyNo') or raw.get('notifyNoStand')),
        'name':name,'buyer':flat(raw.get('investorName') or raw.get('procuringName')),
        'buyer_code':flat(raw.get('investorCode')),'province':province(raw.get('locations')),
        'published':flat(raw.get('publicDate')),'close_date':flat(raw.get('bidCloseDate')),
        'status_code':flat(raw.get('statusForNotify')), 'source_status':flat(raw.get('status')),
        'bid_price':number(raw.get('bidPrice')),'bid_form':flat(raw.get('bidForm')),
        'plan_no':flat(raw.get('planNo')),'version':flat(raw.get('notifyVersion')),
        'medicine_evidence':'Cờ thuốc của nguồn' if is_medicine else 'Ứng viên theo tên gói — cần đối chiếu',
        'source_label':'Thông báo mời thầu','source_url':tender_link(raw)}

class Connection(sqlite3.Connection):
    def __exit__(self,*args):
        try: return super().__exit__(*args)
        finally: self.close()

def connect(db=None):
    path=Path(db or DB); path.parent.mkdir(parents=True,exist_ok=True)
    con=sqlite3.connect(path,timeout=30,factory=Connection)
    con.row_factory=sqlite3.Row
    con.create_function('fold',1,fold)
    con.create_function('tender_state',1,lambda obj:tender_state(json.loads(obj))[0])
    con.execute('PRAGMA journal_mode=WAL')
    con.executescript('''
    CREATE TABLE IF NOT EXISTS records(
      kind TEXT NOT NULL, source_id TEXT NOT NULL, tender_no TEXT NOT NULL,
      raw TEXT NOT NULL, normalized TEXT NOT NULL, search_text TEXT NOT NULL,
      collected_at TEXT NOT NULL, PRIMARY KEY(kind,source_id));
    CREATE INDEX IF NOT EXISTS idx_records_tender ON records(kind,tender_no);
    CREATE TABLE IF NOT EXISTS slices(
      key TEXT PRIMARY KEY, kind TEXT NOT NULL, category TEXT NOT NULL,
      date_from TEXT NOT NULL, date_to TEXT NOT NULL, page INTEGER NOT NULL DEFAULT 0,
      expected INTEGER, seen INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending',
      fingerprint TEXT, message TEXT, updated TEXT);
    CREATE TABLE IF NOT EXISTS imports(
      id INTEGER PRIMARY KEY, imported_at TEXT NOT NULL, filename TEXT NOT NULL,
      prices INTEGER NOT NULL, tenders INTEGER NOT NULL, skipped INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS slice_ids(key TEXT NOT NULL, source_id TEXT NOT NULL, PRIMARY KEY(key,source_id));
    CREATE TABLE IF NOT EXISTS presets(name TEXT PRIMARY KEY, kind TEXT NOT NULL, filters TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS browser_runs(id TEXT PRIMARY KEY, pages INTEGER NOT NULL,
      next_page INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, updated TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS browser_seen(run_id TEXT, tender_no TEXT, PRIMARY KEY(run_id,tender_no));
    CREATE TABLE IF NOT EXISTS price_keys(source_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, is_excel INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_price_keys ON price_keys(fingerprint,is_excel);
    CREATE TABLE IF NOT EXISTS excel_matches(excel_id TEXT PRIMARY KEY, api_id TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_excel_matches_api ON excel_matches(api_id);
    CREATE TABLE IF NOT EXISTS excel_files(file_hash TEXT PRIMARY KEY,filename TEXT NOT NULL,
      exported_at TEXT,imported_at TEXT NOT NULL,row_count INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS excel_rows(file_hash TEXT,sheet TEXT,row_no INTEGER,record_id TEXT,
      original TEXT NOT NULL,PRIMARY KEY(file_hash,sheet,row_no));
    CREATE INDEX IF NOT EXISTS idx_excel_rows_record ON excel_rows(record_id);
    ''')
    con.execute("""UPDATE browser_runs SET status='superseded' WHERE status IN ('running','paused')
      AND EXISTS(SELECT 1 FROM browser_runs completed WHERE completed.status='complete'
      AND completed.pages=browser_runs.pages AND completed.updated>=browser_runs.updated)""")
    con.commit()
    if con.execute('PRAGMA user_version').fetchone()[0]<2:
        for row in con.execute("SELECT source_id,raw,normalized FROM records WHERE kind='tenders'").fetchall():
            raw=json.loads(row['raw']);obj=json.loads(row['normalized'])
            obj.update(status_code=flat(raw.get('statusForNotify')),source_status=flat(raw.get('status')))
            con.execute("UPDATE records SET normalized=? WHERE kind='tenders' AND source_id=?",(json.dumps(obj,ensure_ascii=False),row['source_id']))
        con.execute('PRAGMA user_version=2');con.commit()
    return con

def save_records(con,kind,records,observed_at=None):
    accepted=skipped=0
    for raw in records:
        if not isinstance(raw,dict): skipped+=1; continue
        if kind=='prices':
            if raw.get('tab') not in (None,'THUOC_TAN_DUOC') or not (raw.get('tab')=='THUOC_TAN_DUOC' or raw.get('tenThuoc') or raw.get('tenHoatChat')):
                skipped+=1; continue
            obj=normalize_price(raw)
        elif kind=='tenders':
            obj=normalize_tender(raw)
            if obj is None: skipped+=1; continue
        else: raise ValueError('Loại dữ liệu không hợp lệ')
        source_id=flat(raw.get('id') or (raw.get('notifyId') if kind=='tenders' else None))
        if not source_id: raise ValueError('Bản ghi thiếu ID nguồn. Chưa nhập để tránh gộp nhầm dữ liệu.')
        if observed_at:
            old=con.execute('SELECT collected_at FROM records WHERE kind=? AND source_id=?',(kind,source_id)).fetchone()
            def timestamp(value):
                dt=datetime.fromisoformat(value.replace('Z','+00:00'))
                return dt if dt.tzinfo else dt.replace(tzinfo=VN)
            try:
                if old and timestamp(old[0])>timestamp(observed_at):skipped+=1;continue
            except ValueError:pass
        stamp=observed_at or now(); obj.update(source_id=source_id,collected_at=stamp,source_system='MSC',schema_version=1)
        con.execute('INSERT OR REPLACE INTO records VALUES(?,?,?,?,?,?,?)',(
            kind,source_id,obj.get('tender_no',''),json.dumps(raw,ensure_ascii=False),
            json.dumps(obj,ensure_ascii=False),fold(' '.join(flat(v) for v in obj.values())),stamp))
        if kind=='prices':
            from excel_import import index_price
            index_price(con,source_id,obj,bool(raw.get('_excel')))
        accepted+=1
    return accepted,skipped

def extract_rows(obj):
    if isinstance(obj,list):
        if not obj or all(isinstance(x,dict) and ('id' in x or 'notifyId' in x) for x in obj): return obj
        raise ValueError('Danh sách JSON không phải các bản ghi nguồn có ID.')
    if not isinstance(obj,dict): raise ValueError('Phản hồi không phải dữ liệu JSON dạng đối tượng.')
    for rows in (obj.get('records'),obj.get('resultList'),(obj.get('page') or {}).get('content')):
        if isinstance(rows,list): return rows
    raise ValueError('Không thấy page.content, resultList hoặc records; dữ liệu chưa được nhập.')

def import_file(path,db=None):
    if Path(path).suffix.lower()=='.xlsx':
        from excel_import import import_xlsx
        return import_xlsx(path,db)
    with open(path,encoding='utf-8-sig') as f: obj=json.load(f)
    batches=[]
    if isinstance(obj,dict) and 'log' in obj:
        for entry in obj['log'].get('entries',[]):
            url=entry.get('request',{}).get('url','')
            parsed=urlparse(url)
            if parsed.hostname!='muasamcong.mpi.gov.vn': continue
            if parsed.path==urlparse(TENDER_API).path: kind='tenders'
            elif parsed.path in (urlparse(PRICE_API).path,urlparse(PRICE_API).path+'/export'): kind='prices'
            else: continue
            response=entry.get('response',{})
            if response.get('status')!=200: continue
            content=response.get('content',{}); text=content.get('text')
            if not text: continue
            if content.get('encoding')=='base64': text=base64.b64decode(text).decode('utf-8-sig')
            try: batches.append((kind,extract_rows(json.loads(text)),entry.get('startedDateTime')))
            except (ValueError,TypeError): continue
    else:
        rows=extract_rows(obj)
        rows=[r.get('raw',r) if isinstance(r,dict) else r for r in rows]
        price=[r for r in rows if isinstance(r,dict) and (r.get('tab')=='THUOC_TAN_DUOC' or 'tenThuoc' in r)]
        tender=[r for r in rows if isinstance(r,dict) and ('notifyNo' in r or 'notifyNoStand' in r) and r.get('tab')!='THUOC_TAN_DUOC' and 'tenThuoc' not in r]
        batches=[('prices',price,None),('tenders',tender,None)]
    if not any(rows for _,rows,_ in batches):
        raise ValueError('File không chứa bản ghi thuốc/gói thầu phù hợp. HAR cần có nội dung phản hồi.')
    counts={'prices':0,'tenders':0,'skipped':0}
    with connect(db) as con:
        for kind,rows,stamp in batches:
            count,skipped=save_records(con,kind,rows,stamp); counts[kind]+=count; counts['skipped']+=skipped
        con.execute('INSERT INTO imports(imported_at,filename,prices,tenders,skipped) VALUES(?,?,?,?,?)',
            (now(),Path(path).name,counts['prices'],counts['tenders'],counts['skipped']))
    return counts

def base_query(kind):
    if kind=='prices': return "SELECT source_id, normalized obj, search_text, raw FROM records WHERE kind='prices' AND NOT EXISTS(SELECT 1 FROM excel_matches m WHERE m.excel_id=records.source_id)"
    # A source tender and a price-derived tender are explicitly distinguished.
    return '''WITH price_groups AS (
      SELECT tender_no,count(*) drug_rows,min(json_extract(normalized,'$.buyer')) buyer,
        min(json_extract(normalized,'$.province')) province,max(json_extract(normalized,'$.published')) published
      FROM records WHERE kind='prices' AND tender_no!=''
      AND NOT EXISTS(SELECT 1 FROM excel_matches m WHERE m.excel_id=records.source_id) GROUP BY tender_no
    ), imported AS (
      SELECT *,row_number() OVER(PARTITION BY tender_no ORDER BY json_extract(normalized,'$.version') DESC, collected_at DESC) rn
      FROM records WHERE kind='tenders'
    )
    SELECT t.source_id,json_set(t.normalized,'$.drug_rows',coalesce(p.drug_rows,0)) obj,t.search_text,t.raw
      FROM imported t LEFT JOIN price_groups p ON p.tender_no=t.tender_no WHERE t.rn=1
    UNION ALL
    SELECT 'price:'||p.tender_no,json_object('source_id','price:'||p.tender_no,
      'tender_no',p.tender_no,'name','Chưa có thông báo gốc','buyer',p.buyer,'province',p.province,
      'published',p.published,'source_label','Từ bảng đơn giá — chưa có TBMT','drug_rows',p.drug_rows,
      'source_url','https://muasamcong.mpi.gov.vn/web/guest/winning-bid-data'),
      fold(p.tender_no||' '||p.buyer||' '||p.province),'{}'
      FROM price_groups p WHERE NOT EXISTS(SELECT 1 FROM imported t WHERE t.tender_no=p.tender_no)'''

def date_input(text):
    if not text: return ''
    try: return datetime.strptime(text,'%Y-%m-%d').date().isoformat()
    except ValueError: raise ValueError('Ngày cần ở dạng YYYY-MM-DD, ví dụ 2026-09-01.')

def compile_filters(kind,filters):
    clauses=[]; args=[]
    def like(expression,term,exclude=False):
        clauses.append(expression+(' NOT LIKE ?' if exclude else ' LIKE ?')+" ESCAPE '\\'")
        args.append('%'+fold(term).replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%')
    keyword=filters.get('q','').strip()
    if keyword:
        words=[keyword] if filters.get('match')=='phrase' else keyword.split()
        grouped=[]
        for word in words:
            like('search_text',word); grouped.append(clauses.pop())
        clauses.append('(' + (' OR ' if filters.get('match')=='any' else ' AND ').join(grouped)+')')
    for term in filters.get('exclude','').split(';'):
        if term.strip(): like('search_text',term.strip(),True)
    fields=PRICE_FIELDS if kind=='prices' else TENDER_FIELDS
    for key in fields:
        text=filters.get(key,'').strip() if isinstance(filters.get(key,''),str) else ''
        if not text or key in ('unit_price','quantity','bid_price'): continue
        expr="fold(coalesce(json_extract(obj,'$."+key+"'),''))"
        if key=='tender_no' and filters.get('exact_tender'):
            clauses.append("json_extract(obj,'$.tender_no')=?"); args.append(tender_key(text))
        else: like(expr,text)
    for field in ('unit_price','quantity') if kind=='prices' else ('bid_price',):
        minimum=input_number(filters.get(field+'_min','')); maximum=input_number(filters.get(field+'_max',''))
        if minimum is not None and maximum is not None and minimum>maximum: raise ValueError('Giá trị từ phải nhỏ hơn hoặc bằng giá trị đến.')
        for val,op in ((minimum,'>='),(maximum,'<=')):
            if val is not None: clauses.append("json_extract(obj,'$."+field+"') "+op+' ?'); args.append(val)
    start=date_input(filters.get('date_from','')); end=date_input(filters.get('date_to',''))
    if start and end and start>end: raise ValueError('Ngày bắt đầu phải trước ngày kết thúc.')
    for val,op in ((start,'>='),(end,'<=')):
        if val: clauses.append("substr(json_extract(obj,'$.published'),1,10) "+op+' ?'); args.append(val)
    if kind=='tenders' and filters.get('state')=='closed':
        clauses.append("json_extract(obj,'$.close_date') "+('>' if filters['state']=='open' else '<=')+' ?')
        args.append(datetime.now(VN).replace(tzinfo=None).isoformat(timespec='seconds'))
        clauses.append("length(coalesce(json_extract(obj,'$.close_date'),''))>0")
    elif kind=='tenders' and filters.get('state'):
        clauses.append('tender_state(obj)=?');args.append(filters['state'])
    return (' WHERE '+' AND '.join(clauses) if clauses else ''),args

def tender_state(obj):
    codes={'DXT':('reviewing','Đang xét thầu'),'CNTTT':('awarded','Có nhà thầu trúng'),
      'KCNTTT':('no_winner','Không có nhà thầu trúng'),'DHT':('cancelled','Đã hủy thầu'),
      'DHTBMT':('cancelled','Đã hủy TBMT'),'DHKQLCNT':('cancelled','KQLCNT đã hủy'),
      'VHH':('cancelled','Quyết định KQLCNT vô hiệu')}
    code=obj.get('status_code')
    if code in codes:return codes[code]
    if obj.get('source_status') in ('CANCEL_BID','CANCELED'):return 'cancelled','Đã hủy'
    if code:return 'unknown','Mã nguồn: '+code
    try:
        dt=datetime.fromisoformat(obj.get('close_date','').replace('Z','+00:00'))
        if dt.tzinfo is None:dt=dt.replace(tzinfo=VN)
        if dt>datetime.now(VN):return 'open','Chưa đóng thầu'
        return 'awaiting','Đã đóng · chưa có trạng thái xét'
    except (ValueError,TypeError):return 'unknown','Chưa rõ trạng thái'

def decorate(kind,obj):
    if kind=='tenders':obj['state'],obj['status_label']=tender_state(obj)
    return obj

def search(kind,filters=None,page=0,size=100,db=None,sort='newest'):
    filters=filters or {}; clause,args=compile_filters(kind,filters)
    base='WITH dataset AS ('+base_query(kind)+') '
    sortexpr={'newest':"json_extract(obj,'$.published') DESC",'oldest':"json_extract(obj,'$.published') ASC",
        'price_up':"json_extract(obj,'$.unit_price') IS NULL, json_extract(obj,'$.unit_price') ASC",
        'price_down':"json_extract(obj,'$.unit_price') DESC",'name':"fold(json_extract(obj,'$.name')) ASC"}.get(sort)
    if not sortexpr: raise ValueError('Thứ tự sắp xếp không hợp lệ')
    with connect(db) as con:
        count=con.execute(base+'SELECT count(*) FROM dataset'+clause,args).fetchone()[0]
        rows=con.execute(base+'SELECT obj FROM dataset'+clause+' ORDER BY '+sortexpr+',source_id LIMIT ? OFFSET ?',args+[size,max(0,page)*size]).fetchall()
    return count,[decorate(kind,json.loads(r['obj'])) for r in rows]

def raw_record(kind,source_id,db=None):
    with connect(db) as con:
        row=con.execute('SELECT raw FROM records WHERE kind=? AND source_id=?',(kind,source_id)).fetchone()
        return json.loads(row[0]) if row else None

def coverage(db=None):
    with connect(db) as con:
        counts={r['kind']:r['n'] for r in con.execute("SELECT kind,count(*) n FROM records WHERE NOT EXISTS(SELECT 1 FROM excel_matches m WHERE records.kind='prices' AND m.excel_id=records.source_id) GROUP BY kind")}
        slices=[dict(r) for r in con.execute('SELECT * FROM slices ORDER BY updated DESC LIMIT 500')]
        dates=con.execute("SELECT min(json_extract(normalized,'$.published')),max(json_extract(normalized,'$.published')) FROM records WHERE kind='prices'").fetchone()
    return counts,slices,tuple(dates)

def export_file(path,kind,filters=None,db=None):
    fields=PRICE_FIELDS if kind=='prices' else TENDER_FIELDS
    clause,args=compile_filters(kind,filters or {})
    with connect(db) as con:
        cursor=con.execute('WITH dataset AS ('+base_query(kind)+') SELECT obj,raw FROM dataset'+clause+' ORDER BY source_id',args)
        suffix=Path(path).suffix.lower()
        if suffix=='.json':
            with open(path,'w',encoding='utf-8') as f:
                f.write('{"source_system":"MSC","schema_version":1,"records":[')
                for i,row in enumerate(cursor):
                    if i:f.write(',\n')
                    json.dump({'normalized':decorate(kind,json.loads(row['obj'])),'raw':json.loads(row['raw'])},f,ensure_ascii=False)
                f.write(']}')
            return
        def rows():
            for row in cursor:
                obj=decorate(kind,json.loads(row['obj'])); yield [obj.get(k,'') for k in fields]
        if suffix=='.csv':
            with open(path,'w',encoding='utf-8-sig',newline='') as f:
                w=csv.writer(f); w.writerow(fields.values())
                for row in rows():w.writerow(["'"+v if isinstance(v,str) and v.lstrip().startswith(('=','+','-','@')) else v for v in row])
        elif suffix=='.xlsx': write_xlsx(path,fields.values(),rows())
        else: raise ValueError('Chỉ hỗ trợ CSV, XLSX và JSON.')

def write_xlsx(path,headers,rows):
    def cells(values,index):
        parts=[]
        for val in values:
            if isinstance(val,(int,float)) and not isinstance(val,bool) and math.isfinite(val):
                parts.append(f'<c t="n"><v>{val}</v></c>')
            else:
                text=''.join(c for c in flat(val)[:32767] if (ord(c)>=32 and c not in '\ufffe\uffff') or c in '\t\r\n')
                parts.append('<c t="inlineStr"><is><t xml:space="preserve">'+escape(text)+'</t></is></c>')
        return (f'<row r="{index}">'+''.join(parts)+'</row>').encode('utf-8')
    with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
        z.writestr('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        z.writestr('xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Du lieu thuoc" sheetId="1" r:id="rId1"/></sheets></workbook>')
        z.writestr('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
        with z.open('xl/worksheets/sheet1.xml','w') as f:
            f.write(b'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>')
            f.write(cells(headers,1))
            for i,row in enumerate(rows,2):
                if i>1048576: raise ValueError('Vượt giới hạn dòng Excel. Hãy xuất CSV hoặc thu hẹp bộ lọc.')
                f.write(cells(row,i))
            f.write(b'</sheetData></worksheet>')
