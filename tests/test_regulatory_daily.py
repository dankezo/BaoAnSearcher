"""Daily integration without starting real crawlers or changing user settings."""
import importlib.util
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo


class RegulatoryDailyTest(unittest.TestCase):
    def test_news_failure_does_not_block_other_data_sources(self):
        modules = {name: types.ModuleType(name) for name in ['fixture', 'fixture.dav', 'fixture.msc', 'fixture.vss', 'fixture.common']}
        modules['fixture'].__path__ = []
        common = modules['fixture.common']
        common.VN = ZoneInfo('Asia/Ho_Chi_Minh')
        data = {'autoCrawl': {'enabled': True}}
        common.load_secrets = lambda: data
        common.save_secrets = lambda value: None
        common.load_status = lambda: {}
        with patch.dict(sys.modules, modules):
            spec = importlib.util.spec_from_file_location('fixture.daily', Path(__file__).parents[1] / 'server/daily.py')
            daily = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(daily)
            calls = []
            def failed_news():
                calls.append('regulatory')
                raise RuntimeError('Source unavailable')
            daily._run_regulatory = failed_news
            daily._run_dav = lambda: calls.append('dav')
            daily._run_msc = lambda: calls.append('msc')
            daily._run_vss = lambda: calls.append('vss')
            result = daily.run_daily()
            self.assertFalse(result['ok'])
            self.assertEqual(calls, ['regulatory', 'dav', 'msc', 'vss'])
            self.assertIn('Source unavailable', data['autoCrawl']['daily']['message'])
            self.assertEqual(data['autoCrawl']['daily']['dav'], 'ok')
            self.assertFalse(daily.finished_today())


if __name__ == '__main__':
    unittest.main()
