from contextlib import closing
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from scripts.build_rollups import build_vss
from scripts.tidb.sync_to_tidb import refresh_vss_metric_rollup
from server import vss


class VssRollupTest(unittest.TestCase):
    def test_month_uses_contract_start_and_recorded_amount(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'vss.sqlite3'
            with patch.object(vss, 'VSS_DB', path):
                with closing(vss.connect()) as con, con:
                    records = [
                        ('2026-02-05', '2025-12-01', '420.000'),
                        ('', '2026-02-01', '90.000.000.000'),
                        ('2026-02-06', '', None),
                    ]
                    for index, (start, published, amount) in enumerate(records):
                        raw = dict(thanhtien=amount, gia='4.200', soluong='100.000', congbo=published)
                        con.execute('INSERT INTO bids(fingerprint,raw,search,loai,nam,tungay_hd,ma_tinh,nhomthau,hoatchat) VALUES(?,?,?,?,?,?,?,?,?)',
                                    (str(index), json.dumps(raw), 'lacidipin', 'Tân dược', 2026, start, '01', 'N1', 'Lacidipin'))
            rows, _ = build_vss(path)
            february = [row for row in rows if row['ym'] == '2026-02']
            self.assertEqual(sum(row['cnt'] for row in february), 2)
            self.assertEqual(sum(float(row['sum_thanhtien']) for row in february), 420000)
            self.assertTrue(any(row['ym'] == '' and row['cnt'] == 1 for row in rows))

    def test_cloud_snapshot_removes_old_keys_and_uses_contract_start(self):
        with closing(sqlite3.connect(':memory:')) as con:
            con.create_function('YEAR', 1, lambda value: int(value[:4]) if value else None)
            con.create_function('DATE_FORMAT', 2, lambda value, _: value[:7] if value else None)
            con.execute('CREATE TABLE vss_bids(loai TEXT,nam INTEGER,tungay_hd TEXT,ma_tinh TEXT,nhomthau TEXT,thanhtien REAL)')
            con.execute('CREATE TABLE agg_vss_monthly(loai TEXT,nam INTEGER,ym TEXT,ma_tinh TEXT,nhomthau TEXT,sum_thanhtien REAL,cnt INTEGER)')
            con.execute("INSERT INTO agg_vss_monthly VALUES('Tân dược',2026,'2026-01','old','N1',90000000000,1)")
            con.executemany('INSERT INTO vss_bids VALUES(?,?,?,?,?,?)', [('Tân dược',2026,'2026-02-05','01','N1',420000),('Tân dược',2026,None,'01','N1',90000000000),('Tân dược',0,'2026-02-06','01','N1',None)])
            con.commit()
            class Connection:
                cursor = lambda self: closing(con.cursor())
                commit = lambda self: con.commit()
                rollback = lambda self: con.rollback()
            refresh_vss_metric_rollup(Connection())
            self.assertEqual(con.execute("SELECT sum_thanhtien,cnt FROM agg_vss_monthly WHERE ym='2026-02'").fetchone(), (420000,2))
            self.assertEqual(con.execute("SELECT COUNT(*) FROM agg_vss_monthly WHERE ma_tinh='old'").fetchone()[0],0)
            before = con.execute('SELECT * FROM agg_vss_monthly').fetchall()
            con.execute('DROP TABLE vss_bids')
            con.commit()
            with self.assertRaises(sqlite3.OperationalError):
                refresh_vss_metric_rollup(Connection())
            self.assertEqual(con.execute('SELECT * FROM agg_vss_monthly').fetchall(),before)


if __name__ == '__main__':
    unittest.main()
