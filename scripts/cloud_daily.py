"""Daily public-source crawl on an ephemeral runner; additive TiDB upserts only."""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
import time
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'test zone' / 'procurement'))
sys.path.insert(0, str(ROOT / 'scripts' / 'tidb'))

from core import BASE, TENDER_API, connect as sqlite_connect, normalize_tender, save_records
from sync import Api, Downloader
from browser_update import payload as tender_payload, URL as TENDER_PAGE, COMPONENT, same_search
from server.common import VN
from server import vss
from server.msc_scope import _open, fetch_lots_on_page
from connect import connect, require_config
from rows import (MSC_PRICE_COLUMNS, MSC_TENDER_COLUMNS, VSS_COLUMNS,
                  build_msc_price_row, build_msc_tender_row, build_vss_row)
from sync_to_tidb import _flush, _write_meta, refresh_msc_price_metric_rollup


def crawl_prices(conn, start, end):
    # Export partitions handle the source's 10,000-row window. No Windows lock
    # or existing local archive is needed on the isolated cloud runner.
    with tempfile.TemporaryDirectory() as folder:
        db = Path(folder) / 'prices.sqlite3'
        dl = Downloader(db=db, report=lambda _: None)
        for category in ('0', '1'):
            dl.partition_export(start, end, category, refresh=True)
        with sqlite_connect(db) as local:
            cursor = local.execute("SELECT source_id, normalized, search_text, collected_at FROM records WHERE kind='prices'")
            sent = 0
            while batch := cursor.fetchmany(500):
                rows = [build_msc_price_row(json.loads(raw), sid, search, stamp) for sid, raw, search, stamp in batch]
                sent += _flush(conn, 'msc_prices', MSC_PRICE_COLUMNS, [row for row in rows if row])
    _write_meta(conn, 'msc_prices_total', 'msc_prices')
    refresh_msc_price_metric_rollup(conn)
    return sent


def crawl_vss(conn, start, end):
    sent = 0
    day = start.date()
    while day <= end.date():
        label = day.strftime('%d/%m/%Y')
        blob = vss.download_kqdt_export(label, cookie='')
        records = vss.rows_from_export_bytes(blob)
        for item in records:
            item.setdefault('congbo', label)
            if not item.get('congbo'): item['congbo'] = label
            if not item.get('loai'): item['loai'] = 'TÃ¢n dÆ°á»£c'
            item['nam'] = vss.derive_nam(item)
        rows = [build_vss_row({'fingerprint': vss.row_fingerprint(item), 'raw': item}) for item in records if not vss.is_garbled_bid(item)]
        for index in range(0, len(rows), 500):
            sent += _flush(conn, 'vss_bids', VSS_COLUMNS, [row for row in rows[index:index + 500] if row])
        day += timedelta(days=1)
        time.sleep(0.4)
    _write_meta(conn, 'vss_total', 'vss_bids')
    return sent


def crawl_tenders(conn, start, end):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as runtime:
        browser = runtime.chromium.launch(headless=True)
        try:
            page = browser.new_page(locale='vi-VN')
            page.goto(TENDER_PAGE, wait_until='domcontentloaded', timeout=60000)
            page.wait_for_function('Boolean(' + COMPONENT + ')', timeout=60000)
            return crawl_tender_pages(conn, start, page)
        finally:
            browser.close()


def crawl_tender_pages(conn, start, browser_page):
    sent = 0
    seen = set()
    candidates = []
    for page_no in range(200):
        body = tender_payload(page_no)
        def matches(response):
            try:
                return response.url.split('?')[0] == TENDER_API and same_search(response.request.post_data_json, body)
            except Exception:
                return False
        with browser_page.expect_response(matches, timeout=45000) as pending:
            browser_page.evaluate('(p)=>{const v=' + COMPONENT + ';v.quickSearchPayload.pageSize=p.pageSize;v.currentPage=p.pageNumber;v.axiosSearch(p)}', body)
        response = pending.value
        if response.status != 200:
            raise RuntimeError('MSC guest search requires an authenticated session or is unavailable.')
        data = response.json()
        page = data.get('page')
        if not isinstance(page, dict) or not isinstance(page.get('content'), list) or not isinstance(page.get('totalPages'), int):
            raise ValueError('MSC search response changed; no completeness claim.')
        rows = page['content']
        if any(item.get('isMedicine') not in (1, '1', True) for item in rows):
            raise ValueError('MSC returned rows outside the medicine filter.')
        ids = {str(item.get('id') or item.get('notifyId') or '') for item in rows}
        if rows and ('' in ids or ids <= seen):
            raise ValueError('MSC returned missing IDs or a repeated page.')
        seen.update(ids)
        mapped = []
        for item in rows:
            normalized = normalize_tender(item)
            if normalized:
                row = build_msc_tender_row(normalized, str(item.get('id') or item.get('notifyId')), None, datetime.now(VN).isoformat())
                if row: mapped.append(row)
                if _open(normalized, datetime.now(VN).replace(tzinfo=None)):
                    candidates.append((str(item.get('id') or item.get('notifyId')), normalized))
        sent += _flush(conn, 'msc_tenders', MSC_TENDER_COLUMNS, mapped)
        if page_no + 1 >= page['totalPages']:
            break
        published = [str(item.get('publicDate') or '')[:10] for item in rows]
        if published and all(value and value < start.date().isoformat() for value in published):
            break
        time.sleep(0.5)
    else:
        raise RuntimeError('MSC tender scan reached the page budget; catch-up remains incomplete.')
    crawl_scopes(conn, candidates, browser_page)
    _write_meta(conn, 'msc_total', 'msc_tenders')
    return sent


