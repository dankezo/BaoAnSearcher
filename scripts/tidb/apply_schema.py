# -*- coding: utf-8 -*-
"""Apply idempotent TiDB migrations. Default is a dry run and does not connect.

  python scripts/tidb/apply_schema.py
  python scripts/tidb/apply_schema.py --yes-remote
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from connect import connect, public_target, require_config
from schema_sql import SCHEMA_FILES, load_statements


def describe() -> list[tuple[str, str]]:
    return load_statements()


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Apply TiDB schema 001 through 006.")
    parser.add_argument("--yes-remote", action="store_true", help="Execute on the configured cluster.")
    parser.add_argument("--only", choices=("001", "002", "003", "004", "005", "006"), help="Apply one idempotent migration only.")
    args = parser.parse_args()
    statements = describe()
    if args.only:
        statements = [(name, statement) for name, statement in statements if name.startswith(f"{args.only}_")]
    for path in SCHEMA_FILES:
        count = sum(1 for name, _statement in statements if name == path.name)
        print(f"{path.name}: {count} statements")
    tiflash = sum(1 for _name, statement in statements if "TIFLASH" in statement.upper())
    print(f"TiFlash statements: {tiflash}")
    if not args.yes_remote:
        suffix = f" {args.only}" if args.only else " 001 through 006"
        print(f"TiDB unchanged. Pass --yes-remote to apply{suffix}.")
        return
    cfg = require_config()
    print(f"apply {public_target(cfg)}")
    conn = connect(cfg)
    try:
        for index, (name, statement) in enumerate(statements, start=1):
            try:
                with conn.cursor() as cur:
                    cur.execute(statement)
                conn.commit()
            except Exception as exc:
                conn.rollback()
                print(f"stopped at {name} #{index}: {exc.__class__.__name__}: {exc}")
                raise SystemExit(1) from exc
            if index % 20 == 0 or index == len(statements):
                print(f"  … {index}/{len(statements)} {name}", flush=True)
    finally:
        conn.close()
    print("schema applied")


if __name__ == "__main__":
    main()
