import unittest
from datetime import datetime, date
from pathlib import Path
import tempfile
from unittest.mock import MagicMock, patch
from scripts import cloud_daily
from scripts import vss_daily


class MorningDailyTest(unittest.TestCase):
    def test_vss_runs_on_sunday_instead_of_silently_reporting_a_skipped_day(self):
        conn = MagicMock()
        conn.cursor.return_value.__enter__.return_value.fetchone.side_effect = [(datetime(2026, 11, 6), 'healthy'), (date(2026, 11, 6),)]
        with tempfile.TemporaryDirectory() as folder, patch('sys.argv', ['vss_daily.py', '--publish', '--daily']), patch.object(vss_daily, 'ROOT', Path(folder)), patch.object(vss_daily, 'datetime', wraps=datetime) as clock, patch.object(vss_daily, 'connect', return_value=conn), patch.object(vss_daily, 'require_config', return_value={}), patch.object(vss_daily, 'replay_start', return_value=date(2026, 11, 4)), patch.object(vss_daily, 'sync', return_value={'complete': True}) as sync:
            clock.now.return_value = datetime(2026, 11, 8, 6, 15, tzinfo=vss_daily.VN)
            self.assertEqual(vss_daily.main(), 0)
            sync.assert_called_once()

    def test_daily_skips_only_healthy_sources_in_the_vietnam_calendar_day(self):
        from datetime import timezone
        now = datetime(2026, 11, 10, 5, tzinfo=cloud_daily.VN)
        for stamp, status, skipped in [(datetime(2026, 11, 9, 23), 'healthy', True), (datetime(2026, 11, 9, 15), 'healthy', False), (datetime(2026, 11, 9, 23), 'warning', False)]:
            with self.subTest(stamp=stamp, status=status):
                conn = MagicMock()
                conn.cursor.return_value.__enter__.return_value.fetchone.return_value = (stamp, status)
                with patch('sys.argv', ['cloud_daily.py', '--yes-remote', '--daily', '--only', 'prices']), patch.object(cloud_daily, 'datetime', wraps=datetime) as clock, patch.object(cloud_daily, 'connect', return_value=conn), patch.object(cloud_daily, 'require_config', return_value={}), patch.object(cloud_daily, 'crawl_prices', return_value=3) as crawl:
                    clock.now.return_value = now
                    self.assertEqual(cloud_daily.main(), 0)
                self.assertEqual(crawl.call_count, 0 if skipped else 1)


if __name__ == "__main__":
    unittest.main()
