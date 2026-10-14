import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from server import msc, metric_slice, tender_report


class MscReportRangeTest(unittest.TestCase):
    def test_list_report_and_metric_share_full_range_and_canonical_amounts(self):
        with tempfile.TemporaryDirectory() as folder:
            db = Path(folder) / 'msc.sqlite3'
            with msc._import_core().connect(db) as con:
                for i, day in enumerate([None, '2025-05-31', '2025-06-01', '2026-10-01T23:59:59', '2026-10-02']):
                    row = dict(source_id=str(i), name='Lacikez 2mg', ingredient='Lacidipin', strength='2mg', published=day, source_label='API Mua sắm công', unit_price='4.200', quantity='100.000', _analyticsNumbers={'unit_price':'4200.00', 'quantity':'100.000'})
                    con.execute('INSERT INTO records VALUES(?,?,?,?,?,?,?)', ('prices', str(i), '', '{}', json.dumps(row), 'lacikez 2mg lacidipin', '2026-10-13'))
            filters = dict(name='Lacikez 2mg', publishedFrom='2025-06-01', publishedTo='2026-10-01', strictDates=True)
            with patch.object(msc, 'MSC_DB', db), patch.object(metric_slice, 'MSC_DB', db), patch.object(tender_report, 'DAV_DB', Path(folder)/'missing'):
                result = msc.search('prices', filters)
                report = tender_report.report_inputs(dict(source='msc', name='Lacikez 2mg', start='2025-06-01', end='2026-10-01'))
                metrics = metric_slice._msc_prices(filters, 12)
            self.assertEqual(len(result['items']), 2)
            self.assertEqual(sum(row['totalAmount'] for row in report['items']), 840000)
            self.assertEqual(metrics['revenue'], 840000)
            self.assertEqual(metrics['coverage']['records'], 2)
            self.assertEqual(metrics['range'], {'from':'2025-06-01', 'to':'2026-10-01'})


if __name__ == '__main__':
    unittest.main()
