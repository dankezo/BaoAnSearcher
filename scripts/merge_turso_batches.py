# -*- coding: utf-8 -*-
"""Merge small SQL batch files into chunks for fewer Turso MCP write_database calls."""
from __future__ import annotations

import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IN_DIR = ROOT / "data" / "turso_batches"
OUT_DIR = ROOT / "data" / "turso_chunks"


def merge(prefix: str, per_chunk: int):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    files = sorted(IN_DIR.glob(f"{prefix}_*.sql"))
    idx = 0
    for i in range(0, len(files), per_chunk):
        chunk_files = files[i : i + per_chunk]
        sql = "\n".join(f.read_text(encoding="utf-8") for f in chunk_files)
        out = OUT_DIR / f"{prefix}_{idx:05d}.sql"
        out.write_text(sql, encoding="utf-8")
        idx += 1
    print(f"{prefix}: {len(files)} batches -> {idx} chunks", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("prefix")
    ap.add_argument("--per-chunk", type=int, default=10)
    args = ap.parse_args()
    merge(args.prefix, args.per_chunk)


if __name__ == "__main__":
    main()
