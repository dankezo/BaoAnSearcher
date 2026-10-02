import unittest
from datetime import datetime
from unittest.mock import patch
from server.metric_slice import _msc_prices


class PriceCoverageTest(unittest.TestCase):
    def test_prefers_decision_date_and_computes_yoy_when_evidence_exists(self):
        window = (12, datetime(2026,9,29), datetime(2025,10,1), datetime(2024,10,1), datetime(2025,9,29))
        rows = [dict(decision_date='2026-07-01', published='2026-09-01', quantity=10, unit_price=20, province='A'),
                dict(decision_date='2025-07-01', published='2026-09-01', quantity=10, unit_price=10, province='A')]
        with patch('server.metric_slice._window',return_value=window), patch('server.metric_slice._msc_rows',return_value=rows):
            result = _msc_prices({},12)
        self.assertEqual(result['coverage']['from'],'2025-07-01')
        self.assertEqual(result['coverage']['previousRecords'],1)
        self.assertEqual(result['yoy'],100)
        self.assertEqual(result['revenue'],200)

    def test_no_previous_evidence_is_not_zero_growth(self):
        rows = [dict(decision_date='2026-09-01',quantity=10,unit_price=10)]
        with patch('server.metric_slice._msc_rows',return_value=rows):
            result = _msc_prices({},12)
        self.assertIsNone(result['yoy'])
        self.assertEqual(result['coverage']['previousRecords'],0)


if __name__ == '__main__':
    unittest.main()
