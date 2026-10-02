import json
import tempfile
import threading
import unittest
from pathlib import Path
import core
from browser_update import run_pages,payload,same_search

def tender(i,**fields):
    return dict(id=str(i),notifyNo=f'IB{i:010}',isMedicine=1,bidName=['Thuốc Generic'],**fields)

class FastStop(threading.Event):
    def wait(self,timeout=None):return self.is_set()

class FakeBrowser:
    def __init__(self,fail=None):self.calls=[];self.fail=fail;self.repeated=False
    def fetch(self,req):
        n=req['pageNumber'];self.calls.append(n)
        if self.fail==n:raise OSError('connection lost')
        key=req['query'][0]['keyWord']
        if key:return {'content':[tender(int(key[2:]),statusForNotify='CNTTT')],'pageSize':50,'currentPage':0,'totalPages':1}
        return {'content':[tender(i) for i in range((0 if self.repeated else n)*50,((0 if self.repeated else n)+1)*50)],'pageSize':50,'currentPage':n,'totalPages':200}

class UpdateTests(unittest.TestCase):
    def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.db=Path(self.tmp.name)/'test.sqlite3'
    def tearDown(self):self.tmp.cleanup()
    def run_update(self,api,pages,**kw):return run_pages(api,pages,FastStop(),lambda _:None,self.db,**kw)

    def test_ignore_site_initial_search_response(self):
        request=payload();self.assertTrue(same_search([request],request))
        other=payload();other['pageSize']=10;self.assertFalse(same_search([other],request))
        other=payload();other['query'][0]['filters']=[];self.assertFalse(same_search([other],request))

    def test_200_pages_and_quick_20_upsert(self):
        api=FakeBrowser();self.run_update(api,200,recheck=False)
        self.assertEqual(api.calls,list(range(200)));self.assertEqual(core.search('tenders',db=self.db)[0],10000)
        api=FakeBrowser();self.run_update(api,20,recheck=False)
        self.assertEqual(api.calls,list(range(20)));self.assertEqual(core.search('tenders',db=self.db)[0],10000)

    def test_resume_after_failure(self):
        with self.assertRaises(OSError):self.run_update(FakeBrowser(fail=2),5,recheck=False)
        self.assertEqual(core.search('tenders',db=self.db)[0],100)
        api=FakeBrowser();self.run_update(api,5,resume=True,recheck=False)
        self.assertEqual(api.calls,[2,3,4]);self.assertEqual(core.search('tenders',db=self.db)[0],250)

    def test_repeated_page_keeps_checkpoint(self):
        api=FakeBrowser();api.repeated=True
        with self.assertRaisesRegex(ValueError,'lặp'):self.run_update(api,5,recheck=False)
        with core.connect(self.db) as con:
            row=con.execute('SELECT next_page,status FROM browser_runs').fetchone()
            self.assertEqual(tuple(row),(1,'paused'))

    def test_recheck_pending_outside_recent_window(self):
        with core.connect(self.db) as con:core.save_records(con,'tenders',[tender(900,statusForNotify='DXT')])
        self.run_update(FakeBrowser(),1,recheck=True)
        total,rows=core.search('tenders',{'state':'awarded'},db=self.db)
        self.assertEqual(total,1);self.assertEqual(rows[0]['tender_no'],'IB0000000900')

    def test_status_filter_matches_display_and_updates(self):
        cases=[('DXT','reviewing'),('CNTTT','awarded'),('KCNTTT','no_winner'),('DHT','cancelled'),('DHTBMT','cancelled'),('DHKQLCNT','cancelled'),('VHH','cancelled')]
        for i,(code,state) in enumerate(cases):
            obj=core.normalize_tender(tender(i,statusForNotify=code,bidCloseDate='2099-01-01T00:00:00'))
            self.assertEqual(core.tender_state(obj)[0],state)
        with core.connect(self.db) as con:
            core.save_records(con,'tenders',[tender(1,statusForNotify='DXT'),tender(2,bidCloseDate='2099-01-01T00:00:00'),tender(3,bidCloseDate='2020-01-01T00:00:00')])
        for state in ('reviewing','open','awaiting'):self.assertEqual(core.search('tenders',{'state':state},db=self.db)[0],1)
        with core.connect(self.db) as con:core.save_records(con,'tenders',[tender(1,statusForNotify='CNTTT')])
        self.assertEqual(core.search('tenders',{'state':'reviewing'},db=self.db)[0],0)
        self.assertEqual(core.search('tenders',{'state':'awarded'},db=self.db)[0],1)

    def test_old_har_does_not_overwrite_newer_result(self):
        with core.connect(self.db) as con:
            core.save_records(con,'tenders',[tender(1,statusForNotify='CNTTT')],'2026-09-21T15:00:00+07:00')
            core.save_records(con,'tenders',[tender(1,statusForNotify='DXT')],'2026-09-21T07:00:00Z')
        self.assertEqual(core.search('tenders',{'state':'awarded'},db=self.db)[0],1)

if __name__=='__main__':unittest.main()
