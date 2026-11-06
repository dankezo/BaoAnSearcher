import unittest
from datetime import date, datetime
from decimal import Decimal
from unittest.mock import MagicMock, patch, call

from scripts import vss_daily as daily


def index(count=1):
    return f'''<html><a href="{daily.INDEX}/chiTiet?ngaycongbo=06%2F11%2F2026">06/11/2026</a>
    <a href="{daily.INDEX}/chiTiet?ngaycongbo=06%2F11%2F2026&amp;loai=1">{count}</a>
    <a href="{daily.INDEX}/chiTiet?ngaycongbo=05%2F11%2F2026&amp;loai=2">1</a>
    <a href="{daily.INDEX}/chiTiet?ngaycongbo=03%2F11%2F2026&amp;loai=1">2</a></html>'''


def workbook(day='2026-11-06', kind='Tân dược', copies=1):
    fields = {'ten': 'Ampicillin & Sulbactam', 'sodk': 'VD-1', 'gia': '380.000',
              'soluong': '1.000', 'thanhtien': '380000000', 'loai': kind,
              'congbo': day, 'ma_cskcb': '01001'}
    def row(values):
        return '<Row>' + ''.join(f'<Cell><Data ss:Type="String">{value}</Data></Cell>' for value in values) + '</Row>'
    return ('<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet><Table>'
            + row(fields) + row(fields.values()) * copies + '</Table></Worksheet></Workbook>').encode()


