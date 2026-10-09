# -*- coding: utf-8 -*-
"""Stream TiDB datasets into CSV snapshots and publish them to Cloudflare R2.

Full exports use TiFlash, so they do not compete with TiKV index lookups. The
CSV is streamed to a temporary file, then uploaded multipart: no million-row
list is kept in memory.

  python scripts/tidb/publish_r2_snapshots.py --yes-remote
  python scripts/tidb/publish_r2_snapshots.py --yes-remote --only MSC_PRICE
"""
from __future__ import annotations

import argparse
import csv
import os
import sys
import tempfile
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from connect import connect, load_env, require_config

DATASETS = {
    "DAV": ("dav_drugs", "dav.csv"),
    "MSC_PRICE": ("msc_prices", "msc-price.csv"),
    "MSC_BID": ("msc_tenders", "msc-bid.csv"),
    "VSS": ("vss_bids", "vss.csv"),
}
CHUNK = 2_000


def required(name: str) -> str:
    value = (os.environ.get(name) or "").strip()
    if not value:
        raise SystemExit(f"Thiếu {name}. Xem .env.example.")
    return value


def r2_client():
    try:
        import boto3
        from botocore.config import Config
    except ImportError as exc:
        raise SystemExit("Thiếu boto3. Cài server requirements trước khi xuất R2.") from exc
    return boto3.client(
        "s3", endpoint_url=required("R2_ENDPOINT"), region_name="auto",
        aws_access_key_id=required("R2_ACCESS_KEY_ID"),
        aws_secret_access_key=required("R2_SECRET_ACCESS_KEY"),
        config=Config(signature_version="s3v4", retries={"max_attempts": 5, "mode": "standard"}),
    )


def public_url(key: str) -> str:
    return f"{required('R2_PUBLIC_BASE_URL').rstrip('/')}/{key}"


def columns_of(conn, table: str) -> list[str]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT COLUMN_NAME FROM information_schema.columns "
            "WHERE table_schema=DATABASE() AND table_name=%s ORDER BY ORDINAL_POSITION", (table,),
        )
        return [str(row[0]) for row in cur.fetchall()]


def write_csv(conn, code: str, table: str) -> tuple[Path, int]:
    import pymysql

    columns = columns_of(conn, table)
    if not columns:
        raise RuntimeError(f"Không thấy bảng {table}.")
    fd, raw_path = tempfile.mkstemp(prefix=f"baoan-{code.lower()}-", suffix=".csv")
    os.close(fd)
    path = Path(raw_path)
    count = 0
    quoted = ", ".join(f"`{column}`" for column in columns)
    sql = f"SELECT /*+ READ_FROM_STORAGE(TIFLASH[{table}]) */ {quoted} FROM `{table}`"
    try:
        with conn.cursor(pymysql.cursors.SSCursor) as cur, path.open("w", newline="", encoding="utf-8-sig") as handle:
            writer = csv.writer(handle, lineterminator="\n")
            writer.writerow(columns)
            cur.execute(sql)
            while rows := cur.fetchmany(CHUNK):
                writer.writerows(rows)
                count += len(rows)
    except Exception:
        path.unlink(missing_ok=True)
        raise
    return path, count


def update_registry(conn, code: str, count: int, url: str, size_mb: float) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE data_registry_meta SET total_records=%s, status='healthy', "
            "last_synced_at=CURRENT_TIMESTAMP, r2_download_url=%s, file_size_mb=%s "
            "WHERE dataset_code=%s", (count, url, size_mb, code),
        )
    conn.commit()


def publish_one(conn, client, bucket: str, code: str) -> None:
    table, filename = DATASETS[code]
    print(f"export {code} from TiFlash…", flush=True)
    path, count = write_csv(conn, code, table)
    key = f"snapshots/{filename}"
    size_mb = round(path.stat().st_size / 1024 / 1024, 2)
    try:
        client.upload_file(
            str(path), bucket, key,
            ExtraArgs={
                "ContentType": "text/csv; charset=utf-8",
                "ContentDisposition": f'attachment; filename="{filename}"',
                "CacheControl": "public, max-age=300",
            },
        )
        client.head_object(Bucket=bucket, Key=key)
        update_registry(conn, code, count, public_url(key), size_mb)
    finally:
        path.unlink(missing_ok=True)
    print(f"published {code}: {count:,} rows, {size_mb:,.2f} MB", flush=True)


def publish_analytics() -> None:
    bucket = required('R2_BUCKET')
    client = r2_client()
    with tempfile.TemporaryDirectory(prefix='baoan-analytics-') as directory:
        result = subprocess.run(['node', str(ROOT / 'scripts' / 'build_analytics_snapshots.mjs'), '--build', '--out', directory], cwd=ROOT, capture_output=True, text=True, encoding='utf-8', timeout=7200, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        if result.returncode:
            raise RuntimeError('Analytics snapshot build failed; previous manifest retained.')
        folder=Path(directory)
        manifest=json.loads((folder/'manifest.json').read_text(encoding='utf-8'))
        for item in manifest['entries']:
            path=folder/item['path']
            client.upload_file(str(path),bucket,'analytics/'+item['path'],ExtraArgs={'ContentType':'application/json; charset=utf-8','CacheControl':'public, max-age=31536000, immutable'})
            client.head_object(Bucket=bucket,Key='analytics/'+item['path'])
        # The manifest becomes visible only after every object has been verified.
        client.upload_file(str(folder/'manifest.json'),bucket,'analytics/manifest.json',ExtraArgs={'ContentType':'application/json; charset=utf-8','CacheControl':'public, max-age=60'})
        print(f"Published {len(manifest['entries'])} aggregate snapshots.",flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Publish TiDB CSV snapshots directly to Cloudflare R2.")
    parser.add_argument("--yes-remote", action="store_true", help="Export live TiDB data and upload to R2.")
    parser.add_argument("--only", choices=tuple(DATASETS), help="Publish one dataset.")
    parser.add_argument("--analytics", action="store_true", help="Publish versioned aggregate analytics instead of raw CSV.")
    args = parser.parse_args()
    if not args.yes_remote:
        print("No data exported. Pass --yes-remote to create and upload R2 snapshots.")
        return
    load_env()
    if args.analytics:
        publish_analytics()
        return
    bucket = required("R2_BUCKET")
    conn = connect(require_config())
    try:
        client = r2_client()
        for code in ([args.only] if args.only else DATASETS): publish_one(conn, client, bucket, code)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
