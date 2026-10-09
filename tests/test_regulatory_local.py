import json
import subprocess
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from server import regulatory_proxy


class RegulatoryLocalTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(regulatory_proxy.router)
        self.client = TestClient(app)

    def test_missing_login_never_runs_local_or_cloud(self):
        with patch.object(regulatory_proxy, '_local_brief') as local, patch.object(regulatory_proxy.requests, 'request') as cloud:
            self.assertEqual(self.client.get('/api/regulatory?view=brief').status_code, 401)
            local.assert_not_called(); cloud.assert_not_called()

    def test_only_get_brief_runs_locally(self):
        response = SimpleNamespace(content=b'{"items":[]}', status_code=200)
        with patch.object(regulatory_proxy, '_local_brief', return_value=regulatory_proxy.Response('{"total":1}', media_type='application/json')) as local, patch.object(regulatory_proxy.requests, 'request', return_value=response) as cloud:
            self.assertEqual(self.client.get('/api/regulatory?view=brief', headers={'Authorization': 'Bearer fixture'}).json()['total'], 1)
            local.assert_called_once_with('Bearer fixture'); cloud.assert_not_called()
            self.client.get('/api/regulatory?view=sources', headers={'Authorization': 'Bearer fixture'})
            self.client.post('/api/regulatory?view=brief', headers={'Authorization': 'Bearer fixture'}, json={'action': 'read'})
            self.assertEqual(cloud.call_count, 2)
            self.assertEqual(local.call_count, 1)

    def test_subprocess_is_bounded_and_has_no_service_role_or_token_in_args(self):
        with patch.dict(regulatory_proxy.os.environ, {'SUPABASE_SERVICE_ROLE_KEY': 'must-not-reach-reader'}), patch.object(regulatory_proxy.subprocess, 'run', return_value=SimpleNamespace(stdout='{"status":401,"body":{"error":"Unauthorized"}}')) as run:
            self.assertEqual(regulatory_proxy._local_brief('Bearer fixture').status_code, 401)
            args, kwargs = run.call_args
            self.assertNotIn('fixture', ' '.join(args[0]))
            self.assertNotIn('SUPABASE_SERVICE_ROLE_KEY', kwargs['env'])
            self.assertEqual(kwargs['timeout'], 30)
            self.assertEqual(json.loads(kwargs['input']), {'authorization': 'Bearer fixture'})

    def test_timeout_returns_generic_error_without_retry(self):
        with patch.object(regulatory_proxy.subprocess, 'run', side_effect=subprocess.TimeoutExpired('node', 30)) as run:
            with self.assertRaises(HTTPException) as caught:
                regulatory_proxy._local_brief('Bearer fixture')
            self.assertEqual(caught.exception.status_code, 502)
            self.assertEqual(run.call_count, 1)


if __name__ == '__main__':
    unittest.main()