class VssDailyTest(unittest.TestCase):
    def test_network_failures_and_provider_cooldown_are_bounded(self):
        limited = MagicMock(status_code=429, headers={'Retry-After': '25'})
        limited.__enter__.return_value = limited
        good = MagicMock(status_code=200)
        good.__enter__.return_value = good
        good.iter_content.return_value = [b'complete']
        with patch.object(daily.requests, 'get', side_effect=[daily.requests.ConnectionError(), limited, good]) as get, patch.object(daily.time, 'sleep') as sleep:
            self.assertEqual(daily.get_bytes(daily.INDEX), b'complete')
            self.assertEqual(get.call_count, 3)
            self.assertEqual(sleep.call_args_list, [call(15), call(30)])
        limited.headers = {'Retry-After': '120'}
        with patch.object(daily.requests, 'get', return_value=limited) as get, patch.object(daily.time, 'sleep') as sleep:
            with self.assertRaisesRegex(ValueError, 'longer cooldown'):
                daily.get_bytes(daily.INDEX)
            self.assertEqual(get.call_count, 1)
            sleep.assert_not_called()

    def test_plan_uses_published_dates_and_all_medicine_types(self):
        self.assertEqual(daily.parse_index(index(), date(2026, 11, 4), date(2026, 11, 6)),
                         [(date(2026, 11, 6), 1, 1), (date(2026, 11, 5), 2, 1)])

    def test_login_error_and_truncated_index_do_not_claim_empty_success(self):
        for html in ('<html>Login</html>', index().replace('03%2F11', '06%2F11')):
            with self.subTest(html=html), self.assertRaises(ValueError):
                daily.parse_index(html, date(2026, 11, 4), date(2026, 11, 6))

    def test_source_dirty_xml_duplicates_and_vietnamese_numbers(self):
        rows = daily.prepare_rows(workbook(copies=2), date(2026, 11, 6), 1, 2)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['gia'], '380000.00')
        self.assertEqual(rows[0]['soluong'], '1000.000')
        self.assertEqual(rows[0]['ten'], 'Ampicillin & Sulbactam')

    def test_all_four_source_medicine_categories_are_preserved(self):
        for category, kind in daily.KINDS.items():
            with self.subTest(category=category):
                rows = daily.prepare_rows(workbook(kind=kind), date(2026, 11, 6), category, 1)
                self.assertEqual(rows[0]['loai'], kind)

    def test_wrong_count_date_type_and_incomplete_workbook_rejected(self):
        cases = [(workbook(), date(2026, 11, 6), 1, 2),
                 (workbook(), date(2026, 11, 5), 1, 1),
                 (workbook(), date(2026, 11, 6), 2, 1),
                 (workbook()[:-12], date(2026, 11, 6), 1, 1),
                 (b'<html>Workbook</html>', date(2026, 11, 6), 1, 1)]
        for args in cases:
            with self.subTest(args=args[1:]), self.assertRaises(ValueError):
                daily.prepare_rows(*args)

    def test_complete_scan_verifies_both_types_before_success_marker(self):
        fetch = MagicMock(side_effect=[index().encode(), workbook(), workbook('2026-11-05', 'Chế phẩm'), index().encode()])
        publish = MagicMock(side_effect=lambda conn, rows: len(rows))
        with patch.object(daily, '_write_meta') as marker:
            result = daily.sync(MagicMock(), date(2026, 11, 4), date(2026, 11, 6), fetch=fetch, publish=publish, sleep=lambda _: None)
        self.assertTrue(result['complete'])
        self.assertEqual(publish.call_count, 2)
        marker.assert_called_once()
        self.assertEqual([call.kwargs['params']['loai'] for call in fetch.call_args_list if 'params' in call.kwargs], [1, 2])

    def test_partial_scan_keeps_other_days_and_does_not_mark_complete(self):
        fetch = MagicMock(side_effect=[index().encode(), workbook(copies=2), workbook('2026-11-05', 'Chế phẩm'), index().encode()])
        publish = MagicMock(side_effect=lambda conn, rows: len(rows))
        with patch.object(daily, '_write_meta') as marker:
            result = daily.sync(MagicMock(), date(2026, 11, 4), date(2026, 11, 6), fetch=fetch, publish=publish, sleep=lambda _: None)
        self.assertFalse(result['complete'])
        self.assertEqual(publish.call_count, 1)
        marker.assert_not_called()

    def test_source_count_change_during_scan_requires_retry(self):
        fetch = MagicMock(side_effect=[index().encode(), workbook(), workbook('2026-11-05', 'Chế phẩm'), index(2).encode()])
        with patch.object(daily, '_write_meta') as marker:
            result = daily.sync(MagicMock(), date(2026, 11, 4), date(2026, 11, 6), fetch=fetch, publish=lambda conn, rows: len(rows), sleep=lambda _: None)
        self.assertFalse(result['complete'])
        marker.assert_not_called()

    def test_successful_import_timestamp_does_not_hide_older_missing_announcements(self):
        self.assertEqual(daily.replay_start(date(2026, 11, 6), datetime(2026, 10, 22), date(2026, 10, 17)), date(2026, 10, 16))
        self.assertEqual(daily.replay_start(date(2026, 11, 6), datetime(2026, 11, 6), date(2026, 11, 6)), date(2026, 11, 4))
        self.assertEqual(daily.replay_start(date(2026, 11, 6), datetime(2026, 8, 1), date(2026, 8, 1)), date(2026, 10, 8))

    def test_written_price_quantity_and_date_are_verified(self):
        rows = daily.prepare_rows(workbook(), date(2026, 11, 6), 1, 1)
        conn = MagicMock()
        cur = conn.cursor.return_value.__enter__.return_value
        good = (rows[0]['fp_hash'], Decimal('380000'), Decimal('1000'), Decimal('380000000'), date(2026, 11, 6), 'Tân dược')
        with patch.object(daily, '_flush', return_value=1):
            cur.fetchall.return_value = [good]
            self.assertEqual(daily.publish_rows(conn, rows), 1)
            cur.fetchall.return_value = [(good[0], Decimal('380'), *good[2:])]
            with self.assertRaisesRegex(ValueError, 'mismatch'):
                daily.publish_rows(conn, rows)
            cur.fetchall.return_value = []
            with self.assertRaisesRegex(ValueError, 'missing'):
                daily.publish_rows(conn, rows)


if __name__ == '__main__':
    unittest.main()
