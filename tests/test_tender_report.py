import json
from contextlib import closing
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from server import tender_report
from server import vss

class TenderReportTest(unittest.TestCase):
    def test_local_list_excludes_missing_dates_and_includes_final_day_fraction(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'vss.sqlite3'
            with patch.object(vss,'VSS_DB',path):
                with closing(vss.connect()) as con, con:
                    for index,day in enumerate([None,'','2025-05-31','2025-06-01','2026-10-01 23:59:59.999','2026-10-02']):
                        con.execute('INSERT INTO bids(fingerprint,raw,search,tungay_hd,hoatchat) VALUES(?,?,?,?,?)',(str(index),'{}','lacidipin',day,'Lacidipin'))
                self.assertEqual(len(vss.search_bids({'tuNgay':'2025-06-01','denNgay':'2026-10-01'})['items']),2)
                self.assertEqual(len(vss.search_bids({'denNgay':'2026-10-01'})['items']),3)

    def test_canonical_numbers_and_contract_window(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'vss.sqlite3'
            with closing(sqlite3.connect(path)) as con, con:
                con.execute('CREATE TABLE bids(id INTEGER,loai TEXT,tungay_hd TEXT,hoatchat TEXT,raw TEXT)')
                for index,day in enumerate([None,'2025-05-31','2025-06-01','2026-10-01 23:59:59','2026-10-02']):
                    row=dict(hoatchat='Lacidipin',sodk='SDK',tungay_hd=day,gia='4.200',soluong='100.000',thanhtien='420.000',_analyticsNumbers={'gia':'4200.00','soluong':'100.000','thanhtien':'420000.00'})
                    con.execute('INSERT INTO bids VALUES(?,?,?,?,?)',(index,'Tân dược',day,'Lacidipin',json.dumps(row)))
            with patch.object(tender_report,'VSS_DB',path),patch.object(tender_report,'DAV_DB',Path(directory)/'missing'):
                payload=tender_report.report_inputs(dict(keyword='lacidipin',start='2025-06-01',end='2026-10-01',searchField='ingredient'))
            self.assertEqual(len(payload['items']),2)
            self.assertEqual(sum(row['quantity'] for row in payload['items']),200)
            self.assertEqual(sum(row['totalAmount'] for row in payload['items']),840000)
            self.assertTrue(all(row['registrationCompany']=='' for row in payload['items']))

if __name__=='__main__':unittest.main()
