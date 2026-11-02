import unittest
from unittest.mock import patch, call

from scripts.crawl_ycbg import crawl_with_fallback


class YcbgFallbackTest(unittest.TestCase):
    def test_worker_outage_uses_runner_once_with_same_options(self):
        for reason in ('Crawl Worker HTTP 429: browser_rate_limited', 'Crawl Worker HTTP 503: unavailable', 'Crawl Worker connection unavailable after bounded retries.', 'Nguồn lỗi ba hồ sơ liên tiếp; giữ dữ liệu và thử lại lượt sau'):
            with self.subTest(reason=reason), patch.dict('os.environ', {'CLOUDFLARE_CRAWL_WORKER_URL': 'https://crawl.baoanpharma.com'}), patch('scripts.crawl_ycbg.ycbg.crawl', side_effect=[RuntimeError(reason), {'errors': 0}]) as crawl:
                self.assertEqual(crawl_with_fallback(full=False), {'errors': 0})
                self.assertEqual(crawl.call_args_list, [call(full=False), call(full=False, use_worker=False)])

    def test_partial_details_use_runner_but_success_does_not(self):
        for errors, expected in ((1, 2), (0, 1)):
            with patch.dict('os.environ', {'CLOUDFLARE_CRAWL_WORKER_URL': 'https://crawl.baoanpharma.com'}), patch('scripts.crawl_ycbg.ycbg.crawl', side_effect=[{'errors': errors}, {'errors': 0}]) as crawl:
                self.assertEqual(crawl_with_fallback()['errors'], 0)
                self.assertEqual(crawl.call_count, expected)

    def test_bad_configuration_and_invalid_source_are_not_hidden(self):
        for error in (RuntimeError('Crawl Worker HTTP 401: unauthorized'), ValueError('invalid source')):
            with patch.dict('os.environ', {'CLOUDFLARE_CRAWL_WORKER_URL': 'https://crawl.baoanpharma.com'}), patch('scripts.crawl_ycbg.ycbg.crawl', side_effect=error) as crawl:
                with self.assertRaises(type(error)):
                    crawl_with_fallback()
                self.assertEqual(crawl.call_count, 1)

    def test_runner_failure_remains_failure_without_loop(self):
        with patch.dict('os.environ', {'CLOUDFLARE_CRAWL_WORKER_URL': 'https://crawl.baoanpharma.com'}), patch('scripts.crawl_ycbg.ycbg.crawl', side_effect=[RuntimeError('Crawl Worker HTTP 429'), RuntimeError('source offline')]) as crawl:
            with self.assertRaisesRegex(RuntimeError, 'source offline'):
                crawl_with_fallback()
            self.assertEqual(crawl.call_count, 2)

    def test_archive_replay_does_not_start_browser(self):
        with patch.dict('os.environ', {'CLOUDFLARE_CRAWL_WORKER_URL': 'https://crawl.baoanpharma.com'}), patch('scripts.crawl_ycbg.ycbg.crawl', side_effect=RuntimeError('Crawl Worker HTTP 429')) as crawl:
            with self.assertRaises(RuntimeError):
                crawl_with_fallback(fetch_page=lambda _: {})
            self.assertEqual(crawl.call_count, 1)
