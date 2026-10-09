import json
import sys
import tempfile
import threading
import unittest
from datetime import date, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'test zone' / 'procurement'))
import browser_update
import core
import sync
from server import msc_scope


def tender(ident, days=0, **extra):
    return dict(id=ident, notifyNo='IB'+ident, isMedicine=1, bidName='Thuốc',
                publicDate=(date.today()-timedelta(days=days)).isoformat(),
                bidCloseDate='2099-01-01', **extra)


class IncrementalTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.db=Path(self.tmp.name)/'test.sqlite'
    def tearDown(self):
        self.tmp.cleanup()

    def run_tenders(self, pages, codes=None, limit=200):
        calls=[]
        class Adapter:
            def fetch(_, body):
                code=body['query'][0]['keyWord']; number=body['pageNumber']
                calls.append(code or number)
                return dict(content=(codes or {}).get(code, []) if code else pages[number],
                            currentPage=number,pageSize=50,totalPages=len(pages))
        with patch.object(browser_update.time,'sleep'), patch.object(threading.Event,'wait',return_value=False):
            browser_update.run_pages(Adapter(),limit,threading.Event(),lambda _:None,
                                     db=self.db,incremental=True)
        return calls

    def test_stop_at_date_boundary_and_update_known_active(self):
        old=tender('old',30,notifyVersion='1')
        with core.connect(self.db) as con:core.save_records(con,'tenders',[old])
        changed={**old,'notifyVersion':'2','statusForNotify':'CNTTT'}
        pages=[[tender('new')],[tender('boundary',4)],[tender('unused',5)]]
        self.assertEqual(self.run_tenders(pages,{'IBOLD':[changed]}),[0,1,'IBOLD'])
        with core.connect(self.db) as con:
            row=con.execute("SELECT raw FROM records WHERE source_id='old'").fetchone()
            self.assertEqual(json.loads(row[0])['notifyVersion'],'2')
            self.assertIsNone(con.execute("SELECT 1 FROM records WHERE source_id='unused'").fetchone())
        # The old active package was checked today, so a repeated pass skips it.
        self.assertEqual(self.run_tenders(pages),[0,1])

    def test_unchanged_rows_preserve_timestamp_and_changed_rows_replace(self):
        row=tender('same')
        with core.connect(self.db) as con:
            core.save_records(con,'tenders',[row],observed_at='2026-01-01T00:00:00+07:00')
            core.save_records(con,'tenders',[row],only_changed=True)
            self.assertEqual(con.execute('SELECT collected_at FROM records').fetchone()[0],'2026-01-01T00:00:00+07:00')
            core.save_records(con,'tenders',[{**row,'notifyVersion':'2'}],only_changed=True)
            self.assertNotEqual(con.execute('SELECT collected_at FROM records').fetchone()[0],'2026-01-01T00:00:00+07:00')

    def test_limit_and_wrong_order_do_not_advance_checkpoint(self):
        with self.assertRaisesRegex(RuntimeError,'giới hạn'):
            self.run_tenders([[tender('one')],[tender('two')]],limit=1)
        with self.assertRaisesRegex(ValueError,'xếp ngày'):
            self.run_tenders([[tender('older',1),tender('newer')]])
        with core.connect(self.db) as con:
            self.assertEqual(con.execute("SELECT count(*) FROM browser_runs WHERE status='complete'").fetchone()[0],0)

    def test_prices_resume_each_category_from_its_own_successful_window(self):
        today=date.today()
        with core.connect(self.db) as con:
            con.execute("INSERT INTO slices(key,kind,category,date_from,date_to,status,updated) VALUES(?,?,?,?,?,?,?)",
                        ('ok','prices','0',(today-timedelta(days=10)).isoformat(),today.isoformat(),'complete',core.now()))
            con.execute("INSERT INTO slices(key,kind,category,date_from,date_to,status,updated) VALUES(?,?,?,?,?,?,?)",
                        ('failed','prices','1',(today-timedelta(days=10)).isoformat(),today.isoformat(),'error',core.now()))
        loader=sync.Downloader(db=self.db,report=lambda _:None)
        with patch.object(loader,'partition') as partition:
            loader.run((today-timedelta(days=19)).isoformat(),today.isoformat(),refresh=True,incremental=True)
        calls=partition.call_args_list
        self.assertEqual(calls[0].args[0].date(),today-timedelta(days=2))
        self.assertEqual(calls[1].args[0].date(),today-timedelta(days=19))
        self.assertTrue(all(c.kwargs['max_pages'] is None for c in calls))

    def test_missing_active_package_does_not_mark_success(self):
        with core.connect(self.db) as con:core.save_records(con,'tenders',[tender('missing',20)])
        with self.assertRaisesRegex(RuntimeError,'chưa tìm thấy'):
            self.run_tenders([[tender('fresh')]])
        with core.connect(self.db) as con:
            self.assertEqual(con.execute("SELECT count(*) FROM browser_runs WHERE status='complete'").fetchone()[0],0)
            self.assertIsNotNone(con.execute("SELECT 1 FROM records WHERE source_id='missing'").fetchone())

    def test_scope_cache_refreshes_only_changed_or_due_open_packages(self):
        now=datetime.now()
        ids={name:f'{i:08d}-0000-0000-0000-000000000000' for i,name in enumerate(['fresh','changed','due'],1)}
        with patch.object(msc_scope,'MSC_DB',self.db):
            with core.connect(self.db) as con:
                for ident,changed in [('fresh',-2),('changed',0),('due',-30)]:
                    core.save_records(con,'tenders',[tender(ids[ident])],observed_at=(now+timedelta(hours=changed)).isoformat())
            con=msc_scope._connect()
            for ident,age in [('fresh',-1),('changed',-1),('due',-25)]:
                con.execute('INSERT INTO scope_lots VALUES(?,?,?)',(ids[ident],'[]',(now+timedelta(hours=age)).isoformat()))
            con.commit();con.close()
            with patch.object(msc_scope,'_save_scope',return_value='none') as save:
                result=msc_scope.refresh(limit=None)
        self.assertEqual(result['fetched'],2)
        self.assertEqual({c.args[1] for c in save.call_args_list},{ids['changed'],ids['due']})


if __name__=='__main__':unittest.main()
