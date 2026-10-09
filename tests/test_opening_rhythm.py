import json
import sqlite3
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

from server import map_view


class OpeningRhythmTest(unittest.TestCase):
    def test_raw_opening_dates_include_closed_packages_and_deduplicate(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'msc.sqlite3'
            con = sqlite3.connect(path)
            con.execute('CREATE TABLE records(kind TEXT, normalized TEXT, raw TEXT)')
            rows = [
                ('IB1', '', '2099-01-01', '2026-09-03'),
                ('IB1', '', '2099-01-01', '2026-09-03'),
                ('IB2', 'CNTTT', '2026-09-04', '2026-09-04'),
                ('IB3', '', '2099-01-01', None),
                ('IB4', '', '2099-01-01', '2026-09-05'),
            ]
            for index, (number, status, close, opening) in enumerate(rows):
                normalized = {'tender_no': number, 'source_id': str(index), 'province': '' if number == 'IB4' else 'Hà Nội',
                              'published': '2026-08-01', 'close_date': close, 'status_code': status, 'bid_price': 100}
                con.execute('INSERT INTO records VALUES (?, ?, ?)', ('tenders', json.dumps(normalized), json.dumps({'bidOpenDate': opening})))
            con.commit()
            con.close()
            now = datetime(2026, 10, 5)
            with patch.object(map_view, 'MSC_DB', path), patch('server.msc_scope.load_cache', return_value={}):
                opening_meta = {}
                result = map_view._msc_dots(now, datetime(2025, 11, 1), set(), '', 'open', '', '', None, None, opening_meta)
                with patch.object(map_view, '_msc_rows', return_value=[]), patch.object(map_view, '_window', return_value=(12, now, datetime(2025, 11, 1), datetime(2024, 11, 1), datetime(2025, 10, 31))):
                    payload = map_view._build_msc({'status': 'open'}, 12, with_ingredients=False)
                self.assertEqual(next(point['value'] for point in payload['summary']['countTrend'] if point['key'] == '2026-09'), 3)
            self.assertEqual(result[-1], 3)
            named = [{'code': '01'}]
            provinces = map_view._package_provinces(named, result[3], ['2026-08', '2026-09', '2026-10'], opening_meta)
            self.assertEqual([point['value'] for point in provinces[0]['countTrend']], [0, 2, 0])
            self.assertEqual(provinces[0]['lots'], 2)
