import os
import threading
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import requests
from scripts import vss_export_relay as relay, vss_relay_client as client, cloud_daily

XML=b'<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet><Table/></Worksheet></Workbook>'
ENV={'VSS_EXPORT_RELAY_KEY':'test-secret','VSS_EXPORT_RELAY_URL':'https://baoan-vss-relay.onrender.com'}


def response(status=200, data=XML, health=False):
    r=MagicMock(status_code=status,headers={})
    r.__enter__.return_value=r
    r.json.return_value={'service':'BaoAn VSS export relay'} if health else {}
    r.iter_content.return_value=[data]
    return r


class RelayTest(unittest.TestCase):
    def test_http_auth_and_request_shape_before_source_access(self):
        server=relay.ThreadingHTTPServer(('127.0.0.1',0),relay.Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        url=f'http://127.0.0.1:{server.server_port}'
        try:
            with patch.dict(os.environ,ENV), patch.object(relay,'export_bytes',return_value=XML) as fetch:
                self.assertEqual(requests.post(url+'/vss/export',json={'date':'2026-10-02','loai':1}).status_code,401)
                self.assertEqual(requests.post(url+'/vss/export',headers={'Authorization':'Bearer test-secret'},json={'date':'2026-10-02','loai':1,'url':'https://attacker.test'}).status_code,400)
                fetch.assert_not_called()
                r=requests.post(url+'/vss/export',headers={'Authorization':'Bearer test-secret'},json={'date':'2026-10-02','loai':1})
                self.assertEqual(r.content,XML)
        finally:server.shutdown();server.server_close();thread.join()

    def test_source_fixed_url_tls_and_limits(self):
        day = (datetime.now(timezone(timedelta(hours=7))).date()-timedelta(days=2)).isoformat()
        with patch.object(relay.requests,'get',return_value=response()) as get:
            self.assertEqual(relay.export_bytes(day,1),XML)
            self.assertEqual(get.call_args.args[0],relay.SOURCE)
            self.assertTrue(get.call_args.kwargs['verify'])
            self.assertFalse(get.call_args.kwargs['allow_redirects'])
        for bad_day,loai in [(day,True),('1900-01-01',1),('invalid',1)]:
            with self.assertRaises((ValueError,TypeError)):relay.export_bytes(bad_day,loai)
        with patch.object(relay.requests,'get',return_value=response(data=b'<html>Workbook error</html>')):
            with self.assertRaisesRegex(RuntimeError,'Workbook'):relay.export_bytes(day,1)
        with patch.object(relay,'MAX_BYTES',10),patch.object(relay.requests,'get',return_value=response()):
            with self.assertRaisesRegex(RuntimeError,'size'):relay.export_bytes(day,1)

    def test_wake_retry_and_key_only_in_header(self):
        with patch.dict(os.environ,ENV),patch.object(client.time,'sleep'),patch.object(client.requests,'get',side_effect=[response(503),response(health=True)]) as health,patch.object(client.requests,'post',side_effect=[response(502),response()]) as post:
            self.assertEqual(client.download_export('2026-10-02'),XML)
            self.assertEqual(health.call_count,2);self.assertEqual(post.call_count,2)
            self.assertNotIn('test-secret',post.call_args.args[0])
            self.assertEqual(post.call_args.kwargs['headers']['Authorization'],'Bearer test-secret')
            self.assertFalse(post.call_args.kwargs['allow_redirects'])

    def test_bad_config_does_not_transmit_key(self):
        for url in ['http://baoan-vss-relay.onrender.com','https://attacker.test','https://user@a.onrender.com','https://a.onrender.com?url=x']:
            with patch.dict(os.environ,{**ENV,'VSS_EXPORT_RELAY_URL':url}),patch.object(client.requests,'get') as get:
                with self.assertRaises(ValueError):client.download_export('2026-10-02')
                get.assert_not_called()

    def test_html_and_malformed_xml_never_succeed_and_retry_is_bounded(self):
        for data in [b'<html>Workbook error</html>',b'<Workbook broken']:
            with patch.dict(os.environ,ENV),patch.object(client.time,'sleep'),patch.object(client.requests,'get',return_value=response(health=True)),patch.object(client.requests,'post',return_value=response(data=data)) as post:
                with self.assertRaises(RuntimeError):client.download_export('2026-10-02')
                self.assertEqual(post.call_count,2)

    def test_failed_day_does_not_write_success_metadata(self):
        start=datetime(2026,10,2)
        with patch.dict(os.environ,ENV),patch('scripts.vss_relay_client.download_export',side_effect=RuntimeError('unavailable')),patch.object(cloud_daily,'_write_meta') as meta,patch.object(cloud_daily,'_flush') as upload:
            with self.assertRaises(RuntimeError):cloud_daily.crawl_vss(None,start,start)
            meta.assert_not_called();upload.assert_not_called()


if __name__=='__main__':unittest.main()