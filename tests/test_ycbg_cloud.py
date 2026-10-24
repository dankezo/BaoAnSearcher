import unittest
from unittest.mock import patch, MagicMock, call

from server import ycbg_cloud
from scripts import cloud_browser


class YcbgCloudTest(unittest.TestCase):
    def test_worker_retries_transient_failures_with_the_same_read_request(self):
        good = MagicMock(status_code=200)
        good.json.return_value = {'page': {'content': []}}
        for failures in ([MagicMock(status_code=502), MagicMock(status_code=503)],
                         [cloud_browser.requests.Timeout(), cloud_browser.requests.ConnectionError()]):
            with self.subTest(failures=failures), patch.dict('os.environ', {'CLOUDFLARE_YCBG_WORKER_URL': 'https://crawl.baoanpharma.com', 'CLOUDFLARE_YCBG_KEY': 'test-secret'}, clear=True), patch.object(cloud_browser.requests, 'post', side_effect=[*failures, good]) as post, patch.object(cloud_browser.time, 'sleep') as sleep:
                self.assertEqual(cloud_browser.cloud_worker_post('/ycbg/search', {'page': 1}), good.json.return_value)
                self.assertEqual(post.call_count, 3)
                self.assertTrue(all(item == post.call_args_list[0] for item in post.call_args_list))
                self.assertEqual(sleep.call_args_list, [call(2), call(4)])

    def test_worker_does_not_retry_auth_budget_or_invalid_requests(self):
        for status in (400, 401, 403, 429):
            response = MagicMock(status_code=status)
            response.json.return_value = {'error': 'invalid_request'}
            with self.subTest(status=status), patch.dict('os.environ', {'CLOUDFLARE_YCBG_WORKER_URL': 'https://crawl.baoanpharma.com', 'CLOUDFLARE_YCBG_KEY': 'test-secret'}, clear=True), patch.object(cloud_browser.requests, 'post', return_value=response) as post, patch.object(cloud_browser.time, 'sleep') as sleep:
                with self.assertRaisesRegex(RuntimeError, str(status)):
                    cloud_browser.cloud_worker_post('/ycbg/details', {'ids': ['a']})
                self.assertEqual(post.call_count, 1)
                sleep.assert_not_called()

    def test_worker_stops_after_three_failures_and_keeps_the_source_error_code(self):
        response = MagicMock(status_code=502)
        response.json.return_value = {'error': 'public_ycbg_source_unavailable'}
        with patch.dict('os.environ', {'CLOUDFLARE_YCBG_WORKER_URL': 'https://crawl.baoanpharma.com', 'CLOUDFLARE_YCBG_KEY': 'test-secret'}, clear=True), patch.object(cloud_browser.requests, 'post', return_value=response) as post, patch.object(cloud_browser.time, 'sleep') as sleep:
            with self.assertRaisesRegex(RuntimeError, 'public_ycbg_source_unavailable'):
                cloud_browser.cloud_worker_post('/ycbg/search', {'page': 1})
            self.assertEqual(post.call_count, 3)
            self.assertEqual(sleep.call_count, 2)

    def test_search_page_returns_page_payload(self):
        page = {'content': [{'id': 'a', 'notifyNo': 'RQ1'}], 'totalPages': 1, 'totalElements': 1}
        with patch.object(ycbg_cloud, 'cloud_worker_post', return_value={'page': page}) as post:
            self.assertEqual(ycbg_cloud.search_page(0), page)
        post.assert_called_once_with('/ycbg/search', {'page': 0, 'fresh': False})

    def test_detail_batches_preserve_successes_and_mark_individual_errors(self):
        details = {'bidoRequestQuote': {'id': 'a'}}
        result = {'results': [{'id': 'a', 'detail': details}, {'id': 'b', 'error': 'detail_fetch_failed'}]}
        with patch.object(ycbg_cloud, 'cloud_worker_post', return_value=result):
            self.assertEqual(ycbg_cloud.fetch_details(['a', 'b']), {
                'a': {'detail': details}, 'b': {'error': 'detail_fetch_failed'},
            })

    def test_batch_size_and_incomplete_responses_are_rejected(self):
        with self.assertRaises(ValueError):
            ycbg_cloud.fetch_details([str(i) for i in range(9)])
        with patch.object(ycbg_cloud, 'cloud_worker_post', return_value={'results': []}):
            with self.assertRaisesRegex(ValueError, 'incomplete'):
                ycbg_cloud.fetch_details(['a'])


if __name__ == '__main__':
    unittest.main()
