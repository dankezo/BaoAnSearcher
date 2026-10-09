"""Read-only public-source connectivity probe. No credentials or database writes."""
import concurrent.futures
import json
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path


def probe(name, url, options):
    with tempfile.TemporaryDirectory() as folder:
        output = Path(folder) / 'response'
        try:
            result = subprocess.run(
                ['curl', '--silent', '--show-error', '--connect-timeout', '8',
                 '--max-time', '20', '--output', str(output), '--write-out', '%{http_code}',
                 '--user-agent', 'Mozilla/5.0', *options, url],
                capture_output=True, text=True, timeout=25,
            )
            data = output.read_bytes() if output.exists() else b''
            report = {'probe': name, 'exit': result.returncode, 'http': result.stdout,
                      'bytes': len(data), 'error': result.stderr.strip()[:240]}
            if result.returncode == 0 and result.stdout == '200':
                if 'vss' in name:
                    root = ET.fromstring(data)
                    rows = root.findall('.//{urn:schemas-microsoft-com:office:spreadsheet}Row')
                    report['spreadsheet_rows_including_header'] = len(rows)
                else:
                    payload = json.loads(data)
                    detail = (payload.get('body') or {}).get('bidNotification') or {}
                    report['lot_rows'] = len(detail.get('lotDTOList') or [])
            return report
        except Exception as exc:
            return {'probe': name, 'error': type(exc).__name__}


def main():
    host = 'quanlythuocv1.vss.gov.vn'
    url = f'https://{host}/kqdt/export?ngaycongbo=02%2F10%2F2026&loai=1'
    fixed = ['--resolve', f'{host}:443:103.57.114.162']
    jobs = [
        ('vss-default', url, []),
        ('vss-resolved-tls12', url, fixed + ['--tlsv1.2', '--tls-max', '1.2', '--http1.1']),
        ('vss-resolved-http', url.replace('https:', 'http:'),
         ['--resolve', f'{host}:80:103.57.114.162']),
        ('msc-detail', 'https://muasamcong.mpi.gov.vn/api/unau/portal/ebidorg/bid-no-contractor/get-detail',
         ['--tlsv1.2', '--tls-max', '1.2', '--http1.1', '--header', 'Content-Type: application/json',
          '--data', json.dumps({'body': {'id': '74f2085c-b318-4aae-9b8e-007e57109bba'}})]),
    ]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for result in pool.map(lambda job: probe(*job), jobs):
            print(json.dumps(result, ensure_ascii=True), flush=True)


if __name__ == '__main__':
    main()
