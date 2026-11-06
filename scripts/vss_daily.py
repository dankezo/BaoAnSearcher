"""Validated daily VSS import on a network that can reach the public source."""
from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta
from decimal import Decimal
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
import time
from urllib.parse import parse_qs, urlsplit

import requests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server import vss
from server.common import VN
from scripts.tidb.connect import connect, require_config
from scripts.tidb.rows import VSS_COLUMNS, build_vss_row
from scripts.tidb.sync_to_tidb import _flush, _write_meta

INDEX = 'https://quanlythuocv1.vss.gov.vn/kqdt'
KINDS = {1: 'Tân dược', 2: 'Chế phẩm', 3: 'Vị thuốc yhct', 4: 'Phóng xạ'}


class IndexParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self.link = None

    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            self.link = [dict(attrs).get('href', ''), '']

    def handle_data(self, data):
        if self.link is not None:
            self.link[1] += data

    def handle_endtag(self, tag):
        if tag == 'a' and self.link is not None:
            self.links.append(self.link)
            self.link = None


def parse_index(html, start, end):
    parser = IndexParser()
    parser.feed(html)
    tasks, dates = {}, set()
    for href, label in parser.links:
        url = urlsplit(href)
        if url.hostname != 'quanlythuocv1.vss.gov.vn' or url.path != '/kqdt/chiTiet':
            continue
        params = parse_qs(url.query)
        if 'ngaycongbo' not in params:
            continue
        day = datetime.strptime(params['ngaycongbo'][0], '%d/%m/%Y').date()
        dates.add(day)
        if not start <= day <= end or 'loai' not in params:
            continue
        category = int(params['loai'][0])
        if category not in KINDS:
            raise ValueError('Unknown VSS medicine type')
        label = label.strip()
        if not label:
            continue
        if not re.fullmatch(r'\d+', label):
            raise ValueError('Invalid VSS index row count')
        count = int(label)
        if count <= 0:
            continue
        key = (day, category)
        if key in tasks and tasks[key] != count:
            raise ValueError('Conflicting VSS index counts')
        tasks[key] = count
    if not dates or min(dates) > start or max(dates) > end:
        raise ValueError('VSS index does not establish requested date coverage')
    # A real index must expose numeric medicine links, even on quiet days.
    if not any('loai=' in href and label.strip().isdigit() for href, label in parser.links):
        raise ValueError('VSS index contains no medicine counts')
    return [(day, category, count) for (day, category), count in sorted(tasks.items(), reverse=True)]


def get_bytes(url, params=None, limit=10 * 1024 * 1024):
    for attempt in range(3):
        delay = 15 * (attempt + 1)
        try:
            with requests.get(url, params=params, headers={'User-Agent': 'Mozilla/5.0'},
                              timeout=(10, 60), allow_redirects=False, stream=True) as response:
                if response.status_code != 200:
                    if response.status_code not in (429, 500, 502, 503, 504):
                        raise ValueError(f'VSS HTTP {response.status_code}')
                    header = str(response.headers.get('Retry-After', '')).strip()
                    if header:
                        try:
                            cooldown = int(header) if header.isdigit() else parsedate_to_datetime(header).timestamp() - time.time()
                        except (ValueError, TypeError, OverflowError):
                            cooldown = 0
                        if cooldown > 60:
                            raise ValueError('VSS requests a longer cooldown; retry next scheduled attempt')
                        delay = max(delay, cooldown)
                    raise RuntimeError(f'VSS HTTP {response.status_code}')
                data = bytearray()
                started = time.monotonic()
                for chunk in response.iter_content(65536):
                    data.extend(chunk)
                    if len(data) > limit or time.monotonic() - started > 90:
                        raise ValueError('VSS response exceeds time/size limit')
                return bytes(data)
        except (requests.RequestException, RuntimeError):
            if attempt == 2:
                raise
            time.sleep(delay)


def prepare_rows(blob, day, category, expected):
    # VSS sometimes writes bare '&' into otherwise complete SpreadsheetML.
    # Use the existing tolerant reader, then require exact source counts.
    if not re.search(br'<Workbook\b[^>]*\bxmlns="urn:schemas-microsoft-com:office:spreadsheet"', blob[:2048]) or not blob.rstrip().endswith(b'</Workbook>'):
        raise ValueError('VSS returned no complete SpreadsheetML Workbook')
    raw = vss.rows_from_export_bytes(blob)
    if len(raw) != expected:
        raise ValueError(f'VSS index/export mismatch: {expected}/{len(raw)}')
    mapped = {}
    for item in raw:
        item['congbo'] = item.get('congbo') or day.isoformat()
        item['loai'] = item.get('loai') or KINDS[category]
        item['nam'] = vss.derive_nam(item)
        if vss.is_garbled_bid(item):
            raise ValueError('VSS source row has unreadable text')
        row = build_vss_row({'fingerprint': vss.row_fingerprint(item), 'raw': item})
        if not row or row['congbo'] != day.isoformat() or row['loai'] != KINDS[category]:
            raise ValueError('VSS returned wrong announcement date/type')
        previous = mapped.get(row['fp_hash'])
        if previous is not None and previous != row:
            raise ValueError('Conflicting duplicate VSS identity')
        mapped[row['fp_hash']] = row
    return list(mapped.values())


