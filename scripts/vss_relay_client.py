"""Wake a free export relay and fetch only verified-size VSS workbooks."""
import os
import time
import xml.etree.ElementTree as ET
from urllib.parse import urlsplit

import requests

MAX_BYTES = 10 * 1024 * 1024


def download_export(day, loai=1):
    url = os.environ.get('VSS_EXPORT_RELAY_URL', '').strip().rstrip('/')
    key = os.environ.get('VSS_EXPORT_RELAY_KEY', '').strip()
    parsed = urlsplit(url)
    if (parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port or parsed.query or parsed.fragment
            or parsed.path or not key or not parsed.hostname
            or not parsed.hostname.endswith(('.onrender.com', '.deno.net', '.deno.dev'))):
        raise ValueError('Configure a verified HTTPS VSS relay and its invocation key.')
    deadline = time.monotonic()+90
    while True:
        try:
            remaining = deadline-time.monotonic()
            if remaining <= 0:
                raise RuntimeError('VSS relay did not wake within 90 seconds.')
            with requests.get(url+'/health', timeout=(5, min(20, remaining)), allow_redirects=False) as health:
                if health.status_code == 200 and health.json().get('service') == 'BaoAn VSS export relay':
                    break
        except (requests.RequestException, ValueError):
            pass
        if time.monotonic() >= deadline:
            raise RuntimeError('VSS relay did not wake within 90 seconds.')
        time.sleep(min(3, max(0, deadline-time.monotonic())))
    for attempt in range(2):
        try:
            with requests.post(url+'/vss/export', headers={'Authorization': 'Bearer '+key},
                               json={'date': day, 'loai': loai}, timeout=(5, 35),
                               stream=True, allow_redirects=False) as response:
                if response.status_code in (400, 401, 403, 404):
                    raise ValueError(f'VSS relay configuration/request rejected (HTTP {response.status_code}).')
                if response.status_code != 200:
                    raise RuntimeError(f'VSS relay returned no export (HTTP {response.status_code}).')
                if int(response.headers.get('Content-Length') or 0) > MAX_BYTES:
                    raise ValueError('VSS relay export exceeds 10 MB.')
                data = bytearray()
                for chunk in response.iter_content(65536):
                    if len(data)+len(chunk) > MAX_BYTES:
                        raise ValueError('VSS relay export exceeds 10 MB.')
                    data.extend(chunk)
                if b'Workbook' not in data[:4096] or b'<html' in data[:512].lower():
                    raise RuntimeError('VSS relay returned no Workbook; no completeness claim.')
                if ET.fromstring(data).tag != '{urn:schemas-microsoft-com:office:spreadsheet}Workbook':
                    raise RuntimeError('VSS relay returned invalid SpreadsheetML.')
                return bytes(data)
        except ValueError:
            raise
        except (requests.RequestException, RuntimeError, ET.ParseError):
            if attempt:
                raise RuntimeError('VSS relay export failed after two attempts; successful days are retained.') from None
            time.sleep(2)