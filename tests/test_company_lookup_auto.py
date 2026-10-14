import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
from server.analytics import company_profile


class CompanyLookupAutoTest(unittest.TestCase):
    def test_missing_profile_searches_without_refresh_and_survives_store_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            found={'status':'verified','legalName':'Company DEMO','taxId':'0101234567','address':'Ha Noi','sourceUrls':['https://example.com/profile']}
            with patch('scripts.tidb.company_profiles.PATH',Path(folder)/'profiles.json'), patch('server.analytics.compute',return_value=found) as search, patch('scripts.tidb.connect.require_config',side_effect=RuntimeError('offline')):
                result=company_profile({'query':{'mode':'company','entity':'Company DEMO'}})
                search.assert_called_once()
                self.assertEqual(result['profiles'][0]['taxId'],'0101234567')
                self.assertIn('reason',result)

    def test_recent_verified_profile_reuses_sources_without_provider_call(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'profiles.json'
            profile={'legalName':'Company DEMO','status':'web_verified','checkedAt':datetime.now(timezone.utc).isoformat(),'sourceUrls':['https://example.com/profile']}
            path.write_text(json.dumps({'company demo':profile}),encoding='utf-8')
            with patch('scripts.tidb.company_profiles.PATH',path), patch('server.analytics.compute') as search:
                result=company_profile({'query':{'mode':'company','entity':'Company DEMO'}})
                search.assert_not_called()
                self.assertEqual(result['profiles'],[profile])


if __name__=='__main__':
    unittest.main()
