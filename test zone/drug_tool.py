"""Tra cứu DAV trên máy cá nhân. Chỉ dùng thư viện chuẩn Python 3.10+."""
import argparse
import base64
import csv
import hashlib
import http.cookiejar
import io
import json
from pathlib import Path
import sqlite3
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent
DB = ROOT / 'data' / 'thuoc.sqlite3'
BASE = 'https://dichvucong.dav.gov.vn'
API = BASE + '/api/services/app/soDangKy/GetAllPublicServerPaging'
FIELDS = {
    'tenThuoc': 'Tên thuốc', 'soDangKy': 'Số GPLH', 'soDangKyCu': 'Số đăng ký cũ',
    'thongTinThuocCoBan.hoatChatChinh': 'Hoạt chất',
    'thongTinThuocCoBan.hamLuong': 'Hàm lượng',
    'thongTinThuocCoBan.dangBaoChe': 'Dạng bào chế',
    'thongTinThuocCoBan.dongGoi': 'Đóng gói',
    'thongTinThuocCoBan.tieuChuan': 'Tiêu chuẩn',
    'thongTinThuocCoBan.tuoiTho': 'Tuổi thọ',
    'congTySanXuat.tenCongTySanXuat': 'Nhà sản xuất',
    'congTySanXuat.nuocSanXuat': 'Nước sản xuất',
    'congTySanXuat.diaChiSanXuat': 'Địa chỉ sản xuất',
    'congTyDangKy.tenCongTyDangKy': 'Công ty đăng ký',
    'congTyDangKy.nuocDangKy': 'Nước đăng ký',
    'thongTinDangKyThuoc.ngayCapSoDangKy': 'Ngày cấp',
    'thongTinDangKyThuoc.soQuyetDinh': 'Số quyết định',
    'ghiChu': 'Ghi chú', 'id': 'ID nguồn',
}

def norm(value):
    return ''.join(c for c in unicodedata.normalize('NFD', str(value or '').lower().replace('đ', 'd')) if unicodedata.category(c) != 'Mn')

def value(record, path):
    node = record
    for key in path.split('.'):
        node = node.get(key) if isinstance(node, dict) else None
    if node is None and '.' in path:
        node = record.get(path.split('.')[-1])
    return '' if node is None else str(node)

class ClosingConnection(sqlite3.Connection):
    def __exit__(self, *args):
        try:
            return super().__exit__(*args)
        finally:
            self.close()

def connect():
    DB.parent.mkdir(exist_ok=True)
    con = sqlite3.connect(DB, timeout=30, factory=ClosingConnection)
    con.execute('PRAGMA journal_mode=WAL')
    con.execute('CREATE TABLE IF NOT EXISTS drugs (id TEXT PRIMARY KEY, raw TEXT NOT NULL, search TEXT NOT NULL)')
    con.execute('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)')
    con.create_function('fold', 1, norm)
    return con

def meta(con, key, default=None):
    row = con.execute('SELECT value FROM meta WHERE key=?', (key,)).fetchone()
    return json.loads(row[0]) if row else default

def put(con, key, val):
    con.execute('INSERT OR REPLACE INTO meta VALUES (?,?)', (key, json.dumps(val)))

def save(con, records):
    for record in records:
        raw = json.dumps(record, ensure_ascii=False)
        ident = record.get('id')
        if ident is None:
            raise ValueError('Bản ghi không có ID; dừng để tránh mất dữ liệu.')
        con.execute('INSERT OR REPLACE INTO drugs VALUES (?,?,?)',
                    (str(ident), raw, norm(' '.join(value(record, k) for k in FIELDS))))

def import_har(path):
    count = 0
    with open(path, encoding='utf-8-sig') as f:
        har = json.load(f)
    with connect() as con:
        for entry in har['log']['entries']:
            if entry['request']['url'].split('?')[0] != API:
                continue
            content = entry['response']['content']
            text = content.get('text', '')
            if content.get('encoding') == 'base64':
                text = base64.b64decode(text).decode('utf-8-sig')
            if not text:
                continue
            result = json.loads(text).get('result') or {}
            items = result.get('items') or []
            save(con, items)
            count += len(items)
        put(con, 'har_imported', True)
    return count

