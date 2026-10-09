import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch
from server import map_view


class VssCardRangeTest(unittest.TestCase):
    def test_dates_override_twelve_months_and_keep_units_separate(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'vss.sqlite3'
            with closing(sqlite3.connect(path)) as con, con:
                con.execute('CREATE TABLE bids(ma_tinh TEXT,tungay_hd TEXT,nhomthau TEXT,loai TEXT,raw TEXT)')
                for day,amount,qty,unit in [('2024-02-14',900,90,'Viên'),('2024-02-15',70,10,'Viên'),('2024-03-20',30,2,'Lọ'),('2024-03-21',800,80,'Viên'),('2023-02-15',35,5,'Viên')]:
                    con.execute('INSERT INTO bids VALUES(?,?,?,?,?)',('01',day,'1','Tân dược',json.dumps({'thanhtien':amount,'soluong':qty,'donvitinh':unit,'ten_tinh':'Hà Nội'},ensure_ascii=False)))
            with patch.object(map_view,'VSS_DB',path):
                result=map_view._build_vss({'tuNgay':'2024-02-15','denNgay':'2024-03-20','loai':'Tân dược'},12,with_dots=False,with_ingredients=False)
            summary=result['summary']
            self.assertEqual(summary['value'],100)
            self.assertEqual(summary['prev'],35)
            self.assertEqual(summary['lots'],2)
            self.assertEqual(summary['range'],{'from':'2024-02-15','to':'2024-03-20'})
            self.assertEqual(summary['quantities'],[{'unit':'Viên','quantity':10},{'unit':'Lọ','quantity':2}])
            self.assertEqual(summary['trend'][0]['value'],70)
