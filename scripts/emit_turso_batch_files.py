# -*- coding: utf-8 -*-
"""Write SQL batch files for Turso MCP write_database (no Turso env required)."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts import turso_mcp_batch_sql as tbs

OUT = ROOT / "data" / "turso_batches"


def write_batches(name: str, gen, combine: int = 1):
    OUT.mkdir(parents=True, exist_ok=True)
    buf: list[str] = []
    idx = 0
    for sql in gen:
        if not sql:
            continue
        buf.append(sql)
        if len(buf) >= combine:
            path = OUT / f"{name}_{idx:06d}.sql"
            path.write_text(";\n".join(buf) + ";", encoding="utf-8")
            idx += 1
            buf = []
    if buf:
        path = OUT / f"{name}_{idx:06d}.sql"
        path.write_text(";\n".join(buf) + ";", encoding="utf-8")
        idx += 1
    print(f"{name}: {idx} files in {OUT}", flush=True)
    return idx


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--table", required=True, choices=("vss", "dav", "msc"))
    ap.add_argument("--msc-kind", choices=("prices", "tenders"))
    ap.add_argument("--combine", type=int, default=5, help="INSERT statements per file")
    ap.add_argument("--vss-offset", type=int, default=0)
    args = ap.parse_args()

    if args.table == "vss":
        write_batches("vss", tbs.iter_vss_batches(args.vss_offset), args.combine)
    elif args.table == "dav":
        write_batches("dav", tbs.iter_dav_batches(), args.combine)
    else:
        if not args.msc_kind:
            ap.error("--msc-kind required")
        write_batches(f"msc_{args.msc_kind}", tbs.iter_msc_batches(args.msc_kind), args.combine)


if __name__ == "__main__":
    main()
