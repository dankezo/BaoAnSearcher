"""Windows interface for drug tender and winning-price filtering."""
import json
import queue
import threading
import tkinter as tk
from tkinter import ttk,filedialog,messagebox,simpledialog
from datetime import date,datetime
import webbrowser
from core import (ROOT,PRICE_FIELDS,TENDER_FIELDS,connect,search,raw_record,coverage,
                  import_file,export_file,flat)
from sync import Downloader
from browser_update import BrowserUpdater

SORTS={'Mới nhất':'newest','Cũ nhất':'oldest','Tên A → Z':'name','Đơn giá tăng':'price_up','Đơn giá giảm':'price_down'}
MATCHES={'Tất cả từ':'all','Một trong các từ':'any','Cụm từ nguyên vẹn':'phrase'}
STATES={'Tất cả':'','Chưa đóng thầu':'open','Đã đóng · chưa rõ xét thầu':'awaiting','Đang xét thầu':'reviewing',
        'Có nhà thầu trúng':'awarded','Không có nhà thầu trúng':'no_winner','Đã hủy / vô hiệu':'cancelled','Chưa rõ':'unknown','Đã đóng (mọi trạng thái)':'closed'}
PAGE_SIZE=50

def display(value):
    if value is None or value=='':return '—'
    if isinstance(value,(int,float)):
        return f'{value:,.2f}'.rstrip('0').rstrip('.') if isinstance(value,float) else f'{value:,}'
    return flat(value)

def cell_display(key,value):
    if key in ('published','close_date','collected_at') and value:
        try:
            from core import VN
            stamp=datetime.fromisoformat(value.replace('Z','+00:00'))
            if stamp.tzinfo:stamp=stamp.astimezone(VN)
            return stamp.strftime('%d/%m/%Y %H:%M')
        except (ValueError,AttributeError):pass
    return display(value)

