import unittest
import urllib.error
from unittest.mock import MagicMock, call, patch

from scripts import cloud_daily, cloud_browser


class MscCrawlRecoveryTest(unittest.TestCase):
    def worker(self, failures, expected_calls, error=None):
        good = MagicMock(status_code=200)
        good.json.return_value = {'page': {'content': []}}
        with patch.dict('os.environ', {'CLOUDFLARE_CRAWL_WORKER_URL': cloud_browser.WORKER_URLS[0], 'CLOUDFLARE_CRAWL_WORKER_KEY': 'test'}, clear=True), patch.object(cloud_browser.requests, 'post', side_effect=[*failures, good]) as post, patch.object(cloud_browser.time, 'sleep'):
            if error:
                with self.assertRaisesRegex(RuntimeError, error):
                    cloud_browser.cloud_search_page({'pageNumber': 1})
            else:
                self.assertEqual(cloud_browser.cloud_search_page({'pageNumber': 1}), good.json.return_value)
            self.assertEqual(post.call_count, expected_calls)
            self.assertTrue(all(c == post.call_args_list[0] for c in post.call_args_list))

    def test_search_retries_transient_http_and_connection_failures(self):
        self.worker([MagicMock(status_code=502), MagicMock(status_code=504)], 3)
        self.worker([cloud_browser.requests.Timeout(), cloud_browser.requests.ConnectionError()], 3)

    def test_search_stops_after_three_failures(self):
        response = MagicMock(status_code=502)
        response.json.return_value = {'error': 'msc_search_timeout'}
        self.worker([response] * 3, 3, 'msc_search_timeout')

    def test_auth_budget_and_invalid_filter_are_not_retried(self):
        for status in (400, 401, 403, 429):
            response = MagicMock(status_code=status)
            response.json.return_value = {'error': 'request_rejected'}
            self.worker([response], 1, str(status))

    def test_webform_recovers_transient_network_error(self):
        conn = MagicMock()
        conn.cursor.return_value.__enter__.return_value.fetchall.return_value = []
        with patch.object(cloud_daily, '_fetch_lots', side_effect=[urllib.error.URLError('offline'), [{'name': 'Medicine'}]]) as fetch, patch.object(cloud_daily.time, 'sleep') as sleep:
            cloud_daily.crawl_scopes(conn, [('id', {'tender_no': 'IB1'})], None)
        self.assertEqual(fetch.call_count, 2)
        self.assertIn(call(2), sleep.call_args_list)
        self.assertTrue(any('INSERT INTO msc_scope_lots' in str(c) for c in conn.cursor.return_value.__enter__.return_value.execute.call_args_list))

    def test_missing_or_permanently_failed_webform_stays_incomplete(self):
        for failure in ([], urllib.error.HTTPError('url', 403, 'denied', None, None), urllib.error.URLError('offline')):
            conn = MagicMock()
            conn.cursor.return_value.__enter__.return_value.fetchall.return_value = []
            kwargs = {'side_effect': failure} if isinstance(failure, Exception) else {'return_value': failure}
            with patch.object(cloud_daily, '_fetch_lots', **kwargs) as fetch, patch.object(cloud_daily.time, 'sleep'):
                with self.assertRaisesRegex(RuntimeError, 'unavailable'):
                    cloud_daily.crawl_scopes(conn, [('id', {'tender_no': 'IB1'})], None)
            self.assertEqual(fetch.call_count, 3 if isinstance(failure, urllib.error.URLError) and not isinstance(failure, urllib.error.HTTPError) else 1)
            self.assertFalse(any('INSERT INTO msc_scope_lots' in str(c) for c in conn.cursor.return_value.__enter__.return_value.execute.call_args_list))


if __name__ == '__main__':
    unittest.main()
