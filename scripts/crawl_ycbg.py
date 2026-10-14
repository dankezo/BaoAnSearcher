"""Crawl MSC YCBG and optionally publish this dataset to the configured TiDB."""
import argparse
from contextlib import closing
import json
import gzip
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from server import ycbg
from server.ycbg import completed_today


def cache_readers(folder):
    """Replay lossless public-source archives through the regular validation path."""
    folder=Path(folder)
    details={}
    for path in sorted(folder.glob('ycbg_details_*.json.gz')):
        with gzip.open(path,'rt',encoding='utf-8') as stream:
            for record in json.load(stream):
                if record.get('detail'):
                    details[record['id']]=record['detail']
    def page(number):
        with gzip.open(folder/f'ycbg_cloud_{number:04d}.json.gz','rt',encoding='utf-8') as stream:
            result=json.load(stream)
        if result.get('status')!=200 or not isinstance(result.get('page'),dict):
            raise ValueError('Trang YCBG lưu không hợp lệ')
        return result['page']
    def detail(ident):
        value=details.get(ident)
        if value is None:
            path=ycbg.ARCHIVE/(ident+'.json')
            value=json.loads(path.read_text(encoding='utf-8')) if path.exists() else None
        if not isinstance(value,dict) or value.get('bidoRequestQuote',{}).get('id')!=ident:
            raise ValueError('Hồ sơ YCBG lưu chưa đủ hoặc sai mã')
        return value
    return {'fetch_page':page,'fetch':detail}


def restore(conn):
    with conn.cursor() as cur:
        cur.execute("SHOW TABLES LIKE 'msc_ycbg'")
        if not cur.fetchone():
            return
        cur.execute('SELECT id,normalized,detail,fetched_at,error FROM msc_ycbg')
        rows=cur.fetchall()
        cur.execute("SELECT total_records FROM app_metadata WHERE key_name='msc_ycbg_full_scan_complete'")
        complete=cur.fetchone()
        cur.execute("SELECT last_synced_at FROM data_registry_meta WHERE dataset_code='MSC_YCBG'")
        synced=cur.fetchone()
        cur.execute("SELECT total_records FROM app_metadata WHERE key_name='msc_ycbg_completed_at'")
        checkpoint=cur.fetchone()
    with closing(ycbg.connect()) as local:
        local.executemany("INSERT INTO quotes(id,normalized,detail,fetched_at,error) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET normalized=excluded.normalized,detail=excluded.detail,fetched_at=excluded.fetched_at,error=excluded.error WHERE coalesce(quotes.fetched_at,'') < coalesce(excluded.fetched_at,'')",rows)
        if complete and complete[0]:
            local.execute("INSERT OR REPLACE INTO crawl_meta VALUES ('full_scan_complete','1')")
        if checkpoint and checkpoint[0] or synced and synced[0]:
            from datetime import timezone
            stamp=(ycbg.datetime.fromtimestamp(int(checkpoint[0]),ycbg.VN) if checkpoint and checkpoint[0] else synced[0].replace(tzinfo=timezone.utc).astimezone(ycbg.VN)).isoformat()
            previous=local.execute("SELECT value FROM crawl_meta WHERE key='completed_at'").fetchone()
            if not previous or stamp > previous[0]:
                local.execute("INSERT OR REPLACE INTO crawl_meta VALUES ('completed_at',?)",(stamp,))
        local.commit()


