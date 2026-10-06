import json
import tempfile
import unittest
from contextlib import closing
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch, MagicMock

from scripts import cloud_daily
from scripts.cloud_browser import open_browser, cloud_search_page
from scripts.tidb import pull_to_local
from scripts.tidb.rows import build_msc_price_row
from server import cloud_jobs, vss
from core import connect


class CloudCrawlTest(unittest.TestCase):
    def test_cloud_search_rejects_error_html_without_returning_a_page(self):
        with patch.dict('os.environ', {'CLOUDFLARE_BROWSER_ACCOUNT_ID': 'a' * 32, 'CLOUDFLARE_BROWSER_TOKEN': 'test-secret'}, clear=True), patch('scripts.cloud_browser.requests.post') as post:
            post.return_value.json.return_value = {'success': True, 'result': '<title>Error</title>'}
            with self.assertRaises(RuntimeError):
                cloud_search_page({'pageNumber': 0, 'pageSize': '50', 'query': []})
            args, kwargs = post.call_args
            self.assertNotIn('test-secret', args[0])
            self.assertEqual(kwargs['headers']['Authorization'], 'Bearer test-secret')

    def test_tender_wrong_filter_is_rejected_before_upload(self):
        with patch.object(cloud_daily, 'cloud_search_page', return_value={'page': {'content': [{'id': 'one', 'isMedicine': 0}], 'totalPages': 2}}), patch.object(cloud_daily, '_flush') as upload, patch.object(cloud_daily, '_write_meta') as metadata:
            with self.assertRaisesRegex(ValueError, 'medicine filter'):
                cloud_daily.crawl_tender_pages(None, datetime(2026, 10, 1), None)
            upload.assert_not_called()
            metadata.assert_not_called()

    def test_repeated_tender_page_is_not_marked_complete(self):
        result = {'page': {'content': [{'id': 'one', 'isMedicine': 1, 'publicDate': '2026-10-06'}], 'totalPages': 3}}
        with patch.object(cloud_daily, 'cloud_search_page', return_value=result), patch.object(cloud_daily, '_flush', return_value=0), patch.object(cloud_daily, '_write_meta') as metadata, patch.object(cloud_daily.time, 'sleep'):
            with self.assertRaisesRegex(ValueError, 'repeated page'):
                cloud_daily.crawl_tender_pages(None, datetime(2026, 10, 1), None)
            metadata.assert_not_called()

    def test_remote_browser_keeps_token_out_of_endpoint(self):
        runtime = MagicMock()
        account = 'a' * 32
        with patch.dict('os.environ', {'CLOUDFLARE_BROWSER_ACCOUNT_ID': account, 'CLOUDFLARE_BROWSER_TOKEN': 'test-secret'}, clear=True):
            open_browser(runtime)
        args, kwargs = runtime.chromium.connect_over_cdp.call_args
        self.assertNotIn('test-secret', args[0])
        self.assertIn(account, args[0])
        self.assertEqual(kwargs['headers']['Authorization'], 'Bearer test-secret')
        runtime.chromium.launch.assert_not_called()

    def test_partial_remote_browser_config_does_not_fall_back_silently(self):
        runtime = MagicMock()
        with patch.dict('os.environ', {'CLOUDFLARE_BROWSER_ACCOUNT_ID': 'a' * 32}, clear=True):
            with self.assertRaises(ValueError):
                open_browser(runtime)
        runtime.chromium.launch.assert_not_called()
        runtime.chromium.connect_over_cdp.assert_not_called()

    def test_daily_price_window_uses_naive_vietnam_calendar_boundaries(self):
        conn = MagicMock()
        conn.cursor.return_value.__enter__.return_value.fetchone.return_value = None
        def prices(_conn, start, end):
            self.assertIsNone(start.tzinfo)
            self.assertIsNone(end.tzinfo)
            self.assertEqual(start.hour, 0)
            self.assertEqual(end.hour, 23)
            self.assertEqual((end.date() - start.date()).days, 2)
            return 3
        with patch.object(cloud_daily, 'connect', return_value=conn), patch.object(cloud_daily, 'require_config', return_value={}), patch.object(cloud_daily, 'crawl_prices', side_effect=prices), patch('sys.argv', ['cloud_daily.py', '--yes-remote', '--only', 'prices']), patch('builtins.print'):
            self.assertEqual(cloud_daily.main(), 0)

    def test_failed_price_partition_does_not_upload_or_mark_healthy(self):
        with patch.object(cloud_daily, 'Downloader') as downloader, patch.object(cloud_daily, '_flush') as upload, patch.object(cloud_daily, '_write_meta') as metadata:
            downloader.return_value.partition.side_effect = ValueError('partial public pages')
            with self.assertRaises(ValueError):
                cloud_daily.crawl_prices(None, datetime(2026, 10, 5), datetime(2026, 10, 6))
            upload.assert_not_called()
            metadata.assert_not_called()

    def test_cloud_control_only_allows_fixed_actions(self):
        with patch.object(cloud_jobs, 'github') as github:
            with self.assertRaises(ValueError): cloud_jobs.control('delete')
            github.assert_not_called()
            cloud_jobs.control('disable')
            self.assertEqual(github.call_args.args[-1], 'repos/dankezo/BaoAnSearcher/actions/workflows/daily-crawl.yml/disable')

    def test_repeated_vss_pull_preserves_fingerprint_and_raw_numbers(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(vss, 'VSS_DB', Path(folder) / 'vss.sqlite3'):
            row = {'fingerprint': 'remote-id', 'ten': 'Medicine', 'gia': Decimal('1250.00'), 'gia_raw': '1.250', 'soluong': Decimal('80'), 'search': 'medicine'}
            pull_to_local.import_vss([row])
            pull_to_local.import_vss([row])
            with closing(vss.connect()) as local:
                self.assertEqual(local.execute('SELECT count(*) FROM bids').fetchone()[0], 1)
                raw = json.loads(local.execute('SELECT raw FROM bids').fetchone()[0])
                self.assertEqual(raw['gia'], '1.250')

    def test_price_pull_updates_existing_source_without_second_copy(self):
        with tempfile.TemporaryDirectory() as folder:
            local = connect(Path(folder) / 'msc.sqlite3')
            try:
                item = {'name': 'Medicine', 'registration': 'SDK', 'tender_no': 'IB1', 'unit': 'Viên', 'quantity': 80, 'unit_price': 1250, 'source_label': 'API Mua sắm công'}
                row = build_msc_price_row(item, 'source-local', '', '2026-10-05')
                local.execute('CREATE TEMP TABLE cloud_price_alias (cloud_id TEXT PRIMARY KEY, source_id TEXT)')
                local.execute('INSERT INTO cloud_price_alias VALUES (?,?)', (row['source_id'], 'source-local'))
                local.execute('INSERT INTO records VALUES (?,?,?,?,?,?,?)', ('prices', 'source-local', 'IB1', '{}', json.dumps(item), '', '2026-10-04'))
                local.commit()
                pull_to_local.import_msc('prices', [row], local)
                pull_to_local.import_msc('prices', [row], local)
                self.assertEqual(local.execute('SELECT count(*) FROM records').fetchone()[0], 1)
                self.assertEqual(local.execute('SELECT source_id FROM records').fetchone()[0], 'source-local')
            finally:
                local.close()


if __name__ == '__main__':
    unittest.main()