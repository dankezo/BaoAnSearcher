# -*- coding: utf-8 -*-
"""Push local SQLite → Turso using SQL batches from turso_mcp_batch_sql (libsql execute).

Same statements as Turso MCP write_database; use when batch count is large (~747k VSS).

Env: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN (see .env.example)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

try:
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
    load_dotenv(ROOT / "web" / ".env.local")
except ImportError:
    pass

import libsql_client

from scripts import turso_mcp_batch_sql as tbs
from server import dav, msc, vss
from server.common import MSC_DB, now_iso

PROGRESS_EVERY = 5000


def _client():
    url = (os.environ.get("TURSO_DATABASE_URL") or "").strip()
    token = (os.environ.get("TURSO_AUTH_TOKEN") or "").strip()
    if not url or not token:
        raise SystemExit("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN in .env")
    return libsql_client.create_client_sync(url=url, auth_token=token)


def _push(gen, label: str, db) -> int:
    n = 0
    for sql in gen:
        if not sql:
            continue
        db.execute(sql)
        # rows in batch ≈ count of "), (" + 1 — approximate via BATCH
        batch_n = sql.count("), (") + 1
        n += batch_n
        if n % PROGRESS_EVERY < batch_n or n == batch_n:
            print(f"  … {label} {n:,}", flush=True)
    return n


def sync_vss(db, offset: int = 0) -> int:
    print(f"VSS → Turso (offset {offset:,})…", flush=True)
    skip = offset
    n = skip
    for sql in tbs.iter_vss_batches(offset):
        if not sql:
            continue
        db.execute(sql)
        batch_n = sql.count("), (") + 1
        n += batch_n
        if n % PROGRESS_EVERY < batch_n:
            print(f"  … {n:,}", flush=True)
    meta = vss.meta_info()
    meta.update({"synced": n, "synced_at": now_iso(), "min_year": tbs.VSS_MIN_YEAR, "backend": "turso"})
    db.execute(tbs.app_meta_sql("vss", meta))
    print(f"VSS done: {n:,}")
    return n


def sync_dav(db) -> int:
    print("DAV → Turso…", flush=True)
    n = _push(tbs.iter_dav_batches(), "DAV", db)
    meta = dav.meta_info()
    meta.update({"synced": n, "synced_at": now_iso(), "backend": "turso"})
    db.execute(tbs.app_meta_sql("dav", meta))
    print(f"DAV done: {n:,}")
    return n


def sync_msc(db) -> int:
    if not MSC_DB.exists():
        print("MSC skip — no DB")
        return 0
    print("MSC → Turso…", flush=True)
    total = 0
    for kind in ("prices", "tenders"):
        n = _push(tbs.iter_msc_batches(kind), kind, db)
        print(f"  {kind}: {n:,}")
        total += n
    meta = msc.meta_info()
    meta.update({"synced": total, "synced_at": now_iso(), "backend": "turso"})
    db.execute(tbs.app_meta_sql("msc", meta))
    print(f"MSC done: {total:,}")
    return total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="vss,dav,msc")
    ap.add_argument("--vss-offset", type=int, default=0)
    args = ap.parse_args()
    only = {x.strip().lower() for x in args.only.split(",") if x.strip()}
    t0 = time.time()
    db = _client()
    try:
        if "vss" in only:
            sync_vss(db, args.vss_offset)
        if "dav" in only:
            sync_dav(db)
        if "msc" in only:
            sync_msc(db)
    finally:
        db.close()
    print(f"ALL OK in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
