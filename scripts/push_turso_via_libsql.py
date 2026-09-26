# -*- coding: utf-8 -*-
"""Push all turso_chunks/*.sql via libsql (TURSO_AUTH_TOKEN required)."""
from __future__ import annotations

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

CHUNK_DIR = ROOT / "data" / "turso_chunks"
PROGRESS = 5000


def main():
    url = (os.environ.get("TURSO_DATABASE_URL") or "").strip()
    token = (os.environ.get("TURSO_AUTH_TOKEN") or "").strip()
    if not url:
        url = "libsql://baoan-searcher-dankezo.aws-ap-northeast-1.turso.io"
    if not token:
        print("Missing TURSO_AUTH_TOKEN", file=sys.stderr)
        return 2

    prefixes = sorted({p.name.rsplit("_", 1)[0] for p in CHUNK_DIR.glob("*_*.sql")})
    files: list[Path] = []
    for prefix in prefixes:
        files.extend(sorted(CHUNK_DIR.glob(f"{prefix}_*.sql")))

    db = libsql_client.create_client_sync(url=url, auth_token=token)
    t0 = time.time()
    n = 0
    try:
        for p in files:
            db.execute(p.read_text(encoding="utf-8"))
            n += 1
            if n % 50 == 0 or n == len(files):
                print(f"… {n}/{len(files)} {p.name}", flush=True)
    finally:
        db.close()
    print(f"Done {n} chunks in {time.time() - t0:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
