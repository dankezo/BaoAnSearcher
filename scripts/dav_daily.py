"""Complete the DAV catalog scan before publishing its daily success marker."""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server import dav
from server.common import VN
from scripts.tidb.connect import connect, require_config
from scripts.tidb.sync_to_tidb import sync_dav, load_state


def run(*, publish=False, daily=False, publish_only=False):
    conn = connect(require_config()) if publish else None
    previous = None
    publishing = False
    try:
        if conn:
            with conn.cursor() as cur:
                cur.execute("SELECT last_synced_at,status FROM data_registry_meta WHERE dataset_code='DAV'")
                previous = cur.fetchone()
            if daily and previous and previous[0] and previous[1] == 'healthy':
                stamp = previous[0].replace(tzinfo=timezone.utc).astimezone(VN)
                if stamp.date() == datetime.now(VN).date():
                    print('DAV already verified today; skipping.', flush=True)
                    return {'skipped': True}
            conn.close()
            conn = None
        if not publish_only:
            dav._import_drug_tool().Downloader(lambda text: print(text, flush=True)).run(restart=False)
        info = dav.meta_info()
        if not info.get('complete') or not info.get('sourceTotal') or info.get('skip', 0) < info['sourceTotal']:
            raise RuntimeError('DAV scan incomplete; retaining previous production success marker.')
        if publish_only and str(info.get('updated', ''))[:10] != datetime.now().date().isoformat():
            raise RuntimeError('Publish-only requires a complete scan from today.')
        if publish:
            # A full DAV scan can outlive TiDB's idle TCP session. Open the
            # writer only after the source scan, rather than retaining it idle.
            conn = connect(require_config())
            publishing = True
            sync_dav(conn, load_state(), True)
            with conn.cursor() as cur:
                cur.execute('SELECT COUNT(*) FROM dav_drugs')
                published = int(cur.fetchone()[0])
            if published < int(info['sourceTotal']):
                raise RuntimeError('Published DAV count is below the completed source catalog.')
        else:
            published = None
        result = {'complete': True, 'source_total': info['sourceTotal'], 'scanned': info['skip'],
                  'published_total': published, 'finished_at': datetime.now(VN).isoformat()}
        (ROOT / 'data').mkdir(exist_ok=True)
        (ROOT / 'data/dav_daily_status.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(result, ensure_ascii=False), flush=True)
        return result
    except Exception:
        if conn and publishing:
            conn.ping(reconnect=True)
            conn.rollback()
            with conn.cursor() as cur:
                cur.execute("UPDATE data_registry_meta SET last_synced_at=%s,status='warning' WHERE dataset_code='DAV'", (previous[0] if previous else None,))
            conn.commit()
        raise
    finally:
        if conn:
            conn.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--publish', action='store_true')
    parser.add_argument('--daily', action='store_true')
    parser.add_argument('--publish-only', action='store_true')
    args = parser.parse_args()
    if args.publish_only and not args.publish:
        parser.error('--publish-only requires --publish')
    run(publish=args.publish, daily=args.daily, publish_only=args.publish_only)
