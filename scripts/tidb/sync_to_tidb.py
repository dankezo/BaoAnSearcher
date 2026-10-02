# -*- coding: utf-8 -*-
"""Idempotent SQLite → TiDB upsert. Default dry-run does not connect.

Batches of 1000 use INSERT ... ON DUPLICATE KEY UPDATE.
Resume state: data/.tidb_sync_state.json (gitignored).

  python scripts/tidb/sync_to_tidb.py
  python scripts/tidb/sync_to_tidb.py --yes-remote
  python scripts/tidb/sync_to_tidb.py --yes-remote --only vss --from-start
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import traceback
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from server import dav
from server.common import DAV_DB, MSC_DB, VSS_DB, configure_sqlite

from checkpoint import load_state, resume_cursor, save_state
from connect import connect, public_target, require_config
from rows import (
    BATCH,
    DAV_COLUMNS,
    MSC_PRICE_COLUMNS,
    MSC_TENDER_COLUMNS,
    PRIMARY_KEYS,
    ROLLUP_COLUMNS,
    SUGGEST_COLUMNS,
    VSS_COLUMNS,
    build_dav_row,
    build_msc_price_row,
    build_msc_tender_row,
    build_rollup_row,
    build_suggest_row,
    build_vss_row,
    row_args,
    upsert_sql,
)

ROLLUP_PATH = ROOT / "data" / "rollups" / "agg_vss_monthly.jsonl"
SUGGEST_PATH = ROOT / "data" / "rollups" / "suggest_values.jsonl"
META_KEYS = {
    "vss_bids": "vss_total",
    "dav_drugs": "dav_total",
    "msc_prices": "msc_prices_total",
    "msc_tenders": "msc_total",
}


def connect_ro(path: Path):
    uri = quote(path.resolve().as_posix(), safe=":/")
    con = sqlite3.connect(f"file:{uri}?mode=ro", uri=True)
    configure_sqlite(con)
    return con


def file_stamp(path: Path) -> dict | None:
    if not path.exists():
        return None
    stat = path.stat()
    return {"size": stat.st_size, "mtime_ns": stat.st_mtime_ns}


def source_counts() -> dict:
    counts = {}
    if VSS_DB.exists():
        con = connect_ro(VSS_DB)
        try:
            counts["vss_bids"] = con.execute("SELECT COUNT(*) FROM bids").fetchone()[0]
        finally:
            con.close()
    else:
        counts["vss_bids"] = None
    if DAV_DB.exists():
        con = connect_ro(DAV_DB)
        try:
            counts["dav_drugs"] = con.execute("SELECT COUNT(*) FROM drugs").fetchone()[0]
        except sqlite3.Error:
            counts["dav_drugs"] = None
        finally:
            con.close()
    else:
        counts["dav_drugs"] = None
    if MSC_DB.exists():
        con = connect_ro(MSC_DB)
        try:
            for kind, key in (("prices", "msc_prices"), ("tenders", "msc_tenders")):
                counts[key] = con.execute(
                    "SELECT COUNT(*) FROM records WHERE kind = ? AND "
                    "(kind <> 'prices' OR (json_extract(normalized, '$.source_label')='API Mua sắm công' "
                    "AND NOT EXISTS (SELECT 1 FROM excel_matches m WHERE m.excel_id=records.source_id)))", (kind,)
                ).fetchone()[0]
        except sqlite3.Error:
            counts["msc_prices"] = None
            counts["msc_tenders"] = None
        finally:
            con.close()
    else:
        counts["msc_prices"] = None
        counts["msc_tenders"] = None
    counts["agg_vss_monthly"] = _jsonl_count(ROLLUP_PATH)
    counts["suggest_values"] = _jsonl_count(SUGGEST_PATH)
    return counts


def _jsonl_count(path: Path):
    if not path.exists():
        return None
    count = 0
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                count += 1
    return count


LOG_PATH = ROOT / "data" / "tidb_sync.log"


def _log(message: str) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(message.rstrip() + "\n")
    print(message, flush=True)


def _flush(conn, table: str, columns: tuple[str, ...], batch: list[dict]) -> int:
    if not batch:
        return 0
    keys = PRIMARY_KEYS[table]
    deduped = {}
    order = []
    for row in batch:
        key = tuple(row.get(column) for column in keys)
        if key not in deduped:
            order.append(key)
        deduped[key] = row
    return _flush_rows(conn, table, columns, [deduped[key] for key in order])


def _flush_rows(conn, table: str, columns: tuple[str, ...], rows: list[dict]) -> int:
    if not rows:
        return 0
    sql = upsert_sql(table, columns, len(rows))
    args = []
    for row in rows:
        args.extend(row_args(row, columns))
    try:
        with conn.cursor() as cur:
            cur.execute(sql, args)
        conn.commit()
        return len(rows)
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            raise
        text = str(exc)
        if len(rows) == 1 or "Lost connection" in text or "server has gone away" in text:
            if len(rows) == 1 and "Lost connection" not in text and "server has gone away" not in text:
                pk = PRIMARY_KEYS[table]
                ident = tuple(rows[0].get(column) for column in pk)
                _log(f"skip {table} {ident} {exc.__class__.__name__}: {text[:240]}")
                return 0
            raise
        mid = max(1, len(rows) // 2)
        return (
            _flush_rows(conn, table, columns, rows[:mid])
            + _flush_rows(conn, table, columns, rows[mid:])
        )


def _remember(state: dict, key: str, entry: dict) -> None:
    state[key] = entry
    save_state(state)


def _require_typed_schema(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT DATA_TYPE FROM information_schema.columns "
            "WHERE table_schema = DATABASE() AND table_name = 'vss_bids' AND column_name = 'gia'"
        )
        row = cur.fetchone()
    if not row or str(row[0]).lower() != "decimal":
        raise SystemExit("Schema 002 chưa áp. Chạy python scripts/tidb/apply_schema.py --yes-remote trước.")


def _write_meta(conn, key_name: str, table: str) -> None:
    if table not in PRIMARY_KEYS:
        raise KeyError(table)
    with conn.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) FROM {table}")
        total = int(cur.fetchone()[0])
        cur.execute(
            "INSERT INTO app_metadata (key_name, total_records) VALUES (%s, %s) "
            "ON DUPLICATE KEY UPDATE total_records = VALUES(total_records)",
            (key_name, total),
        )
        registry_code = {
            "dav_total": "DAV",
            "msc_prices_total": "MSC_PRICE",
            "msc_total": "MSC_BID",
            "vss_total": "VSS",
        }.get(key_name)
        if registry_code:
            snapshot_url = (os.environ.get(f"R2_SNAPSHOT_{registry_code}_URL") or "").strip() or None
            snapshot_size = (os.environ.get(f"R2_SNAPSHOT_{registry_code}_SIZE_MB") or "").strip() or None
            cur.execute(
                "UPDATE data_registry_meta SET total_records=%s, status='healthy', "
                "last_synced_at=CURRENT_TIMESTAMP, "
                "r2_download_url=COALESCE(%s, r2_download_url), "
                "file_size_mb=COALESCE(%s, file_size_mb) WHERE dataset_code=%s",
                (total, snapshot_url, snapshot_size, registry_code),
            )
    conn.commit()
    print(f"  {key_name}={total:,}")


def refresh_msc_price_metric_rollup(conn) -> None:
    """Refresh the small monthly metric table after an MSC price sync.

    This is deliberately part of the ingestion job, never the web request
    path.  The transaction makes readers observe either the previous complete
    snapshot or the new complete snapshot, never an empty intermediate table.
    """
    with conn.cursor() as cur:
        cur.execute("DELETE FROM agg_msc_price_monthly")
        cur.execute(
            """
            INSERT INTO agg_msc_price_monthly
                (ym, province, group_name, revenue, quantity, cnt)
            SELECT DATE_FORMAT(published, '%Y-%m') AS ym,
                   COALESCE(province, ''),
                   COALESCE(group_name, ''),
                   SUM(COALESCE(unit_price, 0) * COALESCE(quantity, 0)),
                   SUM(COALESCE(quantity, 0)),
                   COUNT(*)
              FROM msc_prices
             WHERE published IS NOT NULL
             GROUP BY DATE_FORMAT(published, '%Y-%m'),
                      COALESCE(province, ''), COALESCE(group_name, '')
            """
        )
        cur.execute("SELECT COUNT(*) FROM agg_msc_price_monthly")
        rows = int(cur.fetchone()[0])
    conn.commit()
    print(f"msc_price_metric_rollup refreshed: {rows:,} rows")


def sync_vss(conn, state: dict, from_start: bool) -> int:
    stamp = file_stamp(VSS_DB)
    entry = {"stamp": stamp, "sent": 0} if from_start or stamp is None else resume_cursor(state, "vss_bids", stamp)
    last_id = 0 if from_start else int(entry.get("last_id") or 0)
    sent = 0 if from_start else int(entry.get("sent") or 0)
    if not VSS_DB.exists():
        print("  skip vss — missing sqlite")
        return 0
    con = connect_ro(VSS_DB)
    batch = []
    try:
        cur = con.execute(
            "SELECT id, fingerprint, raw, search, nam, tungay_hd, denngay_hd "
            "FROM bids WHERE id > ? ORDER BY id",
            (last_id,),
        )
        while True:
            fetched = cur.fetchmany(BATCH)
            if not fetched:
                break
            for row_id, fingerprint, raw, search, nam, tungay, denngay in fetched:
                last_id = row_id
                built = build_vss_row({
                    "fingerprint": fingerprint,
                    "raw": raw,
                    "search": search,
                    "nam": nam,
                    "tungay_hd": tungay,
                    "denngay_hd": denngay,
                })
                if built:
                    batch.append(built)
                if len(batch) >= BATCH:
                    sent += _flush(conn, "vss_bids", VSS_COLUMNS, batch)
                    batch = []
                    entry.update({"stamp": stamp, "last_id": last_id, "sent": sent})
                    _remember(state, "vss_bids", entry)
                    print(f"  vss … {sent:,}", flush=True)
        if batch:
            sent += _flush(conn, "vss_bids", VSS_COLUMNS, batch)
            entry.update({"stamp": stamp, "last_id": last_id, "sent": sent, "done": True})
            _remember(state, "vss_bids", entry)
        else:
            entry.update({"stamp": stamp, "last_id": last_id, "sent": sent, "done": True})
            _remember(state, "vss_bids", entry)
    finally:
        con.close()
    _write_meta(conn, "vss_total", "vss_bids")
    print(f"vss done {sent:,}")
    return sent


def sync_dav(conn, state: dict, from_start: bool) -> int:
    stamp = file_stamp(DAV_DB)
    entry = {"stamp": stamp, "sent": 0} if from_start or stamp is None else resume_cursor(state, "dav_drugs", stamp)
    last_id = 0 if from_start else int(entry.get("last_id") or 0)
    sent = 0 if from_start else int(entry.get("sent") or 0)
    if not DAV_DB.exists():
        print("  skip dav — missing sqlite")
        return 0
    con = connect_ro(DAV_DB)
    batch = []
    try:
        cur = con.execute(
            "SELECT rowid, raw FROM drugs WHERE rowid > ? ORDER BY rowid",
            (last_id,),
        )
        while True:
            fetched = cur.fetchmany(BATCH)
            if not fetched:
                break
            for row_id, raw in fetched:
                last_id = row_id
                try:
                    built = build_dav_row(dav.flatten(json.loads(raw)))
                except (json.JSONDecodeError, TypeError):
                    continue
                if built:
                    batch.append(built)
                if len(batch) >= BATCH:
                    sent += _flush(conn, "dav_drugs", DAV_COLUMNS, batch)
                    batch = []
                    entry.update({"stamp": stamp, "last_id": last_id, "sent": sent})
                    _remember(state, "dav_drugs", entry)
                    print(f"  dav … {sent:,}", flush=True)
        if batch:
            sent += _flush(conn, "dav_drugs", DAV_COLUMNS, batch)
        entry.update({"stamp": stamp, "last_id": last_id, "sent": sent, "done": True})
        _remember(state, "dav_drugs", entry)
    finally:
        con.close()
    _write_meta(conn, "dav_total", "dav_drugs")
    print(f"dav done {sent:,}")
    return sent


def _sync_msc(conn, state: dict, from_start: bool, kind: str, table: str, columns, builder) -> int:
    stamp = file_stamp(MSC_DB)
    entry = {"stamp": stamp, "sent": 0} if from_start or stamp is None else resume_cursor(state, table, stamp)
    last_id = "" if from_start else str(entry.get("last_id") or "")
    sent = 0 if from_start else int(entry.get("sent") or 0)
    if not MSC_DB.exists():
        print(f"  skip {table} — missing sqlite")
        return 0
    con = connect_ro(MSC_DB)
    batch = []
    try:
        cur = con.execute(
            "SELECT source_id, normalized, collected_at, search_text FROM records "
            "WHERE kind = ? AND source_id > ? AND "
            "(kind <> 'prices' OR (json_extract(normalized, '$.source_label')='API Mua sắm công' "
            "AND NOT EXISTS (SELECT 1 FROM excel_matches m WHERE m.excel_id=records.source_id))) ORDER BY source_id",
            (kind, last_id),
        )
        while True:
            fetched = cur.fetchmany(BATCH)
            if not fetched:
                break
            for source_id, normalized, collected, search_text in fetched:
                last_id = source_id
                try:
                    item = json.loads(normalized)
                except json.JSONDecodeError:
                    continue
                sid = str(source_id or "")
                built = builder(item, sid, search_text, collected)
                if built:
                    batch.append(built)
                if len(batch) >= BATCH:
                    sent += _flush(conn, table, columns, batch)
                    batch = []
                    entry.update({"stamp": stamp, "last_id": last_id, "sent": sent})
                    _remember(state, table, entry)
                    print(f"  {table} … {sent:,}", flush=True)
        if batch:
            sent += _flush(conn, table, columns, batch)
        entry.update({"stamp": stamp, "last_id": last_id, "sent": sent, "done": True})
        _remember(state, table, entry)
    finally:
        con.close()
    _write_meta(conn, META_KEYS[table], table)
    print(f"{table} done {sent:,}")
    return sent


def sync_jsonl(conn, state: dict, from_start: bool, key: str, path: Path, columns, builder) -> int:
    stamp = file_stamp(path)
    entry = {"stamp": stamp, "sent": 0} if from_start or stamp is None else resume_cursor(state, key, stamp)
    start_line = 0 if from_start else int(entry.get("line") or 0)
    sent = 0 if from_start else int(entry.get("sent") or 0)
    if stamp is None:
        print(f"  skip {key} — missing {path}")
        return 0
    batch = []
    line_no = 0
    with path.open(encoding="utf-8") as handle:
        for line_no, line in enumerate(handle):
            if line_no < start_line or not line.strip():
                continue
            built = builder(json.loads(line))
            if built:
                batch.append(built)
            if len(batch) >= BATCH:
                sent += _flush(conn, key, columns, batch)
                batch = []
                entry.update({"stamp": stamp, "line": line_no + 1, "sent": sent})
                _remember(state, key, entry)
                print(f"  {key} … {sent:,}", flush=True)
    if batch:
        sent += _flush(conn, key, columns, batch)
    entry.update({"stamp": stamp, "line": line_no + 1 if path.exists() else 0, "sent": sent, "done": True})
    _remember(state, key, entry)
    print(f"{key} done {sent:,}")
    return sent


def prune_msc_prices(conn) -> int:
    """Delete TiDB MSC price IDs absent from a completed authoritative snapshot."""
    if not MSC_DB.exists():
        raise RuntimeError("Không có SQLite MSC để xác nhận snapshot trước khi dọn TiDB.")
    local = connect_ro(MSC_DB)
    try:
        with conn.cursor() as cur:
            cur.execute("CREATE TEMPORARY TABLE sync_msc_price_ids (source_id VARCHAR(128) PRIMARY KEY)")
            sent = 0
            source = local.execute(
                "SELECT source_id FROM records WHERE kind='prices' "
                "AND json_extract(normalized, '$.source_label')='API Mua sắm công' "
                "AND NOT EXISTS (SELECT 1 FROM excel_matches m WHERE m.excel_id=records.source_id)"
            )
            while rows := source.fetchmany(BATCH):
                cur.executemany("INSERT INTO sync_msc_price_ids (source_id) VALUES (%s)", rows)
                sent += len(rows)
            cur.execute(
                "DELETE p FROM msc_prices AS p "
                "LEFT JOIN sync_msc_price_ids AS s ON s.source_id=p.source_id "
                "WHERE s.source_id IS NULL"
            )
            removed = cur.rowcount
            cur.execute("DROP TEMPORARY TABLE sync_msc_price_ids")
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        local.close()
    _write_meta(conn, "msc_prices_total", "msc_prices")
    print(f"msc_prices prune: source {sent:,}, removed {removed:,}")
    return removed


def _assert_completed_price_snapshot() -> None:
    state = load_state().get("msc_prices") or {}
    expected = source_counts().get("msc_prices")
    if (
        not state.get("done")
        or state.get("stamp") != file_stamp(MSC_DB)
        or expected is None
        or int(state.get("sent") or 0) < int(expected)
    ):
        raise RuntimeError("Không có snapshot MSC hoàn tất, cùng phiên nguồn hiện tại; từ chối dọn TiDB.")


def run_remote(only: set[str], from_start: bool, prune: bool, prune_only: bool) -> None:
    cfg = require_config()
    print(f"sync {public_target(cfg)} batch {BATCH}")
    conn = connect(cfg)
    state = {} if from_start else load_state()
    try:
        _require_typed_schema(conn)
        if prune_only:
            if only != {"prices"}:
                raise RuntimeError("--prune-only yêu cầu --only prices.")
            _assert_completed_price_snapshot()
            prune_msc_prices(conn)
            return
        if "vss" in only:
            sync_vss(conn, state, from_start)
        if "dav" in only:
            sync_dav(conn, state, from_start)
        if "prices" in only:
            _sync_msc(conn, state, from_start, "prices", "msc_prices", MSC_PRICE_COLUMNS, build_msc_price_row)
            if prune:
                if not from_start:
                    raise RuntimeError("--prune chỉ an toàn sau --from-start để có snapshot MSC đầy đủ.")
                prune_msc_prices(conn)
            refresh_msc_price_metric_rollup(conn)
        if "tenders" in only:
            _sync_msc(conn, state, from_start, "tenders", "msc_tenders", MSC_TENDER_COLUMNS, build_msc_tender_row)
        if "rollup" in only:
            sync_jsonl(conn, state, from_start, "agg_vss_monthly", ROLLUP_PATH, ROLLUP_COLUMNS, build_rollup_row)
        if "suggest" in only:
            sync_jsonl(conn, state, from_start, "suggest_values", SUGGEST_PATH, SUGGEST_COLUMNS, build_suggest_row)
    finally:
        conn.close()


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Upsert local catalogs into TiDB.")
    parser.add_argument("--yes-remote", action="store_true", help="Write to the configured cluster.")
    parser.add_argument("--only", default="vss,dav,prices,tenders,rollup,suggest")
    parser.add_argument("--from-start", action="store_true", help="Ignore the resume cursor.")
    parser.add_argument("--prune", action="store_true", help="Remove MSC price IDs absent from a completed --from-start snapshot.")
    parser.add_argument("--prune-only", action="store_true", help="Prune after verifying the latest completed local MSC snapshot.")
    args = parser.parse_args()
    only = {part.strip().lower() for part in args.only.split(",") if part.strip()}
    counts = source_counts()
    for key in ("vss_bids", "dav_drugs", "msc_prices", "msc_tenders", "agg_vss_monthly", "suggest_values"):
        value = counts.get(key)
        shown = "missing" if value is None else f"{value:,}"
        print(f"{key}: {shown}")
    print(f"batch {BATCH}, checkpoint data/.tidb_sync_state.json")
    if not args.yes_remote:
        print("TiDB unchanged. Pass --yes-remote after apply_schema.py --yes-remote.")
        return
    try:
        run_remote(only, args.from_start, args.prune, args.prune_only)
    except Exception:
        _log(traceback.format_exc()[-2000:])
        raise


if __name__ == "__main__":
    main()
