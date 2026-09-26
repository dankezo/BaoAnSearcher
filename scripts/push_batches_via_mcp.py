# -*- coding: utf-8 -*-
"""Read SQL batch files and apply via Turso HTTP pipeline (needs TURSO_AUTH_TOKEN).

Falls back to printing file index for MCP write_database when token missing.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

try:
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
except ImportError:
    pass

import libsql_client

BATCH_DIR = ROOT / "data" / "turso_batches"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("prefix")
    ap.add_argument("--start", type=int, default=0)
    ap.add_argument("--limit", type=int, default=0, help="0 = all")
    args = ap.parse_args()

    url = (os.environ.get("TURSO_DATABASE_URL") or "").strip()
    token = (os.environ.get("TURSO_AUTH_TOKEN") or "").strip()
    if not url:
        url = "libsql://baoan-searcher-dankezo.aws-ap-northeast-1.turso.io"

    files = sorted(BATCH_DIR.glob(f"{args.prefix}_*.sql"))
    if args.start:
        files = files[args.start:]
    if args.limit:
        files = files[: args.limit]

    if not token:
        print("NO_TOKEN", len(files), "files", flush=True)
        for i, p in enumerate(files):
            print(f"{i}\t{p.name}\t{p.stat().st_size}", flush=True)
        return 2

    db = libsql_client.create_client_sync(url=url, auth_token=token)
    try:
        for i, p in enumerate(files):
            db.execute(p.read_text(encoding="utf-8"))
            if (i + 1) % 20 == 0 or i + 1 == len(files):
                print(f"… {i + 1}/{len(files)} {p.name}", flush=True)
    finally:
        db.close()
    print(f"Done {args.prefix}: {len(files)} batches")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
