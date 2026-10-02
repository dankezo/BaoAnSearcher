# -*- coding: utf-8 -*-
"""Read-only check that TiDB answers. Prints the target without the password.

  python scripts/tidb/probe.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from connect import connect, public_target, require_config


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    cfg = require_config()
    print(f"probe {public_target(cfg)}")
    conn = connect(cfg)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT VERSION()")
            version = cur.fetchone()[0]
            cur.execute("SHOW TABLES")
            tables = [row[0] for row in cur.fetchall()]
            cur.execute(
                "SELECT DATA_TYPE FROM information_schema.columns "
                "WHERE table_schema = DATABASE() AND table_name = 'vss_bids' AND column_name = 'gia'"
            )
            gia = cur.fetchone()
        conn.rollback()
    finally:
        conn.close()
    print(f"version {version}")
    print("tables " + (", ".join(tables) if tables else "(none)"))
    print("vss_bids.gia " + (gia[0] if gia else "missing"))


if __name__ == "__main__":
    main()
