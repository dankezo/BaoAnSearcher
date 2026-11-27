import unittest
from contextlib import contextmanager
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

    def test_incomplete_worker_page_replays_window_in_official_browser(self):
        from playwright.sync_api import sync_playwright
        from scripts import cloud_daily

        def result(page_no, identity):
            return {'page': {'content': [{'id': identity, 'isMedicine': 1, 'publicDate': '2026-11-06'}],
                             'totalPages': 2, 'currentPage': page_no}}

        first = self.response(200)
        first.json.return_value = result(0, 'one')
        error = self.response(502, 'incomplete_cloud_search')
        env, request = self.invoke([first, error, error, error])
        browser = MagicMock()
        page = browser.new_page.return_value
        page.url = cloud_daily.GUEST_TENDER_URL
        page.title.return_value = 'Hệ thống mạng đấu thầu quốc gia'
        browser_pages = []

        @contextmanager
        def guest_response(matches, timeout):
            pending = MagicMock()
            yield pending
            body = page.evaluate.call_args.args[1]
            page_no = body['pageNumber']
            response = pending.value
            response.status = 200
            response.url = 'https://muasamcong.mof.gov.vn' + cloud_daily.urlsplit(cloud_daily.TENDER_API).path
            response.request.post_data_json = body
            response.json.return_value = result(page_no, ('one', 'two')[page_no])
            self.assertTrue(matches(response))
            browser_pages.append(page_no)

        page.expect_response.side_effect = guest_response
        with (env, request as post, patch.object(cloud_browser.time, 'sleep'),
              patch('playwright.sync_api.sync_playwright', spec=sync_playwright) as playwright,
              patch.object(cloud_daily, 'normalize_tender', return_value=None),
              patch.object(cloud_daily, '_flush', return_value=0) as flush,
              patch.object(cloud_daily, 'crawl_scopes'), patch.object(cloud_daily, '_write_meta') as metadata):
            playwright.return_value.__enter__.return_value.chromium.launch.return_value = browser
            cloud_daily.crawl_tenders(None, datetime(2026, 11, 4), None)
            self.assertEqual([item.kwargs['json']['page'] for item in post.call_args_list], [0, 1, 1, 1])
            self.assertEqual(browser_pages, [0, 1])
            self.assertEqual(flush.call_count, 3)
            metadata.assert_called_once_with(None, 'msc_total', 'msc_tenders')
            browser.close.assert_called_once_with()

    def test_worker_auth_and_quota_failures_leave_guest_path_idle(self):
        from scripts import cloud_daily

        for status, code in ((401, 'unauthorized'), (403, 'forbidden'), (429, 'daily_msc_browser_budget_reached')):
            env, request = self.invoke([self.response(status, code)])
            with (self.subTest(status=status), env, request,
                  patch.object(cloud_daily, 'crawl_tenders_as_guest') as guest,
                  patch.object(cloud_daily, '_write_meta') as metadata):
                with self.assertRaisesRegex(RuntimeError, code):
                    cloud_daily.crawl_tenders(None, datetime(2026, 11, 4), None)
                guest.assert_not_called()
                metadata.assert_not_called()

    def test_unavailable_guest_page_leaves_sync_incomplete(self):
        from scripts import cloud_daily

        error = self.response(502, 'incomplete_cloud_search')
        env, request = self.invoke([error] * 6)
        with (env, request, patch.object(cloud_browser.time, 'sleep') as sleep,
              patch('playwright.sync_api.sync_playwright') as playwright,
              patch.object(cloud_daily, '_write_meta') as metadata):
            browser = playwright.return_value.__enter__.return_value.chromium.launch.return_value
            page = browser.new_page.return_value
            page.url = cloud_daily.GUEST_TENDER_URL
            page.title.return_value = 'Error'
            with self.assertRaisesRegex(RuntimeError, 'incomplete_cloud_search'):
                cloud_daily.crawl_tenders(None, datetime(2026, 11, 4), None)
            self.assertEqual(sleep.call_args_list.count(call(cloud_daily.TENDER_RECOVERY_DELAY_SECONDS)), 1)
            metadata.assert_not_called()
            browser.close.assert_called_once_with()

    def test_worker_recovery_waits_once_when_guest_source_is_unavailable(self):
        from scripts import cloud_daily

        error = cloud_browser.CrawlWorkerError(502, 'incomplete_cloud_search', 'Worker unavailable')
        with (patch.dict('os.environ', {'CLOUDFLARE_CRAWL_WORKER_URL': 'https://crawl.baoanpharma.com'}),
              patch.object(cloud_daily, 'crawl_tender_pages', side_effect=[error, 100]) as cloud,
              patch.object(cloud_daily, 'crawl_tenders_as_guest', side_effect=cloud_daily.MscGuestUnavailable),
              patch.object(cloud_daily.time, 'sleep') as sleep):
            start = datetime(2026, 11, 4)
            self.assertEqual(cloud_daily.crawl_tenders(None, start, None), 100)
            self.assertEqual(cloud.call_args_list, [call(None, start, None), call(None, start, None)])
            sleep.assert_called_once_with(cloud_daily.TENDER_RECOVERY_DELAY_SECONDS)

    def test_guest_access_restriction_does_not_start_recovery(self):
        from scripts import cloud_daily

        error = self.response(502, 'incomplete_cloud_search')
        env, request = self.invoke([error] * 3)
        with (env, request as post, patch.object(cloud_browser.time, 'sleep') as sleep,
              patch('playwright.sync_api.sync_playwright') as playwright,
              patch.object(cloud_daily, '_write_meta') as metadata):
            browser = playwright.return_value.__enter__.return_value.chromium.launch.return_value
            page = browser.new_page.return_value
            page.url = cloud_daily.GUEST_TENDER_URL
            page.goto.return_value.status = 403
            with self.assertRaisesRegex(RuntimeError, 'HTTP 403'):
                cloud_daily.crawl_tenders(None, datetime(2026, 11, 4), None)
            self.assertEqual(post.call_count, 3)
            self.assertNotIn(call(cloud_daily.TENDER_RECOVERY_DELAY_SECONDS), sleep.call_args_list)
            metadata.assert_not_called()

    def test_unexpected_empty_page_leaves_sync_incomplete(self):
        from scripts import cloud_daily

        response = {'page': {'content': [], 'totalPages': 2}}
        with (patch.object(cloud_daily, 'cloud_search_page', return_value=response),
              patch.object(cloud_daily, '_write_meta') as metadata):
            with self.assertRaisesRegex(ValueError, 'inconsistent pagination'):
                cloud_daily.crawl_tender_pages(None, datetime(2026, 11, 4), None)
            metadata.assert_not_called()


if __name__ == '__main__':
    unittest.main()
