import json
from datetime import datetime, timezone
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch
from scripts import dav_daily as daily


class DavDailyTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.conn = MagicMock()
        self.cur = self.conn.cursor.return_value.__enter__.return_value
        self.previous = datetime(2020, 1, 1)
        self.cur.fetchone.side_effect = [(self.previous, 'healthy'), (55005,)]
        self.tool = MagicMock()
        for name, value in [('ROOT', Path(self.folder.name)), ('connect', self.conn), ('require_config', {}), ('load_state', {})]:
            manager = patch.object(daily, name, value) if name == 'ROOT' else patch.object(daily, name, return_value=value)
            manager.start()
            self.addCleanup(manager.stop)
        self.importer = patch.object(daily.dav, '_import_drug_tool', return_value=self.tool).start()
        self.addCleanup(patch.stopall)
        self.meta = patch.object(daily.dav, 'meta_info', return_value={'complete': True, 'sourceTotal': 55005, 'skip': 55005}).start()
        self.publish = patch.object(daily, 'sync_dav', return_value=55005).start()

    def test_complete_scan_is_published_then_count_is_verified(self):
        result = daily.run(publish=True)
        self.publish.assert_called_once_with(self.conn, {}, True)
        self.assertTrue(result['complete'])
        self.assertEqual(result['published_total'], 55005)
        saved = json.loads((Path(self.folder.name) / 'data/dav_daily_status.json').read_text(encoding='utf8'))
        self.assertEqual(saved['scanned'], 55005)

    def test_incomplete_or_empty_scan_cannot_publish(self):
        for info in [{'complete': False, 'skip': 500, 'sourceTotal': 55005}, {'complete': True, 'skip': 0, 'sourceTotal': 0}]:
            with self.subTest(info=info):
                self.cur.fetchone.side_effect = [(self.previous, 'healthy')]
                self.meta.return_value = info
                with self.assertRaisesRegex(RuntimeError, 'incomplete'):
                    daily.run(publish=True)
        self.publish.assert_not_called()

    def test_failed_publish_retains_previous_success_timestamp(self):
        self.publish.side_effect = RuntimeError('temporary SQL failure')
        with self.assertRaisesRegex(RuntimeError, 'temporary SQL'):
            daily.run(publish=True)
        self.assertTrue(any("status='warning'" in call.args[0] and call.args[1] == (self.previous,) for call in self.cur.execute.call_args_list))
        self.assertFalse((Path(self.folder.name) / 'data/dav_daily_status.json').exists())

    def test_missing_remote_rows_cannot_mark_the_day_successful(self):
        self.cur.fetchone.side_effect = [(self.previous, 'healthy'), (55004,)]
        with self.assertRaisesRegex(RuntimeError, 'below'):
            daily.run(publish=True)
        self.assertTrue(any("status='warning'" in call.args[0] for call in self.cur.execute.call_args_list))

    def test_daily_uses_vietnam_day_and_only_skips_healthy_data(self):
        now = datetime(2026, 11, 10, 5, tzinfo=daily.VN)
        self.cur.fetchone.side_effect = [(datetime(2026, 11, 9, 23), 'healthy')]
        with patch.object(daily, 'datetime', wraps=datetime) as clock:
            clock.now.return_value = now
            self.assertTrue(daily.run(publish=True, daily=True)['skipped'])
        self.importer.assert_not_called()
        self.publish.assert_not_called()


if __name__ == '__main__':
    unittest.main()
