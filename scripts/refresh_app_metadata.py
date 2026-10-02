# -*- coding: utf-8 -*-
"""Write catalog totals once into each local SQLite file.

Search and /api/tender/meta read these rows. They do not COUNT(*) on each request.
"""
from __future__ import annotations
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server.common import DAV_DB, MSC_DB, VSS_DB, write_metadata
from server.stored_metrics import refresh_dav, refresh_vss


def refresh(path: Path, statements: list[tuple[str, str]]) -> None:
    if not path.exists():
        print(f"skip missing {path}")
        return
    con = sqlite3.connect(path)
    try:
        for key, sql in statements:
            total = con.execute(sql).fetchone()[0]
            write_metadata(con, key, int(total or 0))
            print(f"{path.name} {key}={int(total or 0):,}")
        con.commit()
    finally:
        con.close()


def main() -> None:
    refresh(VSS_DB, [("vss_total", "SELECT COUNT(*) FROM bids")])
    refresh(DAV_DB, [("dav_total", "SELECT COUNT(*) FROM drugs")])
    refresh(MSC_DB, [
        ("msc_prices_total", "SELECT COUNT(*) FROM records WHERE kind='prices' AND NOT EXISTS (SELECT 1 FROM excel_matches m WHERE m.excel_id=records.source_id)"),
        ("msc_total", "SELECT COUNT(*) FROM records WHERE kind='tenders'"),
    ])
    print("metrics VSS…", flush=True)
    vss = refresh_vss()
    print(f"  vss rows={vss['total']:,}", flush=True)
    print("metrics DAV…", flush=True)
    dav_payload = refresh_dav()
    print(f"  dav rows={dav_payload['total']:,}", flush=True)


if __name__ == "__main__":
    main()