class FilterTab:
    def __init__(self,app,kind):
        self.app=app;self.kind=kind;self.page=0;self.rows=[];self.count=0;self.applied={};self.vars={}
        self.frame=ttk.Frame(app.tabs,padding=14)
        app.tabs.add(self.frame,text='  Đơn giá từng thuốc  ' if kind=='prices' else '  Gói thầu thuốc  ')
        note=('Lọc dữ liệu đã tải • Đơn giá theo đơn vị của nguồn • Giá thiếu được giữ trống'
              if kind=='prices' else 'Thông báo đã nhập + mã gói từ bảng đơn giá. Dòng chưa có TBMT được ghi rõ nguồn; không suy ra ngày đóng hoặc giá gói.')
        ttk.Label(self.frame,text=note,wraplength=1300,foreground='#536471').pack(anchor='w',pady=(0,8))
        quick=ttk.Frame(self.frame);quick.pack(fill='x')
        self.vars['q']=tk.StringVar();ttk.Label(quick,text='Từ khóa').pack(side='left',padx=(0,8))
        entry=ttk.Entry(quick,textvariable=self.vars['q'],font=('Segoe UI',12));entry.pack(side='left',fill='x',expand=True)
        entry.bind('<Return>',lambda _:self.apply())
        self.match=tk.StringVar(value='Tất cả từ');ttk.Combobox(quick,textvariable=self.match,values=list(MATCHES),state='readonly',width=22).pack(side='left',padx=8)
        ttk.Button(quick,text='Tìm trong dữ liệu đã lưu',command=self.apply).pack(side='left')
        box=ttk.LabelFrame(self.frame,text='Bộ lọc kết hợp',padding=9);box.pack(fill='x',pady=10)
        if kind=='prices':
            fields=[('name','Tên thuốc'),('ingredient','Hoạt chất'),('strength','Hàm lượng / nồng độ'),('registration','SĐK / GPNK'),
                ('buyer','Bệnh viện / chủ đầu tư'),('province','Tỉnh / thành'),('winner','Nhà thầu trúng'),('manufacturer','Nhà sản xuất'),
                ('tender_no','Mã TBMT'),('group_name','Nhóm thuốc'),('unit','Đơn vị tính'),('medicine_type','Loại thuốc')]
        else:
            fields=[('name','Tên gói thầu'),('tender_no','Mã TBMT'),('buyer','Bệnh viện / chủ đầu tư'),('province','Tỉnh / thành'),
                ('bid_form','Hình thức (DTRR, CHCT…)'),('plan_no','Mã KHLCNT'),('source_label','Nguồn thông tin'),('state','Trạng thái thầu')]
        for i,(key,label) in enumerate(fields):
            cell=ttk.Frame(box);cell.grid(row=i//4,column=i%4,sticky='ew',padx=5,pady=3);box.columnconfigure(i%4,weight=1)
            ttk.Label(cell,text=label).pack(anchor='w');var=tk.StringVar();self.vars[key]=var
            if key=='medicine_type':
                widget=ttk.Combobox(cell,textvariable=var,values=['','Generic','Biệt dược gốc','Thuốc dược liệu'],state='readonly')
            elif key=='state':
                var.set('Tất cả');widget=ttk.Combobox(cell,textvariable=var,values=list(STATES),state='readonly')
            else:widget=ttk.Entry(cell,textvariable=var)
            widget.pack(fill='x');widget.bind('<Return>',lambda _:self.apply())
        ranges=ttk.Frame(self.frame);ranges.pack(fill='x')
        items=[('date_from','Đăng từ (YYYY-MM-DD)'),('date_to','Đăng đến (YYYY-MM-DD)')]
        items += [('unit_price_min','Đơn giá từ'),('unit_price_max','Đơn giá đến'),('quantity_min','Số lượng từ'),('quantity_max','Số lượng đến')] if kind=='prices' else [('bid_price_min','Giá gói từ'),('bid_price_max','Giá gói đến')]
        for i,(key,label) in enumerate(items):
            cell=ttk.Frame(ranges);cell.grid(row=0,column=i,sticky='ew',padx=5);ranges.columnconfigure(i,weight=1)
            ttk.Label(cell,text=label).pack(anchor='w');self.vars[key]=tk.StringVar();en=ttk.Entry(cell,textvariable=self.vars[key],width=16);en.pack(fill='x');en.bind('<Return>',lambda _:self.apply())
        other=ttk.Frame(self.frame);other.pack(fill='x',pady=8)
        ttk.Label(other,text='Loại trừ (cách nhau bằng ;)').pack(side='left');self.vars['exclude']=tk.StringVar()
        ttk.Entry(other,textvariable=self.vars['exclude'],width=30).pack(side='left',fill='x',expand=True,padx=8)
        self.sort=tk.StringVar(value='Mới nhất');ttk.Combobox(other,textvariable=self.sort,values=list(SORTS) if kind=='prices' else list(SORTS)[:3],state='readonly',width=17).pack(side='left')
        ttk.Button(other,text='Xóa lọc',command=self.reset).pack(side='left',padx=6)
        ttk.Button(other,text='Lưu bộ lọc',command=self.save_preset).pack(side='left')
        ttk.Button(other,text='Mở bộ lọc',command=self.load_preset).pack(side='left',padx=6)
        table=ttk.Frame(self.frame);table.pack(fill='both',expand=True)
        self.columns=(['name','ingredient','strength','unit_price','unit','quantity','buyer','province','winner','tender_no','published'] if kind=='prices'
            else ['tender_no','status_label','name','buyer','province','close_date','bid_price','drug_rows','collected_at','source_label'])
        self.tree=ttk.Treeview(table,columns=self.columns,show='headings',selectmode='browse')
        fields=PRICE_FIELDS if kind=='prices' else TENDER_FIELDS
        for key in self.columns:
            width=280 if key in ('name','buyer') else 220 if key=='status_label' else 200 if key in ('ingredient','winner','source_label') else 165 if key in ('published','close_date','collected_at') else 135
            self.tree.heading(key,text=fields[key]);self.tree.column(key,width=width,minwidth=75,anchor='e' if key in ('unit_price','quantity','bid_price','drug_rows') else 'w')
        self.tree.grid(row=0,column=0,sticky='nsew');table.rowconfigure(0,weight=1);table.columnconfigure(0,weight=1)
        sy=ttk.Scrollbar(table,orient='vertical',command=self.tree.yview);sy.grid(row=0,column=1,sticky='ns')
        sx=ttk.Scrollbar(table,orient='horizontal',command=self.tree.xview);sx.grid(row=1,column=0,sticky='ew')
        self.tree.configure(yscrollcommand=sy.set,xscrollcommand=sx.set)
        self.tree.tag_configure('alternate',background='#f1f6f8');self.tree.bind('<Double-1>',lambda _:self.detail());self.tree.bind('<Return>',lambda _:self.detail())
        for tag,color in [('open','#e5f6ec'),('reviewing','#fff3d6'),('awaiting','#fce9df'),('cancelled','#eeeef2')]:self.tree.tag_configure(tag,background=color)
        controls=ttk.Frame(self.frame);controls.pack(fill='x',pady=(10,0))
        ttk.Button(controls,text='← Trước',command=lambda:self.move(-1)).pack(side='left')
        ttk.Button(controls,text='Sau →',command=lambda:self.move(1)).pack(side='left',padx=5)
        self.result=tk.StringVar();ttk.Label(controls,textvariable=self.result).pack(side='left',padx=5)
        for ext in ('json','csv','xlsx'):ttk.Button(controls,text='Xuất '+ext.upper(),command=lambda e=ext:self.export(e)).pack(side='right',padx=3)
        ttk.Button(controls,text='Xem chi tiết',command=self.detail).pack(side='right',padx=3)
        ttk.Button(controls,text='Xem gói thầu' if kind=='prices' else 'Xem các thuốc',command=self.linked).pack(side='right',padx=3)
        self.refresh()

    def read_filters(self):
        result={k:v.get().strip() for k,v in self.vars.items() if v.get().strip()}
        result['match']=MATCHES[self.match.get()]
        if self.kind=='tenders':result['state']=STATES.get(result.get('state',''),'')
        return result

    def apply(self):
        previous=self.applied;self.applied=self.read_filters();self.page=0
        try:self.refresh()
        except ValueError as e:self.applied=previous;messagebox.showerror('Kiểm tra bộ lọc',str(e))

    def refresh(self):
        self.count,self.rows=search(self.kind,self.applied,self.page,size=PAGE_SIZE,sort=SORTS[self.sort.get()])
        self.tree.delete(*self.tree.get_children())
        for i,obj in enumerate(self.rows):self.tree.insert('','end',iid=str(i),values=[cell_display(k,obj.get(k)) for k in self.columns],tags=(obj.get('state','alternate' if i%2 else ''),))
        self.result.set(f'{self.count:,} kết quả · Trang {self.page+1}/{max(1,(self.count+PAGE_SIZE-1)//PAGE_SIZE)} · {PAGE_SIZE} bản ghi/trang')

    def reset(self):
        for key,var in self.vars.items():var.set('Tất cả' if key=='state' else '')
        self.match.set('Tất cả từ');self.sort.set('Mới nhất');self.apply()

    def move(self,delta):
        self.page=max(0,min(max(0,(self.count-1)//PAGE_SIZE),self.page+delta));self.refresh()

    def selected(self):
        selected=self.tree.selection()
        if not selected:
            messagebox.showinfo('Chọn một dòng','Hãy chọn một dòng trong bảng.');return None
        return self.rows[int(selected[0])]

    def detail(self):
        obj=self.selected()
        if obj is None:return
        win=tk.Toplevel(self.app.root);win.title(obj.get('name') or obj.get('tender_no'));win.geometry('980x720')
        head=ttk.Frame(win,padding=12);head.pack(fill='x')
        ttk.Button(head,text='Mở trang nguồn',command=lambda:webbrowser.open(obj['source_url'])).pack(side='left')
        ttk.Label(head,text='Dữ liệu nguồn được giữ nguyên; dấu — nghĩa là chưa có.',wraplength=750).pack(side='left',padx=15)
        box=ttk.Frame(win);box.pack(fill='both',expand=True)
        text=tk.Text(box,wrap='word',font=('Segoe UI',11),padx=18,pady=18)
        scroll=ttk.Scrollbar(box,command=text.yview);text.configure(yscrollcommand=scroll.set);scroll.pack(side='right',fill='y');text.pack(fill='both',expand=True)
        fields=PRICE_FIELDS if self.kind=='prices' else TENDER_FIELDS
        text.insert('end','\n\n'.join(f'{label}: {display(obj.get(key))}' for key,label in fields.items()))
        raw=raw_record(self.kind,obj['source_id'])
        if raw is not None:text.insert('end','\n\nJSON GỐC\n'+json.dumps(raw,ensure_ascii=False,indent=2))
        text.configure(state='disabled')

    def linked(self):
        obj=self.selected()
        if obj is None:return
        code=obj.get('tender_no')
        if not code:messagebox.showinfo('Thiếu mã','Nguồn chưa có mã TBMT để liên kết.');return
        target=self.app.views['tenders' if self.kind=='prices' else 'prices'];target.reset()
        target.vars['tender_no'].set(code);target.applied=target.read_filters();target.applied['exact_tender']=True
        target.refresh();self.app.tabs.select(target.frame)
        if target.count==0:self.app.status.set('Chưa có bản ghi liên quan trong dữ liệu đã lưu. Có thể cần tải khoảng ngày khác hoặc nhập TBMT.')

    def export(self,ext):
        path=filedialog.asksaveasfilename(defaultextension='.'+ext,initialfile=('don_gia_thuoc' if self.kind=='prices' else 'goi_thau_thuoc')+'.'+ext,filetypes=[(ext.upper(),'*.'+ext)])
        if not path:return
        filters=dict(self.applied)
        self.app.background(lambda: (export_file(path,self.kind,filters),f'Đã xuất toàn bộ kết quả lọc: {path}')[1])

    def save_preset(self):
        name=simpledialog.askstring('Lưu bộ lọc','Tên bộ lọc:')
        if not name or not name.strip():return
        with connect() as con:con.execute('INSERT OR REPLACE INTO presets VALUES(?,?,?)',(name.strip(),self.kind,json.dumps({'filters':self.read_filters(),'sort':self.sort.get()},ensure_ascii=False)))
        self.app.status.set('Đã lưu bộ lọc: '+name.strip())

    def load_preset(self):
        with connect() as con:presets=[dict(r) for r in con.execute('SELECT * FROM presets WHERE kind=? ORDER BY name',(self.kind,))]
        if not presets:messagebox.showinfo('Bộ lọc đã lưu','Chưa có bộ lọc nào cho bảng này.');return
        win=tk.Toplevel(self.app.root);win.title('Bộ lọc đã lưu');win.geometry('420x150')
        var=tk.StringVar(value=presets[0]['name']);ttk.Combobox(win,textvariable=var,values=[p['name'] for p in presets],state='readonly',width=45).pack(padx=18,pady=18)
        def load():
            saved=json.loads(next(p['filters'] for p in presets if p['name']==var.get()));filters=saved['filters']
            for key,v in self.vars.items():v.set(next((label for label,code in STATES.items() if code==filters.get(key)), 'Tất cả') if key=='state' else filters.get(key,''))
            self.match.set(next((label for label,code in MATCHES.items() if code==filters.get('match')),'Tất cả từ'))
            self.sort.set(saved.get('sort','Mới nhất'));self.apply();win.destroy()
        ttk.Button(win,text='Áp dụng',command=load).pack()

class App:
    def __init__(self,root):
        self.root=root;root.title('Lọc thầu thuốc • Mua sắm công');root.geometry('1460x960');root.minsize(1050,760)
        style=ttk.Style();style.theme_use('clam');style.configure('.',font=('Segoe UI',10))
        style.configure('Treeview',rowheight=33,background='white',fieldbackground='white');style.configure('Treeview.Heading',font=('Segoe UI',10,'bold'),padding=7)
        style.configure('TNotebook.Tab',padding=(14,8));style.configure('TButton',padding=(9,6))
        outer=ttk.Frame(root,padding=18);outer.pack(fill='both',expand=True)
        header=ttk.Frame(outer);header.pack(fill='x')
        ttk.Label(header,text='LỌC THẦU THUỐC',font=('Segoe UI',23,'bold'),foreground='#155e75').pack(side='left')
        ttk.Button(header,text='Cập nhật dữ liệu',command=self.update_dialog).pack(side='right')
        extra=ttk.Menubutton(header,text='Dữ liệu ▾');extra.pack(side='right',padx=7)
        menu=tk.Menu(extra,tearoff=False);extra.configure(menu=menu)
        menu.add_command(label='Nhập JSON / HAR (dự phòng)',command=self.import_files)
        menu.add_command(label='Tải lịch sử đơn giá theo ngày',command=self.sync_dialog)
        self.metrics=tk.StringVar();ttk.Label(outer,textvariable=self.metrics,foreground='#155e75',font=('Segoe UI',11,'bold')).pack(anchor='w',pady=(8,4))
        self.status=tk.StringVar(value='Tìm kiếm không dấu. File xuất chứa toàn bộ kết quả lọc, không chỉ trang đang xem.')
        ttk.Label(outer,textvariable=self.status,wraplength=1370).pack(anchor='w',pady=(0,8))
        self.events=queue.Queue();self.downloader=None;self.worker=None
        self.update_win=None;self.update_log=None
        self.browser_updater=BrowserUpdater(lambda msg:self.events.put(('browser',msg)),lambda:self.events.put(('refresh',None)))
        self.tabs=ttk.Notebook(outer);self.tabs.pack(fill='both',expand=True);self.views={}
        for kind in ('tenders','prices'):self.views[kind]=FilterTab(self,kind)
        self.history=ttk.Frame(self.tabs,padding=16);self.tabs.add(self.history,text='  Phạm vi dữ liệu  ')
        ttk.Label(self.history,text='Gói thầu: tiến độ theo số trang đã chọn. Đơn giá: “Đủ theo API” xác nhận số ID riêng biệt của khoảng ngày.\nCác phạm vi này không đại diện toàn bộ lịch sử hệ thống.',wraplength=1200).pack(anchor='w',pady=(0,12))
        self.history_tree=ttk.Treeview(self.history,columns=('type','start','end','status','seen','expected','updated'),show='headings')
        for key,label in [('type','Loại thuốc'),('start','Từ thời điểm'),('end','Đến thời điểm'),('status','Trạng thái'),('seen','Dòng đã duyệt'),('expected','Nguồn báo'),('updated','Lần lưu')]:
            self.history_tree.heading(key,text=label);self.history_tree.column(key,width=160)
        self.history_tree.pack(fill='both',expand=True)
        ttk.Button(self.history,text='Làm mới số liệu',command=self.refresh_all).pack(anchor='e',pady=10)
        ttk.Label(outer,text='Đơn giá trúng thầu không phải lợi nhuận. Khi so sánh, cần cùng hoạt chất, hàm lượng, dạng bào chế và đơn vị tính.',foreground='#536471',wraplength=1300).pack(anchor='w',pady=(10,0))
        self.refresh_metrics();root.after(300,self.poll);root.protocol('WM_DELETE_WINDOW',self.close)

    def refresh_metrics(self):
        counts,slices,dates=coverage()
        self.metrics.set(f"{counts.get('prices',0):,} dòng đơn giá  ·  {counts.get('tenders',0):,} thông báo gói thầu đã nhập  ·  Ngày đơn giá: {(dates[0] or '—')[:10]} → {(dates[1] or '—')[:10]}")
        self.history_tree.delete(*self.history_tree.get_children())
        labels={'complete':'Đủ theo API','split':'Đã chia nhỏ','pending':'Chưa tải','running':'Đang tải / tạm dừng','error':'Cần tải tiếp / kiểm tra'}
        for i,row in enumerate(slices):self.history_tree.insert('','end',iid=str(i),values=(
            {'0':'Generic','1':'Biệt dược gốc','2':'Thuốc dược liệu'}.get(row['category'],row['category']),row['date_from'],row['date_to'],labels.get(row['status'],row['status']),row['seen'],row['expected'],row['updated']))
        with connect() as con:runs=[dict(r) for r in con.execute('SELECT * FROM browser_runs ORDER BY updated DESC LIMIT 30')]
        for row in runs:
            self.history_tree.insert('','end',values=('Gói thầu thuốc','Trang 1',f"Trang {row['pages']}",{'complete':'Xong phạm vi','running':'Đang tải / lượt dở','paused':'Chưa hoàn tất','superseded':'Đã có lượt thay thế'}.get(row['status'],row['status']),f"{row['next_page']} trang",f"{row['pages']} trang",row['updated']))

    def refresh_all(self):
        for view in self.views.values():view.refresh()
        self.refresh_metrics()

    def background(self,fn):
        self.status.set('Đang xử lý…')
        def work():
            try:self.events.put(('message',fn()))
            except Exception as e:self.events.put(('error',str(e)))
            finally:self.events.put(('refresh',None))
        threading.Thread(target=work,daemon=True).start()

    def import_files(self):
        paths=filedialog.askopenfilenames(filetypes=[('Dữ liệu JSON / HAR','*.json *.har')])
        if not paths:return
        def work():
            counts={'prices':0,'tenders':0,'skipped':0}
            for path in paths:
                result=import_file(path)
                for k in counts:counts[k]+=result[k]
            return f"Đã nhập/cập nhật {counts['prices']:,} dòng đơn giá, {counts['tenders']:,} gói thầu; bỏ qua {counts['skipped']:,} dòng không phù hợp. ID trùng không nhân đôi."
        self.background(work)

    def helper(self):
        webbrowser.open((ROOT/'HUONG_DAN_TRINH_DUYET.html').as_uri())

    def update_dialog(self,start_pages=None):
        if self.update_win and self.update_win.winfo_exists():self.update_win.lift();return
        win=tk.Toplevel(self.root);self.update_win=win;win.title('Cập nhật dữ liệu thuốc');win.geometry('850x670');win.minsize(760,610)
        frame=ttk.Frame(win,padding=22);frame.pack(fill='both',expand=True)
        ttk.Label(frame,text='Cập nhật gói thầu thuốc',font=('Segoe UI',18,'bold'),foreground='#155e75').pack(anchor='w')
        ttk.Label(frame,text='1. Chọn phạm vi   →   2. Đăng nhập khi trình duyệt mở   →   3. App tự tải và lưu',wraplength=780).pack(anchor='w',pady=(8,14))
        with connect() as con:pending=con.execute("SELECT * FROM browser_runs WHERE status IN ('running','paused') ORDER BY updated DESC LIMIT 1").fetchone()
        pages=tk.IntVar(value=start_pages or (pending['pages'] if pending else 20))
        if pending:ttk.Label(frame,text=f"Lượt chưa xong: đã lưu {pending['next_page']}/{pending['pages']} trang. Dùng ‘Tải tiếp lượt dở’ để nối tiếp.",foreground='#9a5700',wraplength=780).pack(anchor='w',pady=(0,8))
        modes=ttk.LabelFrame(frame,text='Phạm vi tải · 50 gói / trang',padding=12);modes.pack(fill='x')
        ttk.Radiobutton(modes,text='Cập nhật nhanh — 20 trang mới nhất',variable=pages,value=20).pack(anchor='w',pady=4)
        ttk.Radiobutton(modes,text='Quét ban đầu — 200 trang (tối đa 10.000 kết quả)',variable=pages,value=200).pack(anchor='w',pady=4)
        custom=ttk.Frame(modes);custom.pack(fill='x',pady=4)
        ttk.Label(custom,text='Hoặc nhập số trang:').pack(side='left');ttk.Spinbox(custom,from_=1,to=200,textvariable=pages,width=8).pack(side='left',padx=8)
        recheck=tk.BooleanVar(value=True)
        ttk.Checkbutton(frame,text='Kiểm tra lại các gói cũ chưa có kết quả, ngoài các trang trên',variable=recheck).pack(anchor='w',pady=(14,4))
        ttk.Label(frame,text='Bật tùy chọn này có thể mất thêm thời gian. “Chưa có trạng thái xét” nghĩa là nguồn chưa cung cấp trạng thái.',wraplength=780,foreground='#536471').pack(anchor='w')
        prices=tk.BooleanVar(value=True)
        ttk.Checkbutton(frame,text='Cập nhật thêm đơn giá thuốc trong 30 ngày gần nhất',variable=prices).pack(anchor='w',pady=6)
        actions=ttk.Frame(frame);actions.pack(fill='x',pady=14)
        def begin(resume=False):
            try:
                if self.worker and self.worker.is_alive():raise ValueError('Lượt tải đơn giá đang chạy. Hãy chờ hoặc dừng lượt đó trước.')
                count=pages.get()
                if not 1<=count<=200:raise ValueError('Chọn từ 1 đến 200 trang.')
                self.browser_updater.start(count,resume,recheck.get(),prices.get())
                self.status.set('Đang mở trình duyệt để cập nhật…')
            except (ValueError,tk.TclError) as e:messagebox.showinfo('Cập nhật',str(e),parent=win)
        ttk.Button(actions,text='Bắt đầu cập nhật',command=begin).pack(side='left')
        ttk.Button(actions,text='Tải tiếp lượt dở',command=lambda:begin(True)).pack(side='left',padx=6)
        ttk.Button(actions,text='Dừng và lưu',command=self.browser_updater.stop.set).pack(side='left')
        ttk.Button(actions,text='Thử lại',command=self.browser_updater.retry.set).pack(side='right')
        ttk.Label(frame,textvariable=self.status,wraplength=780,foreground='#155e75').pack(anchor='w',pady=(0,8))
        logs=ttk.Frame(frame);logs.pack(fill='both',expand=True)
        self.update_log=tk.Text(logs,height=9,wrap='word',font=('Segoe UI',10),state='disabled')
        scroll=ttk.Scrollbar(logs,command=self.update_log.yview);scroll.pack(side='right',fill='y')
        self.update_log.configure(yscrollcommand=scroll.set);self.update_log.pack(fill='both',expand=True)
        ttk.Label(frame,text='App dùng Edge/Chrome, ưu tiên trình duyệt mặc định. Phiên đăng nhập chỉ giữ khi app đang mở.\nBạn vẫn có thể lọc dữ liệu trong lúc tải; đóng bảng này không dừng lượt cập nhật.',wraplength=780,foreground='#536471').pack(anchor='w',pady=(12,0))
        if start_pages:win.after(400,begin)

    def sync_dialog(self):
        win=tk.Toplevel(self.root);win.title('Tải dữ liệu đơn giá thuốc');win.geometry('680x365')
        frame=ttk.Frame(win,padding=22);frame.pack(fill='both',expand=True)
        ttk.Label(frame,text='Generic · Biệt dược gốc · Thuốc dược liệu',font=('Segoe UI',13,'bold')).pack(anchor='w')
        ttk.Label(frame,text='Chọn ngày đăng kết quả. Công cụ tự chia khoảng lớn để tránh giới hạn 10.000 kết quả.\nDữ liệu được lưu sau mỗi trang; tải tiếp bằng cùng khoảng ngày.',wraplength=625).pack(anchor='w',pady=12)
        start=tk.StringVar(value=date.today().replace(day=1).isoformat());end=tk.StringVar(value=date.today().isoformat())
        row=ttk.Frame(frame);row.pack(fill='x',pady=8)
        for label,var in [('Từ ngày',start),('Đến ngày',end)]:ttk.Label(row,text=label).pack(side='left',padx=6);ttk.Entry(row,textvariable=var,width=18).pack(side='left')
        again=tk.BooleanVar();ttk.Checkbutton(frame,text='Quét lại khoảng đã hoàn tất để cập nhật dữ liệu',variable=again).pack(anchor='w',pady=8)
        def begin():
            if self.browser_updater.busy:messagebox.showinfo('Đang cập nhật','Lượt cập nhật dữ liệu đang chạy. Hãy chờ hoặc dùng Dừng và lưu trước.');return
            if self.worker and self.worker.is_alive():messagebox.showinfo('Đang tải','Đã có lượt tải đang chạy.');return
            from core import date_input
            try:
                a=date_input(start.get());b=date_input(end.get())
                if not a or not b or a>b:raise ValueError('Nhập đủ khoảng ngày hợp lệ.')
            except ValueError as e:messagebox.showerror('Ngày chưa hợp lệ',str(e));return
            refresh=again.get();self.downloader=Downloader(report=lambda msg:self.events.put(('status',msg)))
            def work():
                try:self.downloader.run(a,b,refresh)
                except Exception as e:self.events.put(('error',str(e)))
                finally:self.events.put(('refresh',None))
            self.worker=threading.Thread(target=work,daemon=True);self.worker.start();self.status.set('Đang kết nối nguồn…');win.destroy()
        actions=ttk.Frame(frame);actions.pack(fill='x',pady=14)
        ttk.Button(actions,text='Bắt đầu / tải tiếp',command=begin).pack(side='left')
        ttk.Button(actions,text='Tạm dừng lượt đang chạy',command=lambda:self.downloader and self.downloader.stop.set()).pack(side='left',padx=8)
        ttk.Label(frame,text='Ví dụ tải lịch sử: từ 2022-09-16 đến hôm nay.\nKhông bao gồm các bản ghi không có ngày đăng hoặc dữ liệu của hệ thống cũ.',wraplength=620,foreground='#536471').pack(anchor='w')

    def poll(self):
        needs_refresh=False
        while not self.events.empty():
            kind,text=self.events.get()
            if kind=='refresh':needs_refresh=True
            elif kind=='browser':
                self.status.set(text)
                if self.update_log and self.update_log.winfo_exists():
                    self.update_log.configure(state='normal');self.update_log.insert('end',text+'\n');self.update_log.see('end');self.update_log.configure(state='disabled')
                if text.startswith('Đã lưu trang'):needs_refresh=True
            elif kind=='error':self.status.set(text);messagebox.showerror('Chưa hoàn tất',text)
            else:self.status.set(text)
        if needs_refresh:self.refresh_all()
        self.root.after(500,self.poll)

    def close(self):
        if self.downloader:self.downloader.stop.set()
        self.browser_updater.close()
        self.root.withdraw()
        def finish():
            if self.browser_updater.thread.is_alive():self.root.after(200,finish)
            else:self.root.destroy()
        finish()

def main():
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--update-pages',type=int);args=parser.parse_args()
    root=tk.Tk();app=App(root)
    if args.update_pages:root.after(500,lambda:app.update_dialog(args.update_pages))
    root.mainloop()

if __name__=='__main__':main()
