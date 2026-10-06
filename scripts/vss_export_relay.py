"""Small authenticated export relay. No database, browser, cookies or stored files."""
import hmac
import json
import os
import time
from datetime import date, datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import requests

SOURCE = 'https://quanlythuocv1.vss.gov.vn/kqdt/export'
MAX_BYTES = 10 * 1024 * 1024


def export_bytes(day, loai):
    parsed = date.fromisoformat(day)
    today = datetime.now(timezone(timedelta(hours=7))).date()
    if not today-timedelta(days=30) <= parsed <= today or type(loai) is not int or loai not in (1, 2, 3, 4):
        raise ValueError('Invalid announcement date or medicine type.')
    started = time.monotonic()
    with requests.get(SOURCE, params={'ngaycongbo': parsed.strftime('%d/%m/%Y'), 'loai': loai},
                      headers={'User-Agent': 'Mozilla/5.0', 'Accept': 'application/vnd.ms-excel,application/xml,*/*',
                               'Referer': 'https://quanlythuocv1.vss.gov.vn/kqdt/chiTiet'},
                      timeout=(5, 25), stream=True, allow_redirects=False, verify=True) as response:
        if response.status_code != 200:
            raise RuntimeError('Source returned no successful export.')
        if int(response.headers.get('Content-Length') or 0) > MAX_BYTES:
            raise RuntimeError('Source export exceeds 10 MB.')
        data = bytearray()
        for chunk in response.iter_content(65536):
            if time.monotonic()-started > 30 or len(data)+len(chunk) > MAX_BYTES:
                raise RuntimeError('Source export exceeds time or size limit.')
            data.extend(chunk)
        if b'Workbook' not in data[:4096] or b'<html' in data[:512].lower():
            raise RuntimeError('Source returned no Workbook.')
        return bytes(data)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # Never log invocation headers or request payloads.

    def reply(self, status, data, mime='application/json'):
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self.reply(200 if self.path == '/health' else 404,
                   b'{"service":"BaoAn VSS export relay"}')

    def do_POST(self):
        key = os.environ.get('VSS_EXPORT_RELAY_KEY', '')
        supplied = self.headers.get('Authorization', '')
        if not key or not hmac.compare_digest(supplied.encode(), ('Bearer '+key).encode()):
            return self.reply(401, b'{"error":"unauthorized"}')
        if self.path != '/vss/export':
            return self.reply(404, b'{"error":"not_found"}')
        try:
            length = int(self.headers.get('Content-Length') or 0)
            if not 0 < length <= 1024:
                raise ValueError('Invalid request length.')
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict) or set(body) != {'date', 'loai'}:
                raise ValueError('Only date and loai are accepted.')
            data = export_bytes(body['date'], body['loai'])
        except (ValueError, TypeError):
            return self.reply(400, b'{"error":"invalid_request"}')
        except Exception:
            return self.reply(502, b'{"error":"source_export_unavailable"}')
        self.reply(200, data, 'application/vnd.ms-excel')


if __name__ == '__main__':
    if not os.environ.get('VSS_EXPORT_RELAY_KEY'):
        raise SystemExit('VSS_EXPORT_RELAY_KEY is required.')
    ThreadingHTTPServer(('0.0.0.0', int(os.environ.get('PORT', '10000'))), Handler).serve_forever()