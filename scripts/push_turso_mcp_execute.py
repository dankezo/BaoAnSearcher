# -*- coding: utf-8 -*-
"""Execute chunk SQL on Turso via libsql (same SQL as MCP write_database).

Requires TURSO_AUTH_TOKEN. Reads SQL from disk only — never prints secrets.
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

CHUNK_DIR = ROOT / "data" / "turso_chunks"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prefix", default="", help="optional prefix filter")
    ap.add_argument("--start", type=int, default=0)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    url = (os.environ.get("TURSO_DATABASE_URL") or "").strip()
    token = (os.environ.get("TURSO_AUTH_TOKEN") or "").strip()
    if not url:
        url = "libsql://baoan-searcher-dankezo.aws-ap-northeast-1.turso.io"
    if not token:
        print("ERROR: TURSO_AUTH_TOKEN missing — set in .env or env var", file=sys.stderr)
        return 2

    files = sorted(CHUNK_DIR.glob("*_*.sql"))
    if args.prefix:
        files = [f for f in files if f.name.startswith(args.prefix + "_")]
    files = files[args.start :]
    if args.limit:
        files = files[: args.limit]

    db = libsql_client.create_client_sync(url=url, auth_token=token)
    try:
        for i, p in enumerate(files):
            db.execute(p.read_text(encoding="utf-8"))
            if (i + 1) % 25 == 0 or i + 1 == len(files):
                print(f"OK {i + 1}/{len(files)} {p.name}", flush=True)
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
