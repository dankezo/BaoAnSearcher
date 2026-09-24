# -*- coding: utf-8 -*-
"""MSC procurement search/crawl wrappers."""
from __future__ import annotations
import json
import sys
import threading
from pathlib import Path

from .common import MSC_DB, fold, now_iso, update_status, load_secrets

_thread = None


def _proc_path():
    return Path(__file__).resolve().parents[1] / "test zone" / "procurement"


def _import_core():
    p = str(_proc_path())
    if p not in sys.path:
        sys.path.insert(0, p)
    import core
    return core


def meta_info() -> dict:
    info = {"prices": 0, "tenders": 0, "updated": None}
    if not MSC_DB.exists():
        return info
    core = _import_core()
    with core.connect(MSC_DB) as con:
        info["prices"] = con.execute("SELECT count(*) FROM records WHERE kind='prices'").fetchone()[0]
        info["tenders"] = con.execute("SELECT count(*) FROM records WHERE kind='tenders'").fetchone()[0]
        row = con.execute(
            "SELECT max(collected_at) FROM records"
        ).fetchone()
        info["updated"] = row[0] if row else None
    return info


def search(kind: str, filters: dict, page: int = 0, size: int = 50) -> dict:
    core = _import_core()
    if not MSC_DB.exists():
        return {"total": 0, "page": page, "size": size, "items": []}
    kind = "prices" if kind == "prices" else "tenders"
    q = fold(filters.get("q") or "")
    clauses, args = ["kind=?"], [kind]
    if q:
        for w in q.split():
            clauses.append("search_text LIKE ?")
            args.append(f"%{w}%")
    # Field filters against normalized JSON
    field_map = {
        "name": "$.name", "ingredient": "$.ingredient", "registration": "$.registration",
        "manufacturer": "$.manufacturer", "province": "$.province", "tender_no": "$.tender_no",
        "buyer": "$.buyer", "winner": "$.winner", "group_name": "$.group_name",
        "medicine_type": "$.medicine_type", "country": "$.country", "route": "$.route",
    }
    for key, path in field_map.items():
        val = fold(filters.get(key) or "")
        if val:
            clauses.append("fold(coalesce(json_extract(normalized, ?),'')) LIKE ?")
            args.extend([path, f"%{val}%"])

    where = " WHERE " + " AND ".join(clauses)
    page = max(0, int(page))
    size = max(1, min(5000, int(size)))
    with core.connect(MSC_DB) as con:
        total = con.execute("SELECT count(*) FROM records" + where, args).fetchone()[0]
        rows = con.execute(
            "SELECT normalized, raw, collected_at FROM records" + where +
            " ORDER BY coalesce(json_extract(normalized, '$.published'), collected_at) DESC LIMIT ? OFFSET ?",
            args + [size, page * size],
        ).fetchall()
    items = []
    for norm, raw, collected in rows:
        item = json.loads(norm)
        item["_collected_at"] = collected
        items.append(item)
    # Stable newest-first on published / close / collected
    items.sort(
        key=lambda it: str(it.get("published") or it.get("close_date") or it.get("_collected_at") or ""),
        reverse=True,
    )
    return {"total": total, "page": page, "size": size, "items": items}


def start_price_sync(date_from: str, date_to: str, refresh: bool = False) -> dict:
    global _thread
    if _thread and _thread.is_alive():
        return {"ok": False, "message": "MSC đang chạy"}

    def work():
        try:
            update_status("msc", state="running", progress=1, message="Tải đơn giá…", updated=now_iso())
            p = str(_proc_path())
            if p not in sys.path:
                sys.path.insert(0, p)
            import sync

            def report(msg):
                # sync may call with various messages
                text = str(msg)
                pct = 10
                update_status("msc", progress=min(95, pct), message=text[:300], updated=now_iso())

            # Prefer Downloader class API if present
            if hasattr(sync, "Downloader"):
                dl = sync.Downloader(report=report)
                dl.run(date_from=date_from, date_to=date_to, refresh=refresh)
            elif hasattr(sync, "download"):
                sync.download(date_from, date_to, refresh=refresh, report=report)
            else:
                raise RuntimeError("Không tìm thấy sync.Downloader")
            info = meta_info()
            update_status(
                "msc", state="idle", progress=100, message="Hoàn tất đơn giá",
                updated=now_iso(), count=info["prices"] + info["tenders"],
            )
        except Exception as e:
            update_status("msc", state="error", message=str(e), updated=now_iso())

    _thread = threading.Thread(target=work, daemon=True)
    _thread.start()
    return {"ok": True, "message": "Đã bắt đầu tải đơn giá MSC"}


def start_tender_browser(pages: int = 20) -> dict:
    """Launch Playwright tender update (requires login in browser)."""
    global _thread
    if _thread and _thread.is_alive():
        return {"ok": False, "message": "MSC đang chạy"}

    secrets = load_secrets()

    def work():
        done = threading.Event()
        try:
            update_status("msc", state="running", progress=1, message="Mở trình duyệt đăng nhập MSC…", updated=now_iso())
            p = str(_proc_path())
            if p not in sys.path:
                sys.path.insert(0, p)
            import browser_update

            def report(msg):
                update_status("msc", message=str(msg)[:300], updated=now_iso(), progress=20)

            def finished():
                done.set()

            updater = browser_update.BrowserUpdater(report, finished)
            updater.start(pages=pages, resume=False, recheck=True, prices=False)
            # Wait up to 2h for interactive login + crawl
            done.wait(timeout=7200)
            updater.close()
            info = meta_info()
            update_status(
                "msc", state="idle", progress=100, message="Hoàn tất gói thầu",
                updated=now_iso(), count=info["prices"] + info["tenders"],
            )
        except Exception as e:
            update_status("msc", state="error", message=str(e), updated=now_iso())

    _thread = threading.Thread(target=work, daemon=True)
    _thread.start()
    return {
        "ok": True,
        "message": "Đã mở cập nhật gói thầu (đăng nhập trên trình duyệt)",
        "hint_user": (secrets.get("msc") or {}).get("username") or "",
    }
