import unittest
from unittest.mock import patch

from server import ycbg_cloud


class YcbgCloudTest(unittest.TestCase):
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
