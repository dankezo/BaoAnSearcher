"""Small, labelled synthetic dataset, never loaded by production analytics."""
import json
import sqlite3
import sys
from pathlib import Path
from server.common import fold

directory=Path(sys.argv[1])
directory.mkdir(exist_ok=True,parents=True)
for source in ('msc_prices','msc_tenders','vss','dav'):
    c=sqlite3.connect(directory/(source+'.sqlite3'))
    if source.startswith('msc'):
        c.execute('create table records(kind text,source_id text,normalized text,search_text text)')
        kind='prices' if source=='msc_prices' else 'tenders'
        for i,(ingredient,date,price,quantity,group,unit) in enumerate([('Ambroxol','2026-02-28','100,25','3','4','Viên'),('Ambroxol','2026-03-01','20','2','4','Viên'),('Ambroxol','2025-02-28','80','5','4','Viên'),('Diosmin','2026-03-01','9007199254740993.01','3,005','2','Viên')]):
            row=dict(ingredient=ingredient,name=ingredient+' DEMO',strength='75mg' if ingredient=='Ambroxol' else '1000mg',dosage_form='Viên',unit_price=price,quantity=quantity,group_name='Nhóm '+group,unit=unit,registration='DEMO-'+ingredient,winner='Đối thủ DEMO',manufacturer='Phương Đông DEMO',province='Cần Thơ',buyer='Bệnh viện DEMO',published=date,bid_price='5000',status_label='Đang mở',tender_no='DEMO-'+str(i),source_id=str(i))
            c.execute('insert into records values(?,?,?,?)',(kind,str(i),json.dumps(row,ensure_ascii=False),fold(' '.join(str(v) for v in row.values()))))
    elif source=='vss':
        c.execute('create table bids(id text,raw text,search text)')
        row=dict(hoatchat='Ambroxol',ten='Ambroxol DEMO',hamluong='75mg',dangbaoche='Viên',sodk='DEMO-Ambroxol',nhomthau='4',donvitinh='Viên',gia='100,25',soluong='3',thanhtien='300,75',tungay_hd='2026-02-28',ten_tinh='Cần Thơ',tennhathau='Đối thủ DEMO',nhasx='Phương Đông DEMO',ten_cskcb='Bệnh viện DEMO')
        c.execute('insert into bids values(?,?,?)',('v1',json.dumps(row,ensure_ascii=False),fold(' '.join(row.values()))))
    else:
        c.execute('create table drugs(id text,raw text,search text)')
        for i,expiry in enumerate(['2027-03-01',None]):
            row=dict(soDangKy='DEMO-Ambroxol',tenThuoc='Ambroxol DEMO',thongTinThuocCoBan=dict(hoatChatChinh='Ambroxol',hamLuong='75mg',dangBaoChe='Viên'),thongTinDangKyThuoc=dict(ngayCapSoDangKy='2026-01-01',ngayHetHanSoDangKy=expiry),congTySanXuat=dict(tenCongTySanXuat='Phương Đông DEMO'),congTyDangKy=dict(tenCongTyDangKy='Đơn vị MAH DEMO'))
            c.execute('insert into drugs values(?,?,?)',(str(i),json.dumps(row,ensure_ascii=False),fold('Ambroxol DEMO Phương Đông DEMO Đơn vị MAH DEMO')))
    c.commit()
    c.close()

# In the real local database both MSC kinds share one records table. Linked
# tender queries therefore need the price rows in the same fixture connection.
c=sqlite3.connect(directory/'msc_tenders.sqlite3')
c.execute('ATTACH DATABASE ? AS prices',(str(directory/'msc_prices.sqlite3'),))
c.execute("INSERT INTO records SELECT * FROM prices.records WHERE kind='prices'")
old=json.loads(c.execute("SELECT normalized FROM records WHERE kind='tenders' AND source_id='0'").fetchone()[0])
new=dict(old,source_id='0-v2',collected_at='2026-03-02',status_label='Đã có kết quả')
c.execute('INSERT INTO records VALUES(?,?,?,?)',('tenders','0-v2',json.dumps(new,ensure_ascii=False),fold(' '.join(str(v) for v in new.values()))))
c.commit()
c.close()