def publish(conn, completed_run=True):
    schema=(ROOT/'tidb'/'012_msc_ycbg.sql').read_text(encoding='utf-8')
    with conn.cursor() as cur:
        for statement in schema.split(';'):
            if statement.strip():
                cur.execute(statement)
    conn.commit()
    with closing(ycbg.connect()) as local:
        rows=local.execute('SELECT id,normalized,detail,fetched_at,error FROM quotes').fetchall()
    with conn.cursor() as cur:
        packed=[(ident,norm,json.dumps(ycbg.extract_lots(json.loads(raw)),ensure_ascii=False) if raw else None,raw,fetched,error) for ident,norm,raw,fetched,error in rows]
        cur.executemany('INSERT INTO msc_ycbg (id,normalized,lots,detail,fetched_at,error) VALUES (%s,%s,%s,%s,%s,%s) ON DUPLICATE KEY UPDATE normalized=VALUES(normalized),lots=VALUES(lots),detail=VALUES(detail),fetched_at=VALUES(fetched_at),error=VALUES(error)',packed)
        cur.execute('SELECT count(*) FROM msc_ycbg')
        count=cur.fetchone()[0]
        errors=sum(bool(row[4]) for row in rows)
        complete=ycbg.meta_info()['fullScanComplete']
        cur.execute("UPDATE data_registry_meta SET total_records=%s,last_synced_at=IF(%s,UTC_TIMESTAMP(),last_synced_at),status=%s WHERE dataset_code='MSC_YCBG'",(count,bool(completed_run and complete),'warning' if errors or not complete or not completed_run else 'healthy'))
        cur.execute("INSERT INTO app_metadata(key_name,total_records) VALUES ('msc_ycbg_full_scan_complete',%s) ON DUPLICATE KEY UPDATE total_records=VALUES(total_records),updated_at=CURRENT_TIMESTAMP",(int(complete),))
        cur.execute("INSERT INTO app_metadata(key_name,total_records) VALUES ('msc_ycbg_source_total',%s) ON DUPLICATE KEY UPDATE total_records=VALUES(total_records),updated_at=CURRENT_TIMESTAMP",(ycbg.meta_info()['sourceTotal'],))
        stamp=ycbg.meta_info()['updated']
        cur.execute("INSERT INTO app_metadata(key_name,total_records) VALUES ('msc_ycbg_completed_at',%s) ON DUPLICATE KEY UPDATE total_records=VALUES(total_records),updated_at=CURRENT_TIMESTAMP",(int(ycbg.datetime.fromisoformat(stamp).timestamp()) if stamp else 0,))
    conn.commit()
    return count


def main():
    for stream in (sys.stdout,sys.stderr):
        if hasattr(stream,'reconfigure'):
            stream.reconfigure(encoding='utf-8')
    parser=argparse.ArgumentParser()
    parser.add_argument('--full',action='store_true')
    parser.add_argument('--publish',action='store_true')
    parser.add_argument('--publish-only',action='store_true')
    parser.add_argument('--cloud-cache',type=Path)
    parser.add_argument('--daily',action='store_true')
    args=parser.parse_args()
    readers=cache_readers(args.cloud_cache) if args.cloud_cache else {}
    def run():
        previous=ycbg.meta_info()
        if args.daily and not args.full and completed_today(previous):
            ycbg.update_status('msc_ycbg',state='idle',progress=100,count=previous['count'],meta=previous,updated=previous['updated'],message='YCBG đã có lượt đầy đủ hôm nay')
            print('YCBG đã có lượt đầy đủ hôm nay; giữ dữ liệu, không gọi lại nguồn.',flush=True)
            return previous
        ycbg.update_status('msc_ycbg',state='running',progress=0,message='Đang cập nhật YCBG',updated=ycbg.now_iso())
        try:
            result=ycbg.crawl(full=args.full,report=lambda msg:print(msg,flush=True),**readers)
        except Exception as exc:
            ycbg.update_status('msc_ycbg',state='error',message='YCBG chưa hoàn tất: '+type(exc).__name__,updated=ycbg.now_iso())
            raise
        ycbg.update_status('msc_ycbg',state='error' if result['errors'] else 'idle',progress=100,count=result['count'],meta=result,updated=result['updated'],message=f"YCBG: {result['count']} bản ghi · {result['details']} hồ sơ · {result['errors']} lỗi")
        print(json.dumps(result,ensure_ascii=True),flush=True)
        if result['errors']:
            raise RuntimeError(f"YCBG còn {result['errors']} hồ sơ lỗi; cần thử lại")
        return result
    if args.publish or args.publish_only:
        sys.path.insert(0,str(ROOT/'scripts'/'tidb'))
        from connect import connect,require_config,load_env
        load_env()
        conn=connect(require_config())
        try:
            if not args.publish_only:
                restore(conn)
                try:
                    run()
                except Exception:
                    publish(conn,completed_run=False)
                    raise
            print('TiDB YCBG:',publish(conn),flush=True)
        finally:
            conn.close()
    else:
        run()


if __name__=='__main__':
    main()