class Downloader:
    def __init__(self, report=print):
        self.stop = threading.Event()
        self.report = report

    def session(self):
        jar = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
        opener.addheaders = [('User-Agent', 'Mozilla/5.0'), ('Accept', 'application/json')]
        with opener.open(BASE + '/congbothuoc/index', timeout=45) as r:
            r.read()
        headers = {'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'Referer': BASE + '/congbothuoc/index'}
        for cookie in jar:
            if cookie.name == 'XSRF-TOKEN':
                headers['X-XSRF-TOKEN'] = urllib.parse.unquote(cookie.value)
        return opener, headers

    def run(self, page_size=200, restart=False, delay=0.5):
        page_size = max(20, min(200, int(page_size)))
        # OS file lock prevents simultaneous GUI/CLI downloaders writing checkpoints.
        import msvcrt
        DB.parent.mkdir(exist_ok=True)
        with open(DB.parent / 'download.lock', 'a+b') as lock:
            lock.seek(0)
            if not lock.read(1):
                lock.write(b'0'); lock.flush()
            lock.seek(0)
            try:
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError:
                raise RuntimeError('Một tiến trình khác đang tải dữ liệu. Hãy đợi tiến trình đó xong.')
            try:
                self._run(page_size, restart, delay)
            finally:
                lock.seek(0); msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)

    def _run(self, size, restart, delay):
        with connect() as con:
            if restart:
                put(con, 'skip', 0); put(con, 'complete', False); put(con, 'fingerprint', None); con.commit()
            skip = meta(con, 'skip', 0)
            if meta(con, 'complete', False):
                self.report('Lượt tải đã hoàn tất. Chọn Cập nhật từ đầu để quét lại.'); return
            opener, headers = self.session()
            while not self.stop.is_set():
                payload = {'SoDangKyThuoc': {}, 'KichHoat': True, 'skipCount': skip, 'maxResultCount': size, 'sorting': None}
                result = None
                for attempt in range(6):
                    try:
                        req = urllib.request.Request(API, data=json.dumps(payload).encode(), headers=headers)
                        with opener.open(req, timeout=60) as response:
                            body = json.load(response)
                        result = body.get('result')
                        if body.get('success') is False or not isinstance(result, dict) or not isinstance(result.get('items'), list) or not isinstance(result.get('totalCount'), int):
                            raise ValueError('Phản hồi API không đúng cấu trúc mong đợi.')
                        break
                    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
                        if attempt == 5:
                            raise RuntimeError(f'Lỗi tại vị trí {skip}; dữ liệu đã lưu, có thể tiếp tục. {exc}') from exc
                        wait = min(60, 2 ** (attempt + 1))
                        if isinstance(exc, urllib.error.HTTPError):
                            if exc.code == 429:
                                try: wait = min(300, max(wait, int(exc.headers.get('Retry-After', wait))))
                                except ValueError: pass
                            if exc.code in (401, 403):
                                opener, headers = self.session()
                        self.report(f'Thử lại sau {wait}s, vị trí {skip}…')
                        if self.stop.wait(wait): return
                items, total = result['items'], result['totalCount']
                if not items and skip < total:
                    raise RuntimeError(f'Trang rỗng bất thường tại {skip}/{total}. Có thể tiếp tục sau.')
                fingerprint = hashlib.sha256(json.dumps([x.get('id') for x in items]).encode()).hexdigest()
                if items and fingerprint == meta(con, 'fingerprint'):
                    raise RuntimeError('Máy chủ lặp lại trang trước; đã dừng để tránh báo hoàn tất sai.')
                save(con, items)
                skip += len(items)  # Server may cap page size: never skip unseen rows.
                put(con, 'skip', skip); put(con, 'total', total); put(con, 'fingerprint', fingerprint)
                put(con, 'updated', time.strftime('%Y-%m-%d %H:%M:%S'))
                put(con, 'complete', skip >= total)
                con.commit()
                count = con.execute('SELECT count(*) FROM drugs').fetchone()[0]
                self.report(f'Đã duyệt {skip:,}/{total:,} • Đã lưu {count:,} bản ghi riêng biệt')
                if skip >= total:
                    self.report(f'Hoàn tất lượt quét. Lưu {count:,} bản ghi; nguồn báo {total:,}.'); return
                if self.stop.wait(delay): break
            self.report('Đã tạm dừng. Bấm Tải tiếp để tiếp tục từ trang đã lưu.')

