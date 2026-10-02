"""One-shot local SQLite timings. Reads JSON queries on stdin, writes one JSON object per line.

Does not print secrets. Does not write to the databases.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _bytes(payload) -> int:
    return len(json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8"))


def _first_id(payload):
    if not isinstance(payload, dict):
        return None
    items = payload.get("items")
    if not isinstance(items, list) or not items or not isinstance(items[0], dict):
        return None
    row = items[0]
    for key in ("fingerprint", "id", "source_id", "soDangKy"):
        if row.get(key):
            return str(row.get(key))[:80]
    return None


def _needle(payload, filters):
    q = str((filters or {}).get("q") or "").strip()
    if not q or not isinstance(payload, dict):
        return None
    items = payload.get("items")
    if not isinstance(items, list) or not items:
        return None
    from server.common import fold
    blob = fold(json.dumps(items[0], ensure_ascii=False))
    words = [part for part in fold(q).split() if part]
    return all(part in blob for part in words)


def _rows(payload, op: str):
    if not isinstance(payload, dict):
        return None
    items = payload.get("items")
    if isinstance(items, list):
        return len(items)
    cards = payload.get("cards")
    if isinstance(cards, list):
        return len(cards)
    if op == "meta":
        return 1
    return None


def run_query(query: dict) -> dict:
    op = query.get("op")
    t0 = time.perf_counter()
    trips = None
    if op == "search":
        kind = query.get("kind")
        filters = query.get("filters") or {}
        page = int(query.get("page") or 0)
        size = int(query.get("size") or 100)
        if kind == "vss":
            from server.vss import search_bids
            payload = search_bids(filters, page, size)
            trips = 2
        elif kind == "dav":
            from server.dav import search_drugs
            payload = search_drugs(filters, page, size)
            trips = None
        elif kind in {"msc_prices", "prices"}:
            from server.msc import search
            payload = search("prices", filters, page, size)
            trips = 2
        elif kind in {"msc_tenders", "tenders"}:
            from server.msc import search
            payload = search("tenders", filters, page, size)
            trips = 2
        else:
            raise RuntimeError("unknown search kind")
    elif op == "meta":
        import sqlite3
        from server.common import DAV_DB, MSC_DB, VSS_DB
        section = str(query.get("section") or "vss")
        path = MSC_DB if section.startswith("msc") else DAV_DB if section == "dav" else VSS_DB
        con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            rows = con.execute(
                "SELECT key_name, total_records, updated_at FROM app_metadata"
            ).fetchall()
        finally:
            con.close()
        payload = {"rows": [{"key": r[0], "total": r[1], "updated": r[2]} for r in rows]}
        trips = 1
    elif op == "metrics-cache":
        from server.stored_metrics import read_metrics
        section = str(query.get("section") or "vss")
        payload = read_metrics(section) or {"missing": True}
        trips = 1
    elif op == "metrics-cold":
        # Local dashboard does not recompute on request. Time the dynamic slice
        # path (fact-table aggregate) without writing. Not the Turso SQL.
        from server.metric_slice import slice_payload
        payload = slice_payload({
            "section": "vss",
            "months": 12,
            "filters": {"loai": "Tân dược", "nam": 2025, "hoatchat": "cefuroxim"},
        })
        trips = None
    else:
        raise RuntimeError("unknown op")
    wall_ms = (time.perf_counter() - t0) * 1000
    return {
        "ok": True,
        "wallMs": round(wall_ms, 1),
        "bytes": _bytes(payload),
        "rows": _rows(payload, op),
        "trips": trips,
        "total": payload.get("total") if isinstance(payload, dict) else None,
        "firstId": _first_id(payload),
        "needle": _needle(payload, query.get("filters")),
    }


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        query = json.loads(line)
        qid = query.get("id")
        try:
            result = run_query(query)
        except Exception as exc:
            result = {"ok": False, "error": type(exc).__name__, "detail": str(exc)[:240]}
        result["id"] = qid
        sys.stdout.write(json.dumps(result, ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
