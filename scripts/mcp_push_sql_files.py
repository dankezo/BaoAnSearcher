# -*- coding: utf-8 -*-
"""Print SQL file paths for Turso MCP write_database (agent-driven push).

When TURSO_AUTH_TOKEN is unset locally, push each path via MCP write_database
with the file contents as sql=.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BATCH_DIR = ROOT / "data" / "turso_batches"
CHUNK_DIR = ROOT / "data" / "turso_chunks"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("prefix", help="e.g. dav, msc_prices, vss")
    ap.add_argument("--chunks", action="store_true")
    ap.add_argument("--from", dest="start", type=int, default=0)
    ap.add_argument("--count", type=int, default=10)
    args = ap.parse_args()
    base = CHUNK_DIR if args.chunks else BATCH_DIR
    files = sorted(base.glob(f"{args.prefix}_*.sql"))
    slice_ = files[args.start : args.start + args.count]
    for p in slice_:
        print(json.dumps({"path": str(p), "bytes": p.stat().st_size}, ensure_ascii=False))


if __name__ == "__main__":
    main()