def publish_rows(conn, rows):
    expected = {row['fp_hash']: row for row in rows}
    for offset in range(0, len(rows), 250):
        batch = rows[offset:offset + 250]
        if _flush(conn, 'vss_bids', VSS_COLUMNS, batch) != len(batch):
            raise RuntimeError('VSS import did not store every row')
    verified = set()
    with conn.cursor() as cur:
        hashes = list(expected)
        for offset in range(0, len(hashes), 500):
            batch = hashes[offset:offset + 500]
            cur.execute('SELECT fp_hash,gia,soluong,thanhtien,congbo,loai FROM vss_bids WHERE fp_hash IN (' + ','.join(['%s'] * len(batch)) + ')', batch)
            for ident, price, qty, amount, published, kind in cur.fetchall():
                source = expected[ident]
                numeric = tuple(Decimal(source[key]) if source[key] is not None else None for key in ('gia', 'soluong', 'thanhtien'))
                if (price, qty, amount, str(published), kind) != (*numeric, source['congbo'], source['loai']):
                    raise ValueError('VSS stored price/quantity/date/type mismatch')
                verified.add(ident)
    if verified != set(expected):
        raise ValueError('VSS imported rows are missing')
    return len(verified)


def sync(conn, start, end, fetch=None, publish=None, sleep=None):
    fetch, publish, sleep = fetch or get_bytes, publish or publish_rows, sleep or time.sleep
    html = fetch(INDEX, limit=2 * 1024 * 1024).decode('utf-8-sig')
    tasks = parse_index(html, start, end)
    results = []
    for day, category, expected in tasks:
        result = {'date': day.isoformat(), 'category': category, 'source_rows': expected}
        try:
            blob = fetch(INDEX + '/export', params={'ngaycongbo': day.strftime('%d/%m/%Y'), 'loai': category})
            rows = prepare_rows(blob, day, category, expected)
            stored = publish(conn, rows)
            if stored != len(rows):
                raise RuntimeError('VSS import is incomplete')
            result['verified'] = stored
        except (requests.RequestException, ValueError, RuntimeError) as exc:
            conn.rollback()
            result['error'] = f'{type(exc).__name__}: {str(exc)[:160]}'
        results.append(result)
        print(json.dumps(result, ensure_ascii=True), flush=True)
        sleep(5)
    # Re-read counts before claiming complete; the source can change mid-run.
    final = parse_index(fetch(INDEX, limit=2 * 1024 * 1024).decode('utf-8-sig'), start, end)
    complete = final == tasks and not any('error' in result for result in results)
    if complete:
        _write_meta(conn, 'vss_total', 'vss_bids')
    return {'complete': complete, 'start': start.isoformat(), 'end': end.isoformat(), 'exports': results}


def replay_start(today, last_synced, latest_published):
    candidates = [today - timedelta(days=2)]
    for value in (last_synced, latest_published):
        if value:
            candidates.append((value.date() if isinstance(value, datetime) else value) - timedelta(days=1))
    return max(today - timedelta(days=29), min(candidates))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--publish', action='store_true')
    parser.add_argument('--daily', action='store_true')
    parser.add_argument('--force', action='store_true')
    args = parser.parse_args()
    if not args.publish:
        print('Pass --publish to update the configured TiDB.')
        return 0
    now = datetime.now(VN)
    if args.daily and now.weekday() == 6 and not args.force:
        print('Sunday pause; data and successful timestamp retained.')
        return 0
    conn = connect(require_config())
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT last_synced_at,status FROM data_registry_meta WHERE dataset_code='VSS'")
            registry = cur.fetchone()
            cur.execute('SELECT MAX(congbo) FROM vss_bids')
            latest = cur.fetchone()[0]
        last_synced = registry[0] if registry else None
        # DB timestamps are UTC; daily completion is interpreted in Vietnam time.
        completed_day = (last_synced + timedelta(hours=7)).date() if last_synced else None
        if args.daily and not args.force and registry and registry[1] == 'healthy' and completed_day == now.date():
            print('VSS already completed today; no duplicate daily import.')
            return 0
        try:
            report = sync(conn, replay_start(now.date(), last_synced, latest), now.date())
            if not report['complete']:
                raise RuntimeError('VSS remains incomplete; successful rows retained for retry.')
        except Exception:
            conn.rollback()
            with conn.cursor() as cur:
                cur.execute("UPDATE data_registry_meta SET status='warning' WHERE dataset_code='VSS'")
            conn.commit()
            raise
        folder = ROOT / 'data'
        folder.mkdir(exist_ok=True)
        report['finished_at'] = datetime.now(VN).isoformat()
        (folder / 'vss_daily_status.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        return 0
    finally:
        conn.close()


if __name__ == '__main__':
    sys.exit(main())
