# -*- coding: utf-8 -*-
"""Merge SQL batch files into ~max_kb chunks for Turso MCP write_database."""
from __future__ import annotations

import argparse
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IN_DIR = ROOT / "data" / "turso_batches"
OUT_DIR = ROOT / "data" / "turso_chunks"


def split_insert(sql: str, max_bytes: int) -> list[str]:
    m = re.match(r"(?is)(INSERT\s+OR\s+REPLACE\s+INTO\s+.+?\)\s+VALUES\s+)(.+)$", sql.strip().rstrip(";"))
    if not m:
        return [sql]
    head, values_blob = m.group(1), m.group(2).strip()
    rows = re.split(r"\),\s*\(", values_blob)
    if len(rows) == 1:
        return [sql if len(sql.encode("utf-8")) <= max_bytes else sql[: max_bytes // 2]]
    out: list[str] = []
    chunk: list[str] = []
    for i, row in enumerate(rows):
        row = row.strip()
        if i == 0:
            row = row.lstrip("(")
        if i == len(rows) - 1:
            row = row.rstrip(")")
        trial = head + "(" + "), (".join(chunk + [row]) + ");"
        if chunk and len(trial.encode("utf-8")) > max_bytes:
            out.append(head + "(" + "), (".join(chunk) + ");")
            chunk = [row]
        else:
            chunk.append(row)
    if chunk:
        out.append(head + "(" + "), (".join(chunk) + ");")
    return out


def merge(prefix: str, max_kb: int):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in OUT_DIR.glob(f"{prefix}_*.sql"):
        old.unlink()
    files = sorted(IN_DIR.glob(f"{prefix}_*.sql"))
    max_bytes = max_kb * 1024
    idx = 0
    buf: list[str] = []
    size = 0

    def flush():
        nonlocal idx, buf, size
        if not buf:
            return
        out = OUT_DIR / f"{prefix}_{idx:05d}.sql"
        out.write_text("\n".join(buf), encoding="utf-8")
        idx += 1
        buf = []
        size = 0

    for f in files:
        for piece in split_insert(f.read_text(encoding="utf-8"), max_bytes):
            part = piece if not buf else "\n" + piece
            if buf and size + len(part.encode("utf-8")) > max_bytes:
                flush()
            buf.append(piece)
            size += len(part.encode("utf-8"))
            if size >= max_bytes:
                flush()
    flush()
    print(f"{prefix}: {len(files)} batches -> {idx} chunks (max {max_kb}KB)", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("prefix")
    ap.add_argument("--max-kb", type=int, default=90)
    args = ap.parse_args()
    merge(args.prefix, args.max_kb)


if __name__ == "__main__":
    main()
