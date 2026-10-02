# -*- coding: utf-8 -*-
"""Check the dirty-value contract locally. With --yes-remote, compare counts on TiDB.

  python scripts/tidb/verify.py
  python scripts/tidb/verify.py --yes-remote
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from connect import connect, public_target, require_config
from rows import self_check
from sync_to_tidb import source_counts

CHECKS = (
    (
        "vss_bids",
        "SELECT /*+ READ_FROM_STORAGE(TIFLASH[vss_bids]) */ COUNT(*) FROM vss_bids",
        "SELECT COUNT(*) FROM vss_bids",
    ),
    (
        "dav_drugs",
        "SELECT /*+ READ_FROM_STORAGE(TIFLASH[dav_drugs]) */ COUNT(*) FROM dav_drugs",
        "SELECT COUNT(*) FROM dav_drugs",
    ),
    (
        "msc_prices",
        "SELECT /*+ READ_FROM_STORAGE(TIFLASH[msc_prices]) */ COUNT(*) FROM msc_prices",
        "SELECT COUNT(*) FROM msc_prices",
    ),
    (
        "msc_tenders",
        "SELECT /*+ READ_FROM_STORAGE(TIFLASH[msc_tenders]) */ COUNT(*) FROM msc_tenders",
        "SELECT COUNT(*) FROM msc_tenders",
    ),
    (
        "agg_vss_monthly",
        "SELECT COUNT(*) FROM agg_vss_monthly",
        "SELECT COUNT(*) FROM agg_vss_monthly",
    ),
    (
        "suggest_values",
        "SELECT COUNT(*) FROM suggest_values",
        "SELECT COUNT(*) FROM suggest_values",
    ),
)

SUBSTRINGS = (
    (
        "cillin",
        "SELECT /*+ READ_FROM_STORAGE(TIFLASH[vss_bids]) */ COUNT(*) FROM vss_bids WHERE loai = %s AND search LIKE %s",
        "SELECT COUNT(*) FROM vss_bids WHERE loai = %s AND search LIKE %s",
        ("Tân dược", "%cillin%"),
    ),
    (
        "uroxim",
        "SELECT /*+ READ_FROM_STORAGE(TIFLASH[vss_bids]) */ COUNT(*) FROM vss_bids WHERE loai = %s AND search LIKE %s",
        "SELECT COUNT(*) FROM vss_bids WHERE loai = %s AND search LIKE %s",
        ("Tân dược", "%uroxim%"),
    ),
)

TIFLASH_TABLES = ("vss_bids", "dav_drugs", "msc_prices", "msc_tenders")


def _tiflash_ready(cur) -> list[str]:
    cur.execute(
        "SELECT table_name, replica_count, available, progress "
        "FROM information_schema.tiflash_replica "
        "WHERE table_schema = DATABASE() "
        "AND table_name IN (%s)" % ",".join("%s" for _ in TIFLASH_TABLES),
        TIFLASH_TABLES,
    )
    rows = {str(row[0]): row for row in cur.fetchall()}
    failed = []
    for table in TIFLASH_TABLES:
        row = rows.get(table)
        if not row:
            print(f"TiFlash {table}: missing")
            failed.append(table)
            continue
        replicas, available, progress = int(row[1] or 0), int(row[2] or 0), float(row[3] or 0)
        print(f"TiFlash {table}: replicas={replicas} available={available} progress={progress:.2f}")
        if replicas < 1 or available != 1 or progress < 1:
            failed.append(table)
    return failed


def _explain_ingredient_lookup(cur) -> None:
    cur.execute(
        "EXPLAIN SELECT /*+ USE_INDEX(msc_prices, idx_msc_prices_ingredient_f) */ source_id "
        "FROM msc_prices WHERE ingredient_f LIKE %s "
        "ORDER BY published DESC, source_id LIMIT 51",
        ("silymarin%",),
    )
    lines = cur.fetchall()
    print("ingredient lookup plan:")
    for line in lines:
        print("  " + " | ".join(str(value) for value in line))


def _count_args(cur, hinted: str, plain: str, args: tuple) -> int:
    try:
        cur.execute(hinted, args)
        return int(cur.fetchone()[0])
    except Exception as exc:
        print(f"  TiFlash chưa sẵn ({exc.__class__.__name__}), đếm lại không hint")
        connection = getattr(cur, "connection", None)
        if connection is not None:
            connection.rollback()
        cur.execute(plain, args)
        return int(cur.fetchone()[0])


def _count(cur, hinted: str, plain: str) -> int:
    try:
        cur.execute(hinted)
        return int(cur.fetchone()[0])
    except Exception as exc:
        print(f"  TiFlash chưa sẵn ({exc.__class__.__name__}), đếm lại không hint")
        connection = getattr(cur, "connection", None)
        if connection is not None:
            connection.rollback()
        cur.execute(plain)
        return int(cur.fetchone()[0])


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Verify TiDB sync.")
    parser.add_argument("--yes-remote", action="store_true")
    args = parser.parse_args()
    failures = self_check()
    if failures:
        for item in failures:
            print(f"local fail {item}")
        raise SystemExit(1)
    print("local dirty-value check ok")
    if not args.yes_remote:
        print("TiDB unchanged. Pass --yes-remote to compare counts.")
        return
    cfg = require_config()
    print(f"verify {public_target(cfg)}")
    expected = source_counts()
    conn = connect(cfg)
    mismatches = []
    try:
        with conn.cursor() as cur:
            tiflash_failed = _tiflash_ready(cur)
            if tiflash_failed:
                mismatches.extend(f"tiflash:{table}" for table in tiflash_failed)
            for key, hinted, plain in CHECKS:
                got = _count(cur, hinted, plain)
                want = expected.get(key)
                print(f"{key}: tidb {got:,} sqlite {want}")
                if key == "suggest_values" and want is not None and 0 < got <= want:
                    continue
                if want is not None and got != want:
                    mismatches.append(key)
            cillin = _count_args(cur, *SUBSTRINGS[0][1:])
            uroxim = _count_args(cur, *SUBSTRINGS[1][1:])
            cur.execute(
                "SELECT COUNT(*) FROM vss_bids WHERE gia IS NULL AND gia_raw IS NOT NULL"
            )
            dirty_gia = int(cur.fetchone()[0])
            _explain_ingredient_lookup(cur)
        conn.rollback()
    finally:
        conn.close()
    print(f"search LIKE '%cillin%' trong Tân dược: {cillin:,}")
    print(f"search LIKE '%uroxim%' trong Tân dược: {uroxim:,}")
    print(f"gia NULL with gia_raw: {dirty_gia:,}")
    if cillin < 1 or uroxim < 1:
        mismatches.append("substring")
    if mismatches:
        print("mismatch " + ", ".join(mismatches))
        raise SystemExit(1)
    print("verify ok")


if __name__ == "__main__":
    main()
