import json
from contextlib import closing
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from server import ycbg

def quote(ident, no, day='2026-10-13'):
    return {'id':ident,'type':'es-ycbg','notifyNo':no,'name':'Gói thầu thuốc','publicDate':day+'T12:00:00','bidCloseDate':'2026-11-01T12:00:00'}

def detail(item):
    return {'bidoRequestQuote':{'id':item['id'],'requestQuoteNo':item['notifyNo'],'publicDate':item['publicDate'],'receptionDateTo':item['bidCloseDate'],'requestQuoteName':item['name'],'formValue':json.dumps({'forms':{'a':{'Table':[{'medicineCode':'GE.01','tenHoatChat':'Paracetamol','nongDo':'500mg','dangBaoChe':'Viên nén','duongDung':'Uống','nhomTCKT':2}]}}})}}

class YcbgTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.paths=patch.multiple(ycbg,DB=Path(self.tmp.name)/'quotes.sqlite3',ARCHIVE=Path(self.tmp.name)/'files')
        self.paths.start()
    def tearDown(self):
        self.paths.stop();self.tmp.cleanup()
    def test_full_pages_archive_and_pagination(self):
        rows=[quote('a','RQ1'),quote('b','RQ2'),quote('c','RQ3')]
        pages=[]
        def fetch_page(n):
            pages.append(n)
            return {'content':rows[n:n+1],'number':n,'totalElements':3,'totalPages':3}
        with patch.object(ycbg.time,'sleep'),patch.object(ycbg,'public_lines',return_value=[]):
            result=ycbg.crawl(fetch_page=fetch_page,fetch=lambda ident:detail(next(r for r in rows if r['id']==ident)),report=lambda msg:None)
            self.assertEqual(pages,[0,1,2]);self.assertTrue(result['fullScanComplete'])
            self.assertEqual(result['details'],3);self.assertEqual(len(list(ycbg.ARCHIVE.glob('*.json'))),3)
            first=ycbg.search(size=2);second=ycbg.search(page=1,size=2)
            self.assertTrue(first['hasMore']);self.assertEqual(second['total'],3)
            self.assertFalse({r['id'] for r in first['items']} & {r['id'] for r in second['items']})
        lot=ycbg.extract_lots(detail(rows[0]))[0]
        self.assertEqual(lot['groupMedicine'],'2')
    def test_repeated_page_never_marks_history_complete(self):
        rows=[quote('a','RQ1')]
        with patch.object(ycbg.time,'sleep'):
            with self.assertRaises(ValueError):
                ycbg.crawl(fetch_page=lambda n:{'content':rows,'totalElements':2,'totalPages':2},report=lambda msg:None)
        self.assertFalse(ycbg.meta_info()['fullScanComplete'])
        self.assertEqual(ycbg.meta_info()['count'],1)
    def test_detail_failure_keeps_previous_payload(self):
        row=quote('a','RQ1')
        fetch_page=lambda n:{'content':[row],'totalElements':1,'totalPages':1}
        ycbg.crawl(fetch_page=fetch_page,fetch=lambda ident:detail(row),report=lambda msg:None)
        previous=ycbg.meta_info()['updated']
        def fail(ident):raise TimeoutError()
        result=ycbg.crawl(full=True,fetch_page=fetch_page,fetch=fail,report=lambda msg:None)
        self.assertEqual(result['details'],1);self.assertEqual(result['errors'],1)
        self.assertEqual(result['updated'],previous)
    def test_filter_ingredient_and_group_on_same_line(self):
        row=quote('a','RQ1')
        with closing(ycbg.connect()) as con:
            con.execute('INSERT INTO quotes VALUES (?,?,?,?,?)',('a',json.dumps(ycbg.normalize(row)),json.dumps(detail(row)),None,None));con.commit()
        lines=[{'name':'Paracetamol','form':'Viên nén','group':'4','match':''},{'name':'Ambroxol','form':'Viên','group':'2','match':''}]
        with patch.object(ycbg,'public_lines',return_value=lines):
            self.assertEqual(ycbg.search({'ingredient':'Paracetamol','group_name':['2']})['total'],0)
            self.assertEqual(ycbg.search({'ingredient':'Paracetamol','group_name':['N4']})['total'],1)

    def test_daily_reads_three_pages_and_seven_day_overlap(self):
        with closing(ycbg.connect()) as con:
            con.executemany('INSERT INTO crawl_meta VALUES (?,?)',[('full_scan_complete','1'),('completed_at','2026-10-14T12:00:00+07:00')]);con.commit()
        rows=[quote('a','RQ1','2026-10-09'),quote('b','RQ2','2026-10-08'),quote('c','RQ3','2026-10-07'),quote('d','RQ4','2026-10-06'),quote('e','RQ5','2026-10-05')]
        pages=[]
        def fetch_page(n):
            pages.append(n)
            return {'content':[rows[n]],'totalElements':5,'totalPages':5}
        with patch.object(ycbg.time,'sleep'):
            ycbg.crawl(fetch_page=fetch_page,fetch=lambda ident:detail(next(row for row in rows if row['id']==ident)),report=lambda msg:None)
        self.assertEqual(pages,[0,1,2,3])

if __name__=='__main__':unittest.main()
