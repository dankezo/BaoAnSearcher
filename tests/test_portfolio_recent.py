import unittest
from unittest.mock import patch
from datetime import date
from server import portfolio

class PortfolioRecentTest(unittest.TestCase):
    @patch.object(portfolio, '_award_window', return_value=(date(2025,10,5),date(2026,10,5)))
    def test_window_units_and_exact_source_duplicates(self, _):
        row={'registration':'SDK1','group':'N4','unit':'Viên','price':1000,'quantity':10,'buyer':'BV A','province':'Hà Nội','date':'2026-09-01','tenderNo':'IB1','source':'MSC'}
        items=[row,{**row,'source':'VSS'},{**row,'tenderNo':'IB2'}, {**row,'unit':'Lọ','price':2000,'quantity':2}, {**row,'date':'2025-10-04'}, {**row,'date':'2026-10-06'}]
        result=portfolio._awards_12m(items)
        self.assertEqual(result['revenue'],24000)
        self.assertEqual(result['records'],3)
        self.assertEqual(result['packages'],2)
        self.assertEqual({x['unit']:x['quantity'] for x in result['quantityTotals']},{'Viên':20,'Lọ':2})

    def test_sync_keeps_legacy_contract_start_date(self):
        from scripts.tidb.rows import build_vss_row
        row = build_vss_row({'fingerprint': 'date-test', 'raw': {'tungay': '2026-06-25 00:00:00'}})
        self.assertEqual(row['tungay_hd'], '2026-06-25')

    def test_sync_does_not_fill_missing_contract_date_from_award_date(self):
        from scripts.tidb.rows import build_vss_row
        for missing in ('',None):
            row=build_vss_row({'fingerprint':'missing-contract','raw':{'tungay_hd':missing,'tungay':'2026-06-25','congbo':'2026-06-26'}})
            self.assertIsNone(row['tungay_hd'])
            self.assertIsNone(row['tungay_hd_raw'])
