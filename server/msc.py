# -*- coding: utf-8 -*-
"""MSC procurement search/crawl wrappers."""
from __future__ import annotations
import json
import base64
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
        # app_metadata is rebuilt separately and can be stale after a long
        # browser crawl. This runs in the background status cache, so report
        # the actual searchable rows rather than an old snapshot.
        info["prices"] = con.execute(
            "SELECT count(*) FROM records WHERE kind='prices' "
            "AND json_extract(normalized, '$.source_label')='API Mua sắm công' "
            "AND NOT EXISTS (SELECT 1 FROM excel_matches m WHERE m.excel_id=records.source_id)"
        ).fetchone()[0]
        info["tenders"] = con.execute("SELECT count(*) FROM records WHERE kind='tenders'").fetchone()[0]
        row = con.execute(
            "SELECT max(collected_at) FROM records"
        ).fetchone()
        info["updated"] = row[0] if row else None
    return info


def _cursor_decode(value) -> tuple[str, str] | None:
    if not value:
        return None
    try:
        data = json.loads(base64.urlsafe_b64decode(str(value) + "===").decode("utf-8"))
        return str(data["sort"]), str(data["source"])
    except (ValueError, TypeError, KeyError, json.JSONDecodeError, UnicodeDecodeError):
        return None


def _cursor_encode(sort_value, source_id) -> str:
    raw = json.dumps({"sort": str(sort_value or ""), "source": str(source_id or "")}, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _sort_value(item: dict) -> str:
    """Return the same null-safe order key used by the SQL cursor query."""
    return str(item.get("published") or item.get("close_date") or item.get("_collected_at") or "")


def search(kind: str, filters: dict, page: int = 0, size: int = 50, cursor: str | None = None) -> dict:
    core = _import_core()
    if not MSC_DB.exists():
        return {"total": None, "page": page, "size": size, "hasMore": False, "items": []}
    kind = "prices" if kind == "prices" else "tenders"
    q = fold(filters.get("q") or "")
    clauses, args = ["kind=?"], [kind]
    if kind == "prices":
        clauses.append("json_extract(normalized, '$.source_label')='API Mua sắm công'")
        clauses.append("NOT EXISTS (SELECT 1 FROM excel_matches m WHERE m.excel_id=records.source_id)")
    if q:
        for w in q.split():
            clauses.append("search_text LIKE ?")
            args.append(f"%{w}%")
    # Field filters against normalized JSON
    field_map = {
        "name": "$.name", "ingredient": "$.ingredient", "registration": "$.registration",
        "manufacturer": "$.manufacturer", "province": "$.province", "tender_no": "$.tender_no",
        "buyer": "$.buyer", "winner": "$.winner", "group_name": "$.group_name",
        "dosage_form": "$.dosage_form", "medicine_type": "$.medicine_type", "country": "$.country", "route": "$.route",
    }
    for key, path in field_map.items():
        if kind == "tenders" and key in ("ingredient", "dosage_form"):
            continue
        raw = filters.get(key)
        values = raw if isinstance(raw, list) else [raw]
        values = [fold(v).strip() for v in values if str(v or "").strip()]
        if values:
            clauses.append("(" + " OR ".join("fold(coalesce(json_extract(normalized, ?),'')) LIKE ?" for _ in values) + ")")
            for val in values:
                args.extend([path, f"%{val}%"])

    published_from = filters.get("publishedFrom") or filters.get("tuNgay") or ""
    if published_from:
        y0 = str(published_from)[:10]
        clauses.append(
            "(json_extract(normalized, '$.published') IS NULL OR "
            "substr(coalesce(json_extract(normalized, '$.published'), ''), 1, 10) >= ?)"
        )
        args.append(y0)

    page = max(0, int(page))
    size = max(1, min(5000, int(size)))
    scope_filter = kind == "tenders" and any(filters.get(k) for k in ("ingredient", "dosage_form", "metricQuick"))
    cursor_value = _cursor_decode(cursor) if not scope_filter else None
    # Keep the SQL ordering and cursor key identical.  A tender without a
    # publication date is ordered by close date, then collection time.
    order_expr = "coalesce(json_extract(normalized, '$.published'), json_extract(normalized, '$.close_date'), collected_at)"
    if cursor_value:
        clauses.append(f"({order_expr} < ? OR ({order_expr} = ? AND source_id < ?))")
        args.extend([cursor_value[0], cursor_value[0], cursor_value[1]])
    where = " WHERE " + " AND ".join(clauses)
    with core.connect(MSC_DB) as con:
        # List path: normalized holds the display fields. raw stays on the row for a later detail read.
        rows = con.execute(
            "SELECT normalized, collected_at, source_id FROM records" + where +
            f" ORDER BY {order_expr} DESC, source_id DESC" + ("" if scope_filter else " LIMIT ?"),
            args if scope_filter else args + [size + 1],
        ).fetchall()
    items = []
    for norm, collected, source_id in rows:
        item = json.loads(norm)
        item["_collected_at"] = collected
        item["_cursor_source"] = source_id
        items.append(item)
    if scope_filter:
        from .msc_scope import attach, matches_scope
        from .msc_filters import matches_quick
        attach(items)
        items = [item for item in items if matches_scope(item, filters) and matches_quick(item, filters)]
        items = items[page * size:page * size + size + 1]
    has_more = len(items) > size
    if has_more:
        items = items[:size]
    if kind == "prices":
        from .sdk_forms import form_for
        for item in items:
            looked = form_for(item.get("registration"))
            if looked:
                item["dosage_form"] = looked
    else:
        from .msc_scope import attach
        if not scope_filter:
            attach(items)
    if kind == "tenders":
        from .msc_scope import present
        present(items)
    next_cursor = None
    if has_more and not scope_filter:
        last = items[-1]
        next_cursor = _cursor_encode(_sort_value(last), last.get("_cursor_source"))
    for item in items:
        item.pop("_cursor_source", None)
    return {"total": None, "page": page, "size": size, "hasMore": has_more, "nextCursor": next_cursor, "items": items}


def start_price_sync(date_from: str, date_to: str, refresh: bool = False, *, max_pages: int | None = None, full_scan: bool = False) -> dict:
    global _thread
    if _thread and _thread.is_alive():
        return {"ok": False, "message": "MSC đang chạy"}

    def work():
        try:
            previous_count = int(meta_info().get("prices") or 0)
            mode = "Quét tổng thể đơn giá (tự chia dải thời gian)…" if full_scan else (
                f"Cập nhật {max_pages} trang đơn giá mới nhất…" if max_pages else "Tải đơn giá…"
            )
            update_status("msc", state="running", progress=1, message=mode, updated=now_iso())
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
                dl = sync.Downloader(report=report, delay=2.5 if full_scan else 0.4)
                dl.run(date_from=date_from, date_to=date_to, refresh=refresh, max_pages=max_pages, full_scan=full_scan)
            elif hasattr(sync, "download"):
                sync.download(date_from, date_to, refresh=refresh, report=report)
            else:
                raise RuntimeError("Không tìm thấy sync.Downloader")
            info = meta_info()
            added = max(0, int(info["prices"]) - previous_count)
            update_status(
                "msc", state="idle", progress=100,
                message=("Hoàn tất quét tổng thể đơn giá" if full_scan else "Hoàn tất đơn giá") + f" · +{added:,} mới",
                updated=now_iso(), count=info["prices"], added=added,
            )
        except Exception as e:
            update_status("msc", state="error", message=str(e), updated=now_iso())

    _thread = threading.Thread(target=work, daemon=True)
    _thread.start()
    return {"ok": True, "message": "Đã bắt đầu quét tổng thể đơn giá MSC" if full_scan else "Đã bắt đầu tải đơn giá MSC"}


def start_price_browser(date_from: str, date_to: str, pages: int = 20, full_scan: bool = False) -> dict:
    """Run unit-price collection inside the logged-in Playwright session.

    MSC can throttle its public endpoint unpredictably.  Keeping the requests
    in the normal browser session is slower than raw HTTP but is substantially
    more reliable and never stores the browser cookies in our app.
    """
    global _thread
    if _thread and _thread.is_alive():
        return {"ok": False, "message": "MSC đang chạy"}
    pages = max(1, min(100, int(pages)))
    secrets = load_secrets()

    def work():
        done = threading.Event()
        updater = None
        try:
            previous_count = int(meta_info().get("prices") or 0)
            label = "Quét tổng thể đơn giá bằng trình duyệt…" if full_scan else f"Cập nhật {pages} trang đơn giá bằng trình duyệt…"
            update_status("msc", state="running", progress=1, message=label, updated=now_iso())
            p = str(_proc_path())
            if p not in sys.path:
                sys.path.insert(0, p)
            import browser_update

            def report(msg):
                text = str(msg)
                progress = 20
                if "/" in text:
                    progress = 45
                update_status("msc", state="running", progress=progress, message=text[:300], updated=now_iso())

            updater = browser_update.BrowserUpdater(report, done.set)
            account = secrets.get("msc") or {}
            updater.start_prices(
                date_from, date_to, pages=pages, full_scan=full_scan,
                username=account.get("username") or "", password=account.get("password") or "",
            )
            # Browser login/captcha is interactive; total scans can take hours.
            if not done.wait(timeout=8 * 3600):
                raise RuntimeError("Lượt quét đơn giá quá 8 giờ nên đã dừng an toàn. Tiến độ đã lưu; có thể bấm tải tiếp.")
            if updater.last_error:
                raise RuntimeError(updater.last_error)
            info = meta_info()
            added = max(0, int(info["prices"]) - previous_count)
            update_status(
                "msc", state="idle", progress=100,
                message=("Hoàn tất quét tổng thể đơn giá" if full_scan else "Hoàn tất cập nhật đơn giá") + f" · +{added:,} mới",
                updated=now_iso(), count=info["prices"], added=added,
            )
        except Exception as e:
            update_status("msc", state="error", message=str(e), updated=now_iso())
        finally:
            if updater:
                updater.close()

    _thread = threading.Thread(target=work, daemon=True, name="msc-price-browser")
    _thread.start()
    return {
        "ok": True,
        "message": "Đã mở quét đơn giá bằng trình duyệt. Xác nhận captcha/đăng nhập trong cửa sổ MSC nếu được hỏi.",
        "hint_user": (secrets.get("msc") or {}).get("username") or "",
    }


def start_tender_browser(pages: int = 20) -> dict:
    """Launch Playwright tender update (requires login in browser)."""
    global _thread
    if _thread and _thread.is_alive():
        return {"ok": False, "message": "MSC đang chạy"}

    secrets = load_secrets()

    def work():
        done = threading.Event()
        updater = None
        try:
            previous_tenders = int(meta_info().get("tenders") or 0)
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
            account = secrets.get("msc") or {}
            from .msc_scope import scan_open_with_page
            updater.start(
                pages=pages, resume=False, recheck=True, prices=False,
                username=account.get("username") or "",
                password=account.get("password") or "",
                after=scan_open_with_page,
            )
            # The browser worker invokes ``after`` (scope scan) before this
            # event is set, preserving the logged-in browser page for it.
            if not done.wait(timeout=7200):
                raise RuntimeError("Crawl gói thầu quá 2 giờ nên đã dừng an toàn.")
            if updater.last_error:
                raise RuntimeError(updater.last_error)
            info = meta_info()
            added = max(0, int(info["tenders"]) - previous_tenders)
            update_status(
                "msc", state="idle", progress=100,
                message=f"Hoàn tất gói thầu · +{added:,} mới · đã quét hồ sơ đang mở",
                updated=now_iso(), count=info["prices"], added=added,
            )
        except Exception as e:
            update_status("msc", state="error", message=str(e), updated=now_iso())
        finally:
            if updater:
                updater.close()

    _thread = threading.Thread(target=work, daemon=True)
    _thread.start()
    return {
        "ok": True,
        "message": "Đã mở cập nhật gói thầu (đăng nhập trên trình duyệt)",
        "hint_user": (secrets.get("msc") or {}).get("username") or "",
    }
