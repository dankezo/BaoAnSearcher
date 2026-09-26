# -*- coding: utf-8 -*-
"""Push data/turso_chunks to Turso via libsql (same SQL as MCP write_database).

Usage:
  set TURSO_AUTH_TOKEN=...   # non-empty in .env or env
  python scripts/push_turso_chunks_mcp.py
  python scripts/push_turso_chunks_mcp.py --prefix msc_prices
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

try:
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
except ImportError:
    pass

import libsql_client

from scripts import turso_mcp_batch_sql as tbs
from server import dav, msc, vss
from server.common import now_iso

CHUNK_DIR = ROOT / "data" / "turso_chunks"


def _client():
    url = (os.environ.get("TURSO_DATABASE_URL") or "").strip()
    token = (os.environ.get("TURSO_AUTH_TOKEN") or "").strip()
    if not url:
        url = "libsql://baoan-searcher-dankezo.aws-ap-northeast-1.turso.io"
    if not token:
        raise SystemExit("TURSO_AUTH_TOKEN is empty — add DB token to .env (Turso dashboard → baoan-searcher → Create Token)")
    return libsql_client.create_client_sync(url=url, auth_token=token)


def _execute_with_retry(db, sql: str, retries: int = 6):
    delay = 1.0
    last = None
    for attempt in range(retries):
        try:
            db.execute(sql)
            return
        except Exception as e:
            last = e
            msg = str(e).lower()
            if attempt < retries - 1 and any(
                x in msg for x in ("timeout", "temporarily", "reset", "503", "429", "unavailable", "connection")
            ):
                time.sleep(delay)
                delay = min(delay * 1.8, 20)
                continue
            raise
    raise last


def push_prefix(db, prefix: str) -> int:
    files = sorted(CHUNK_DIR.glob(f"{prefix}_*.sql"))
    for i, p in enumerate(files):
        _execute_with_retry(db, p.read_text(encoding="utf-8"))
        if (i + 1) % 25 == 0 or i + 1 == len(files):
            print(f"  {prefix}: {i + 1}/{len(files)}", flush=True)
    return len(files)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prefix", default="", help="only msc_prices, dav, vss, etc.")
    args = ap.parse_args()
    db = _client()
    t0 = time.time()
    try:
        if args.prefix:
            push_prefix(db, args.prefix)
        else:
            for prefix in ("msc_prices", "msc_tenders", "dav", "vss"):
                if list(CHUNK_DIR.glob(f"{prefix}_*.sql")):
                    print(f"Pushing {prefix}…", flush=True)
                    push_prefix(db, prefix)
            for key, meta_fn in (("vss", vss.meta_info), ("dav", dav.meta_info), ("msc", msc.meta_info)):
                meta = meta_fn()
                if key == "vss":
                    meta.update({"min_year": tbs.VSS_MIN_YEAR})
                meta.update({"synced_at": now_iso(), "backend": "turso"})
                db.execute(tbs.app_meta_sql(key, meta))
    finally:
        db.close()
    print(f"Done in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