def crawl_scopes(conn, candidates, browser_page):
    with conn.cursor() as cur:
        cur.execute((ROOT / 'tidb' / '009_cloud_scope_lots.sql').read_text(encoding='utf-8'))
        cur.execute('SELECT notify_id FROM msc_scope_lots')
        known = {str(row[0]) for row in cur.fetchall()}
    conn.commit()
    pending = [(nid, item) for nid, item in candidates if nid not in known]
    failed = 0
    for nid, item in pending[:80]:
        try:
            lots = fetch_lots_on_page(browser_page, nid, item.get('source_url') or '')
            if not lots: raise ValueError('No public medicine webform.')
            with conn.cursor() as cur:
                cur.execute('INSERT INTO msc_scope_lots (notify_id,tender_no,lots,fetched_at) VALUES (%s,%s,%s,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE tender_no=VALUES(tender_no),lots=VALUES(lots),fetched_at=VALUES(fetched_at)',
                            (nid, item.get('tender_no'), json.dumps(lots, ensure_ascii=False)))
            conn.commit()
        except Exception:
            conn.rollback()
            failed += 1
        time.sleep(0.5)
    print(f'MSC webforms: {min(len(pending), 80) - failed} loaded; {failed} unavailable; {max(0, len(pending) - 80)} deferred', flush=True)
    if failed or len(pending) > 80:
        raise RuntimeError('Some public webforms require login, are unavailable or remain queued.')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--only', default='prices,tenders,vss')
    parser.add_argument('--days', type=int, default=3)
    parser.add_argument('--yes-remote', action='store_true')
    args = parser.parse_args()
    actions = {'prices': ('MSC_PRICE', crawl_prices), 'tenders': ('MSC_BID', crawl_tenders), 'vss': ('VSS', crawl_vss)}
    selected = args.only.split(',')
    if any(name not in actions for name in selected) or not 1 <= args.days <= 30:
        parser.error('Select prices,tenders,vss and 1â€“30 days.')
    if not args.yes_remote:
        print('Dry run. Pass --yes-remote to crawl public sources and upsert TiDB.')
        return 0
    conn = connect(require_config())
    failures = []
    try:
        today = datetime.now(VN).replace(hour=0, minute=0, second=0, microsecond=0)
        end = today.replace(hour=23, minute=59, second=59, microsecond=999000)
        for name in selected:
            code, action = actions[name]
            # Replay the last successful day and catch outages up to 30 days.
            with conn.cursor() as cur:
                cur.execute('SELECT last_synced_at FROM data_registry_meta WHERE dataset_code=%s', (code,))
                result = cur.fetchone()
            days = args.days
            if result and result[0]:
                days = max(days, min(30, (today.date() - result[0].date()).days + 2))
            try:
                sent = action(conn, today - timedelta(days=days - 1), end)
                print(f'{code}: upserted {sent} rows', flush=True)
            except Exception as exc:
                conn.rollback()
                with conn.cursor() as cur:
                    cur.execute("UPDATE data_registry_meta SET status='warning' WHERE dataset_code=%s", (code,))
                conn.commit()
                # Do not echo connection strings, request tokens or response bodies.
                reason = str(exc)[:240] if isinstance(exc, (ValueError, RuntimeError)) else str(getattr(exc, 'code', '') or getattr(exc, 'errno', '') or '')
                print(f'{code}: failed ({type(exc).__name__} {reason}); successful sources are retained', flush=True)
                failures.append(code)
    finally:
        conn.close()
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