def where(filters):
    clauses, args = [], []
    for field, text in filters.items():
        for word in norm(text).split():
            pattern = '%' + word.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
            if field == 'all':
                clauses.append("search LIKE ? ESCAPE '\\'")
            elif field in FIELDS:
                clauses.append("fold(coalesce(json_extract(raw, ?), json_extract(raw, ?))) LIKE ? ESCAPE '\\'")
                args.extend(['$.' + field, '$.' + field.split('.')[-1]])
            else:
                continue
            args.append(pattern)
    return (' WHERE ' + ' AND '.join(clauses) if clauses else ''), args

def search(filters, page=0, size=100):
    clause, args = where(filters)
    with connect() as con:
        total = con.execute('SELECT count(*) FROM drugs' + clause, args).fetchone()[0]
        rows = con.execute('SELECT raw FROM drugs' + clause + ' ORDER BY CAST(id AS INTEGER) DESC LIMIT ? OFFSET ?', args + [size, page*size]).fetchall()
    return total, [json.loads(r[0]) for r in rows]

def export_file(path, filters):
    clause, args = where(filters)
    with connect() as con:
        records = (json.loads(r[0]) for r in con.execute('SELECT raw FROM drugs' + clause + ' ORDER BY CAST(id AS INTEGER) DESC', args))
        if str(path).lower().endswith('.json'):
            with open(path, 'w', encoding='utf-8') as f:
                f.write('[')
                for i, record in enumerate(records):
                    if i: f.write(',\n')
                    json.dump(record, f, ensure_ascii=False)
                f.write(']')
        elif str(path).lower().endswith('.xlsx'):
            def row_xml(values, number):
                cells = ''.join('<c t="inlineStr"><is><t xml:space="preserve">' + escape(''.join(c for c in str(v)[:32767] if ord(c)>=32 or c in '\n\r\t')) + '</t></is></c>' for v in values)
                return f'<row r="{number}">{cells}</row>'.encode('utf-8')
            with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
                z.writestr('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
                z.writestr('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
                z.writestr('xl/workbook.xml', '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Danh mục thuốc" sheetId="1" r:id="rId1"/></sheets></workbook>')
                z.writestr('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
                with z.open('xl/worksheets/sheet1.xml', 'w') as f:
                    f.write(b'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>')
                    f.write(row_xml(FIELDS.values(), 1))
                    for i, record in enumerate(records, 2): f.write(row_xml([value(record,k) for k in FIELDS], i))
                    f.write(b'</sheetData></worksheet>')
        else:
            with open(path, 'w', encoding='utf-8-sig', newline='') as f:
                writer = csv.writer(f); writer.writerow(FIELDS.values())
                for record in records:
                    vals = [value(record,k) for k in FIELDS]
                    writer.writerow(["'"+v if v.lstrip().startswith(('=', '+', '-', '@')) else v for v in vals])

def gui():
    import queue
    import tkinter as tk
    from tkinter import ttk, filedialog, messagebox
    root = tk.Tk(); root.title('Tra cứu thuốc • Dữ liệu DAV trên máy'); root.geometry('1380x820'); root.minsize(950,600)
    style = ttk.Style(); style.theme_use('clam')
    style.configure('.', font=('Segoe UI', 10))
    style.configure('Treeview', rowheight=34, background='white', fieldbackground='white')
    style.configure('Treeview.Heading', font=('Segoe UI', 10, 'bold'), padding=8)
    root.configure(bg='#eef3f5')
    frame = ttk.Frame(root, padding=22); frame.pack(fill='both', expand=True)
    ttk.Label(frame, text='TRA CỨU THUỐC', font=('Segoe UI',22,'bold'), foreground='#096b68').pack(anchor='w')
    ttk.Label(frame, text='Tìm kiếm trên máy • Không giới hạn số trang tải • Giữ nguyên dữ liệu gốc').pack(anchor='w', pady=(4,12))
    status = tk.StringVar(value='Sẵn sàng'); stats = tk.StringVar()
    bar = ttk.Frame(frame); bar.pack(fill='x', pady=8)
    events = queue.Queue(); worker = [None]; downloader = [None]
    def download(restart=False):
        if worker[0] and worker[0].is_alive(): return
        downloader[0] = Downloader(lambda text: events.put(('status',text)))
        def work():
            try: downloader[0].run(restart=restart)
            except Exception as e: events.put(('error',str(e)))
            finally: events.put(('done',None))
        worker[0] = threading.Thread(target=work, daemon=True); worker[0].start(); status.set('Đang kết nối…')
    ttk.Button(bar,text='↓ Tải toàn bộ / Tải tiếp',command=download).pack(side='left',padx=(0,8))
    ttk.Button(bar,text='Tạm dừng',command=lambda: downloader[0] and downloader[0].stop.set()).pack(side='left',padx=4)
    ttk.Button(bar,text='Cập nhật từ đầu',command=lambda: download(True)).pack(side='left',padx=4)
    ttk.Label(frame,textvariable=stats,foreground='#096b68').pack(anchor='w',pady=5)
    progress=ttk.Progressbar(frame,maximum=100,mode='determinate'); progress.pack(fill='x',pady=(0,8))
    ttk.Label(frame,textvariable=status,wraplength=1250).pack(anchor='w',pady=(0,12))
    inputs = ttk.LabelFrame(frame,text='Tìm không dấu · Các điều kiện được kết hợp',padding=12); inputs.pack(fill='x')
    variables = {}
    labels = [('all','Từ khóa bất kỳ'),('tenThuoc','Tên thuốc'),('soDangKy','Số GPLH'),('thongTinThuocCoBan.hoatChatChinh','Hoạt chất'),('congTySanXuat.tenCongTySanXuat','Nhà sản xuất'),('congTySanXuat.nuocSanXuat','Nước sản xuất'),('congTyDangKy.tenCongTyDangKy','Công ty đăng ký'),('thongTinDangKyThuoc.soQuyetDinh','Số quyết định'),('thongTinThuocCoBan.hamLuong','Hàm lượng'),('thongTinThuocCoBan.dangBaoChe','Dạng bào chế'),('soDangKyCu','Số đăng ký cũ'),('thongTinDangKyThuoc.ngayCapSoDangKy','Ngày cấp (YYYY-MM-DD hoặc năm)')]
    for i,(key,label) in enumerate(labels):
        box=ttk.Frame(inputs); box.grid(row=i//4,column=i%4,sticky='ew',padx=6,pady=5); inputs.columnconfigure(i%4,weight=1)
        ttk.Label(box,text=label).pack(anchor='w'); variables[key]=tk.StringVar()
        entry=ttk.Entry(box,textvariable=variables[key]); entry.pack(fill='x'); entry.bind('<Return>',lambda e: refresh(True))
    page=[0]; rows=[[]]; count=[0]; applied=[{}]
    actions=ttk.Frame(frame); actions.pack(fill='x',pady=12)
    result_text=tk.StringVar()
    def refresh(reset=False):
        if reset:
            page[0]=0; applied[0]={k:v.get().strip() for k,v in variables.items() if v.get().strip()}
        count[0],rows[0]=search(applied[0],page[0])
        tree.delete(*tree.get_children())
        for i,record in enumerate(rows[0]): tree.insert('', 'end', iid=str(i), values=[value(record,k) for k in columns])
        result_text.set(f'{count[0]:,} kết quả • Trang {page[0]+1}/{max(1,(count[0]+99)//100)} • 100 dòng/trang')
    def reset():
        for var in variables.values(): var.set('')
        refresh(True)
    def export(ext):
        path=filedialog.asksaveasfilename(defaultextension='.'+ext,initialfile='danh_muc_thuoc.'+ext,filetypes=[(ext.upper(),'*.'+ext)])
        if not path: return
        filters=dict(applied[0]); status.set('Đang xuất toàn bộ kết quả lọc…')
        def work():
            try: export_file(path,filters); events.put(('status','Đã xuất: '+path))
            except Exception as e: events.put(('error',str(e)))
        threading.Thread(target=work,daemon=True).start()
    ttk.Button(actions,text='Tìm kiếm',command=lambda:refresh(True)).pack(side='left')
    ttk.Button(actions,text='Xóa bộ lọc',command=reset).pack(side='left',padx=8)
    for ext in ['xlsx','csv','json']: ttk.Button(actions,text='Xuất '+ext.upper(),command=lambda e=ext:export(e)).pack(side='right',padx=4)
    columns=['tenThuoc','soDangKy','thongTinThuocCoBan.hoatChatChinh','thongTinThuocCoBan.hamLuong','congTySanXuat.tenCongTySanXuat','congTySanXuat.nuocSanXuat']
    table=ttk.Frame(frame); table.pack(fill='both',expand=True)
    tree=ttk.Treeview(table,columns=columns,show='headings',selectmode='browse')
    for k in columns: tree.heading(k,text=FIELDS[k]); tree.column(k,width=230 if k not in ('soDangKy','congTySanXuat.nuocSanXuat') else 130,minwidth=90)
    tree.grid(row=0,column=0,sticky='nsew'); table.rowconfigure(0,weight=1); table.columnconfigure(0,weight=1)
    sy=ttk.Scrollbar(table,orient='vertical',command=tree.yview); sy.grid(row=0,column=1,sticky='ns'); tree.configure(yscrollcommand=sy.set)
    sx=ttk.Scrollbar(table,orient='horizontal',command=tree.xview); sx.grid(row=1,column=0,sticky='ew'); tree.configure(xscrollcommand=sx.set)
    def detail(event=None):
        if not tree.selection(): return
        record=rows[0][int(tree.selection()[0])]; win=tk.Toplevel(root); win.title(value(record,'tenThuoc')); win.geometry('900x660')
        text=tk.Text(win,wrap='word',font=('Segoe UI',11),padx=20,pady=20); text.pack(fill='both',expand=True)
        text.insert('end','\n\n'.join(FIELDS[k]+': '+value(record,k) for k in FIELDS)+'\n\nDỮ LIỆU GỐC\n'+json.dumps(record,ensure_ascii=False,indent=2)); text.configure(state='disabled')
    tree.bind('<Double-1>',detail); tree.bind('<Return>',detail)
    nav=ttk.Frame(frame); nav.pack(fill='x',pady=10)
    def move(delta):
        page[0]=max(0,min(max(0,(count[0]-1)//100),page[0]+delta)); refresh()
    ttk.Button(nav,text='← Trước',command=lambda:move(-1)).pack(side='left')
    ttk.Button(nav,text='Sau →',command=lambda:move(1)).pack(side='left',padx=8)
    ttk.Label(nav,textvariable=result_text).pack(side='left',padx=12)
    ttk.Button(nav,text='Xem chi tiết',command=detail).pack(side='right')
    ttk.Label(frame,text='Nguồn: Cục Quản lý Dược. Dữ liệu cấp đăng ký gốc có thể chưa gồm đính chính, thay đổi, bổ sung hoặc thu hồi.\nNhấp đúp để xem chi tiết. Xuất file lấy toàn bộ kết quả lọc, không chỉ trang đang xem.',wraplength=1250,foreground='#596a72').pack(anchor='w')
    def poll():
        while not events.empty():
            kind,text=events.get()
            if kind=='done': refresh()
            else: status.set(text)
            if kind=='error': messagebox.showerror('Chưa hoàn tất',text)
        with connect() as con:
            n=con.execute('SELECT count(*) FROM drugs').fetchone()[0]; total=meta(con,'total',0); pos=meta(con,'skip',0)
            progress['value']=min(100,pos*100/total) if total else 0
            stats.set(f'Đã lưu: {n:,} bản ghi | Tiến độ quét: {pos:,}/{total:,} | Lần lưu: {meta(con,"updated","chưa tải trực tuyến")}')
        root.after(1500,poll)
    def close():
        if downloader[0]: downloader[0].stop.set()
        root.destroy()
    root.protocol('WM_DELETE_WINDOW',close); refresh(True); poll(); root.mainloop()

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--download',action='store_true'); parser.add_argument('--restart',action='store_true'); parser.add_argument('--import-har'); parser.add_argument('--export'); args=parser.parse_args()
    with connect(): pass
    if args.import_har: print('Đã nhập',import_har(args.import_har))
    if args.download: Downloader().run(restart=args.restart)
    elif args.export: export_file(args.export,{})
    elif not args.import_har: gui()

if __name__=='__main__': main()
