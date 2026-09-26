# -*- coding: utf-8 -*-
"""Apply merged chunk SQL files via libsql (requires TURSO_AUTH_TOKEN in environment)."""
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

CHUNK_DIR = ROOT / "data" / "turso_chunks"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("prefix")
    ap.add_argument("--start", type=int, default=0)
    args = ap.parse_args()

    url = (os.environ.get("TURSO_DATABASE_URL") or "").strip()
    token = (os.environ.get("TURSO_AUTH_TOKEN") or "").strip()
    if not url:
        url = "libsql://baoan-searcher-dankezo.aws-ap-northeast-1.turso.io"
    if not token:
        print("ERROR: set TURSO_AUTH_TOKEN in .env for libsql bulk push", file=sys.stderr)
        return 2

    files = sorted(CHUNK_DIR.glob(f"{args.prefix}_*.sql"))[args.start :]
    db = libsql_client.create_client_sync(url=url, auth_token=token)
    try:
        for i, p in enumerate(files):
            db.execute(p.read_text(encoding="utf-8"))
            if (i + 1) % 10 == 0 or i + 1 == len(files):
                print(f"… {args.prefix} {i + 1}/{len(files)}", flush=True)
    finally:
        db.close()
    print(f"Done {args.prefix}: {len(files)} chunks")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
