import csv
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from datetime import datetime
import zipfile
import xml.etree.ElementTree as ET
import core
from sync import Downloader

def drug(i,stamp='2026-09-01T12:00:00',category='0',**changes):
    obj={'id':str(i),'tab':'THUOC_TAN_DUOC','medicines':category,'tenThuoc':'Thuốc Đặc Biệt',
         'tenHoatChat':'Paracetamol','nongDo':'500mg','maTbmt':'IB2600000001',
         'donGia':1250.5,'soLuong':100,'ngayDangTaiKqlcnt':stamp,
         'tenCdtBmt':'Bệnh viện Hà Nội','gdklh_GPNK':'893110386824 (VD-32834-19)',
         'winningName':['Nhà thầu A','Nhà thầu B'],'diaDiem':[{'provName':'Hà Nội'}]}
    obj.update(changes);return obj

class FakeApi:
    def __init__(self,records,cap=10000,fail_on=None):self.records=records;self.cap=cap;self.fail_on=fail_on;self.calls=[]
    def fetch(self,start,end,category,page,size=200):
        self.calls.append((start,end,category,page))
        if self.fail_on is not None and len(self.calls)==self.fail_on:raise OSError('interrupted')
        rows=[r for r in self.records if r['medicines']==category and datetime.fromisoformat(start)<=datetime.fromisoformat(r['ngayDangTaiKqlcnt'])<=datetime.fromisoformat(end)]
        total=min(self.cap,len(rows));size=2
        return {'content':rows[page*size:(page+1)*size],'totalElements':total,'pageSize':size,'currentPage':page}

class SizedEmptyApi:
    def __init__(self):self.sizes=[]
    def fetch(self,start,end,category,page,size=200):
        self.sizes.append(size)
        return {'content':[],'totalElements':0,'pageSize':size,'currentPage':page}

class CoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.db=Path(self.tmp.name)/'data'/'test.sqlite3'
    def tearDown(self):self.tmp.cleanup()
    def add(self,rows,kind='prices'):
        with core.connect(self.db) as con:core.save_records(con,kind,rows)

    def test_normalization_filter_ranges_and_links(self):
        self.add([drug(1),drug(2,tenThuoc='=Not a formula',tenHoatChat='Amoxicillin',donGia=9000),drug(3,donGia=None,tenThuoc=None)])
        total,rows=core.search('prices',{'q':'thuoc dac','unit_price_min':'1000','unit_price_max':'2000','exclude':'amoxicillin'},db=self.db)
        self.assertEqual(total,1);self.assertEqual(rows[0]['unit_price'],1250.5)
        self.assertEqual(rows[0]['registration_keys'],'893110386824; VD-32834-19')
        self.assertEqual(core.search('prices',{'q':'paracetamol amoxicillin','match':'any'},db=self.db)[0],3)
        self.assertEqual(core.search('prices',{'q':'%'},db=self.db)[0],0)
        with self.assertRaises(ValueError):core.search('prices',{'date_from':'2026-09-30','date_to':'2026-09-01'},db=self.db)
        with self.assertRaises(ValueError):core.search('prices',{'unit_price_min':'1,000'},db=self.db)
        n,groups=core.search('tenders',db=self.db)
        self.assertEqual(n,1);self.assertEqual(groups[0]['drug_rows'],3)
        self.assertIn('chưa có TBMT',groups[0]['source_label'])
        self.add([{'id':'t1','notifyNo':'IB2600000001','notifyVersion':'00','bidName':['Thuốc Generic'],'isMedicine':1,'bidPrice':[10000]}],'tenders')
        self.add([{'id':'t2','notifyNo':'IB2600000001','notifyVersion':'01','bidName':['Thuốc Generic cập nhật'],'isMedicine':1,'bidPrice':[20000]}],'tenders')
        n,groups=core.search('tenders',db=self.db)
        self.assertEqual(n,1);self.assertEqual(groups[0]['bid_price'],20000)
        self.assertEqual(core.search('prices',{'tender_no':'IB2600000001-01','exact_tender':True},db=self.db)[0],3)

    def test_import_idempotent_export_roundtrip_and_missing_names(self):
        p=Path(self.tmp.name)/'import.json';p.write_text(json.dumps({'records':[drug(1),drug(2,tenThuoc=None)]}),encoding='utf-8')
        core.import_file(p,self.db);core.import_file(p,self.db)
        self.assertEqual(core.search('prices',db=self.db)[0],2)
        out=Path(self.tmp.name)/'out.json';core.export_file(out,'prices',db=self.db);core.import_file(out,self.db)
        self.assertEqual(core.search('prices',db=self.db)[0],2)
        out=Path(self.tmp.name)/'out.xlsx';core.export_file(out,'prices',db=self.db)
        with zipfile.ZipFile(out) as z:
            for name in z.namelist():ET.fromstring(z.read(name))
            sheet=ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
            self.assertEqual(len(sheet.find('{*}sheetData')),3)
            numeric=sheet.findall('.//{*}c[@t="n"]/{*}v')
            self.assertIn('1250.5',[n.text for n in numeric])

    def test_date_split_and_resume(self):
        records=[drug(i,f'2026-09-0{1 if i<3 else 2}T12:00:0{i}') for i in range(6)]
        api=FakeApi(records,cap=4,fail_on=4);d=Downloader(self.db,lambda _:None,api,delay=0)
        with patch('sync.CAP',4):
            with self.assertRaises(OSError):d.run('2026-09-01','2026-09-02')
            d=Downloader(self.db,lambda _:None,FakeApi(records,cap=4),delay=0);d.run('2026-09-01','2026-09-02')
        self.assertEqual(core.search('prices',db=self.db)[0],6)
        counts,slices,_=core.coverage(self.db)
        self.assertTrue(any(r['status']=='split' for r in slices))
        self.assertFalse(any(r['status'] in ('error','running','pending') for r in slices))

    def test_duplicate_pages_do_not_claim_complete(self):
        records=[drug(1),drug(2),drug(3),drug(1)]
        d=Downloader(self.db,lambda _:None,FakeApi(records),delay=0)
        with self.assertRaisesRegex(RuntimeError,'trùng'):d.run('2026-09-01','2026-09-01')
        self.assertFalse(any(r['status']=='complete' for r in core.coverage(self.db)[1]))

    def test_browser_adapter_can_request_50_rows_per_page(self):
        api=SizedEmptyApi()
        Downloader(self.db,lambda _:None,api,delay=0,page_size=50).run('2026-09-01','2026-09-01')
        self.assertEqual(api.sizes,[50,50])

    def test_har_only_trusted_endpoint_and_response_data(self):
        response=json.dumps({'page':{'content':[drug(1)]}})
        entries=[
            {'request':{'url':core.PRICE_API,'headers':[{'name':'Cookie','value':'do-not-store'}]},
             'response':{'status':200,'content':{'text':response}}},
            {'request':{'url':'https://example.com'+core.PRICE_API.split('.vn')[1]},
             'response':{'status':200,'content':{'text':json.dumps({'page':{'content':[drug(2)]}})}}}
        ]
        obj={'log':{'entries':entries}}
        path=Path(self.tmp.name)/'source.har';path.write_text(json.dumps(obj),encoding='utf-8');core.import_file(path,self.db)
        self.assertEqual(core.search('prices',db=self.db)[0],1)
        self.assertNotIn('do-not-store',self.db.read_bytes().decode('latin-1'))

if __name__=='__main__':unittest.main()
