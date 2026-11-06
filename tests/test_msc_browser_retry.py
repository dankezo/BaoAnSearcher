import unittest
from datetime import datetime
from email.utils import formatdate
from unittest.mock import MagicMock, call, patch

from scripts import cloud_browser


class MscBrowserRetryTest(unittest.TestCase):
    def invoke(self, responses):
        env = {'CLOUDFLARE_CRAWL_WORKER_URL': 'https://crawl.baoanpharma.com',
               'CLOUDFLARE_CRAWL_WORKER_KEY': 'test-secret'}
        return patch.dict('os.environ', env, clear=True), patch.object(
            cloud_browser.requests, 'post', side_effect=responses)

    def response(self, status, code=None, retry_after=None):
        response = MagicMock(status_code=status)
        response.json.return_value = {'error': code} if code else {'page': {'content': []}}
        response.headers = {} if retry_after is None else {'Retry-After': retry_after}
        return response

    def test_rate_limit_waits_and_retries_the_same_page(self):
        limited = self.response(429, 'browser_rate_limited', '17')
        good = self.response(200)
        env, request = self.invoke([limited, limited, good])
        with env, request as post, patch.object(cloud_browser.time, 'sleep') as sleep:
            self.assertEqual(cloud_browser.cloud_worker_post('/msc/search', {'page': 1}), good.json.return_value)
            self.assertEqual(post.call_count, 3)
            self.assertTrue(all(item == post.call_args_list[0] for item in post.call_args_list))
            self.assertEqual(sleep.call_args_list, [call(17), call(30)])
            self.assertEqual(limited.close.call_count, 2)

    def test_daily_budget_auth_and_unknown_limits_are_not_retried(self):
        for status, code in ((429, 'daily_msc_browser_budget_reached'),
                             (429, 'browser_daily_limit_reached'),
                             (429, 'unknown_limit'), (401, 'unauthorized')):
            env, request = self.invoke([self.response(status, code)])
            with self.subTest(code=code), env, request as post, patch.object(cloud_browser.time, 'sleep') as sleep:
                with self.assertRaisesRegex(RuntimeError, code):
                    cloud_browser.cloud_worker_post('/msc/search', {'page': 1})
                self.assertEqual(post.call_count, 1)
                sleep.assert_not_called()

    def test_persistent_rate_limit_stops_after_three_attempts(self):
        env, request = self.invoke([self.response(429, 'browser_rate_limited')] * 3)
        with env, request as post, patch.object(cloud_browser.time, 'sleep') as sleep:
            with self.assertRaisesRegex(RuntimeError, 'browser_rate_limited'):
                cloud_browser.cloud_worker_post('/msc/search', {'page': 2})
            self.assertEqual(post.call_count, 3)
            self.assertEqual(sleep.call_args_list, [call(15), call(30)])

    def test_long_retry_after_stops_without_retrying_early(self):
        env, request = self.invoke([self.response(429, 'browser_rate_limited', '120')])
        with env, request as post, patch.object(cloud_browser.time, 'sleep') as sleep:
            with self.assertRaisesRegex(RuntimeError, 'browser_rate_limited'):
                cloud_browser.cloud_worker_post('/msc/search', {'page': 2})
            self.assertEqual(post.call_count, 1)
            sleep.assert_not_called()

    def test_invalid_retry_after_uses_bounded_backoff(self):
        for value in ('invalid', '-10', 'NaN', 'Infinity'):
            env, request = self.invoke([self.response(429, 'browser_rate_limited', value), self.response(200)])
            with self.subTest(value=value), env, request, patch.object(cloud_browser.time, 'sleep') as sleep:
                cloud_browser.cloud_worker_post('/msc/search', {'page': 0})
                sleep.assert_called_once_with(15)

    def test_http_date_retry_after_is_respected(self):
        header = formatdate(1_800_000_025, usegmt=True)
        env, request = self.invoke([self.response(429, 'browser_rate_limited', header), self.response(200)])
        with env, request, patch.object(cloud_browser.time, 'time', return_value=1_800_000_000), patch.object(cloud_browser.time, 'sleep') as sleep:
            cloud_browser.cloud_worker_post('/msc/search', {'page': 0})
            sleep.assert_called_once_with(25)

    def test_daily_scan_recovers_second_page_before_marking_complete(self):
        from scripts import cloud_daily
        first, second = self.response(200), self.response(200)
        for response, identity in ((first, 'one'), (second, 'two')):
            response.json.return_value = {'page': {'content': [
                {'id': identity, 'isMedicine': 1, 'publicDate': '2026-11-06'}], 'totalPages': 2}}
        env, request = self.invoke([first, self.response(429, 'browser_rate_limited', '20'), second])
        with env, request as post, patch.object(cloud_browser.time, 'sleep') as sleep, patch.object(cloud_daily, 'normalize_tender', return_value=None), patch.object(cloud_daily, '_flush', return_value=0), patch.object(cloud_daily, 'crawl_scopes'), patch.object(cloud_daily, '_write_meta') as metadata:
            cloud_daily.crawl_tender_pages(None, datetime(2026, 11, 4), None)
            self.assertEqual([item.kwargs['json']['page'] for item in post.call_args_list], [0, 1, 1])
            self.assertEqual(sleep.call_args_list, [call(15), call(20)])
            metadata.assert_called_once_with(None, 'msc_total', 'msc_tenders')


if __name__ == '__main__':
    unittest.main()
