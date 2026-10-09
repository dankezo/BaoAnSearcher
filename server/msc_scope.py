# -*- coding: utf-8 -*-
"""Cache Bảo An matches for open MSC tenders.

One public get-detail call per notify id, refreshed after a change or 24 hours.
The drug list is lotDTOList (bảng phạm vi cung cấp), the same fields as the
webform download, without logging in or downloading every template.
"""
from __future__ import annotations

import json
import re
import ssl
import sys
import threading
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

from .baoan_match import match_lots
from .common import MSC_DB, DATA_DIR, now_iso, update_status, fold, load_secrets

_URL = "https://muasamcong.mpi.gov.vn/api/unau/portal/ebidorg/bid-no-contractor/get-detail"
_NOTIFY = re.compile(r"notifyId=([0-9a-f-]{36})", re.I)
_lock = threading.Lock()
_thread: threading.Thread | None = None

_DDL = """
CREATE TABLE IF NOT EXISTS scope_match (
    notify_id TEXT PRIMARY KEY,
    tender_no TEXT,
    match TEXT NOT NULL,
    fetched_at TEXT NOT NULL
)
"""


def notify_id(item: dict) -> str:
    url = str(item.get("source_url") or "")
    found = _NOTIFY.search(url)
    if found:
        return found.group(1)
    raw = str(item.get("source_id") or item.get("id") or "")
    if re.fullmatch(r"[0-9a-f-]{36}", raw, re.I):
        return raw
    return ""


def _connect():
    import sqlite3
    con = sqlite3.connect(MSC_DB, timeout=60)
    con.execute(_DDL)
    con.execute("CREATE TABLE IF NOT EXISTS scope_lots (notify_id TEXT PRIMARY KEY, lots TEXT NOT NULL, fetched_at TEXT NOT NULL)")
    return con


def load_cache() -> dict[str, str]:
    """notify id and tender number → current exact|near|none.

    The persisted ``scope_match.match`` is a crawl-time snapshot.  Recompute
    from cached lots so a later catalogue correction cannot leave a package
    green while every displayed line is only a near match.
    """
    if not MSC_DB.exists():
        return {}
    con = _connect()
    try:
        out = {}
        for nid, tender_no, raw_lots in con.execute("SELECT m.notify_id, m.tender_no, l.lots FROM scope_match m JOIN scope_lots l ON l.notify_id=m.notify_id"):
            try:
                level = match_lots(json.loads(raw_lots))
            except (TypeError, ValueError, json.JSONDecodeError):
                level = ""
            if nid:
                out[f"id:{nid}"] = level
            if tender_no:
                out[f"no:{tender_no}"] = level
        return out
    finally:
        con.close()


def attach(items: list[dict]) -> list[dict]:
    cache = load_cache()
    if not MSC_DB.exists():
        return items
    con = _connect()
    try:
        lots_by_id = {nid: json.loads(raw) for nid, raw in con.execute("SELECT notify_id, lots FROM scope_lots")}
    finally:
        con.close()
    for item in items:
        nid = notify_id(item)
        level = cache.get(f"id:{nid}") or cache.get(f"no:{item.get('tender_no')}") or ""
        item["baoan_match"] = level
        lots = lots_by_id.get(nid, [])
        item["scope_lots"] = lots
        item["ingredient"] = "; ".join(dict.fromkeys(str(lot.get("tenHoatChat") or lot.get("lotName") or "") for lot in lots))
        item["dosage_form"] = "; ".join(dict.fromkeys(str(lot.get("dangBaoChe") or "") for lot in lots))
    return items


def present(items: list[dict]) -> list[dict]:
    """Replace raw lots with the popup table. Keep scope_lots off the wire."""
    from .baoan_match import public_lines
    for item in items:
        if item.get("scope_lots"):
            item["scope_lines"] = public_lines(item.get("scope_lots") or [])
        item.pop("scope_lots", None)
    return items


def matches_scope(item: dict, filters: dict) -> bool:
    """Both filters must match the same drug line, not two unrelated lots."""
    ingredient = fold(filters.get("ingredient") or "").strip()
    form = fold(filters.get("dosage_form") or "").strip()
    if not ingredient and not form:
        return True
    return any(
        all(word in fold(lot.get("tenHoatChat") or lot.get("lotName") or "") for word in ingredient.split())
        and all(word in fold(lot.get("dangBaoChe") or "") for word in form.split())
        for lot in item.get("scope_lots", [])
    )


def _open(item: dict, now: datetime) -> bool:
    code = str(item.get("status_code") or "").strip().upper()
    if code:
        return False
    close = str(item.get("close_date") or "").strip()
    if not close:
        return True
    try:
        stamp = datetime.fromisoformat(close[:19])
    except ValueError:
        return True
    return stamp >= now.replace(tzinfo=None)


def _lots_in(data, depth: int = 0) -> list[dict]:
    """Find a medicine-lot list anywhere in a detail payload."""
    if depth > 8:
        return []
    if isinstance(data, dict):
        for key in ("lotDTOList", "lotList", "listLot"):
            value = data.get(key)
            if isinstance(value, list) and value and isinstance(value[0], dict):
                return value
        for value in data.values():
            found = _lots_in(value, depth + 1)
            if found:
                return found
    elif isinstance(data, list) and data and isinstance(data[0], dict):
        sample = data[0]
        if any(key in sample for key in ("lotNo", "medicineCode", "dangBaoChe", "tenHoatChat")):
            return data
    return []


def _fetch_lots(nid: str) -> list[dict]:
    payload = json.dumps({"body": {"id": nid}}).encode("utf-8")
    req = urllib.request.Request(
        _URL,
        data=payload,
        headers={"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "BaoAnSearcher"},
        method="POST",
    )
    # MSC currently requires legacy DH parameters. Certificate and hostname
    # verification remain enabled; limit this compatibility context to MSC.
    context = ssl.create_default_context()
    context.set_ciphers("DEFAULT:@SECLEVEL=1")
    with urllib.request.urlopen(req, timeout=25, context=context) as res:
        data = json.loads(res.read().decode("utf-8", "replace"))
    return _lots_in(data)


class _ScopeBrowser:
    """Visible Edge/Chrome. Login stays in the browser; this process does not store the session."""

    def __init__(self):
        self.runtime = None
        self.browser = None
        self.page = None

    def open(self, report, username: str = "", password: str = "") -> None:
        proc = Path(__file__).resolve().parents[1] / "test zone" / "procurement"
        if str(proc) not in sys.path:
            sys.path.insert(0, str(proc))
        from browser_update import BASE, browser_channel, fill_msc_login, _login_fields, refill_msc_login_if_blank
        from playwright.sync_api import sync_playwright

        self.runtime = sync_playwright().start()
        for channel in browser_channel():
            try:
                self.browser = self.runtime.chromium.launch(channel=channel, headless=False)
                break
            except Exception:
                continue
        if not self.browser:
            raise RuntimeError("Không mở được Edge hoặc Chrome. Hãy cài một trong hai trình duyệt rồi quét lại.")
        context = self.browser.new_context(no_viewport=True, locale="vi-VN")
        self.page = context.new_page()
        self.page.goto(BASE + "/web/guest/contractor-selection", wait_until="domcontentloaded", timeout=60000)
        self.page.wait_for_timeout(1500)
        signed = self.page.evaluate("Boolean(window.Liferay?.ThemeDisplay?.isSignedIn())")
        if not signed:
            report("Đăng nhập trong cửa sổ trình duyệt vừa mở. App sẽ tự điền tài khoản đã lưu.")
            user, pwd = _login_fields(self.page)
            if user is None and pwd is None:
                self.page.goto(BASE + "/c/portal/login", wait_until="domcontentloaded", timeout=60000)
            fill_msc_login(self.page, username, password, report)
            for _ in range(1800):
                if self.page.is_closed():
                    raise RuntimeError("Trình duyệt đã đóng. Bấm quét lại để mở đăng nhập.")
                try:
                    if self.page.evaluate("Boolean(window.Liferay?.ThemeDisplay?.isSignedIn())"):
                        break
                except Exception:
                    pass
                refill_msc_login_if_blank(self.page, username, password)
                self.page.wait_for_timeout(1000)
            else:
                raise RuntimeError("Hết thời gian chờ đăng nhập MSC. Bấm quét lại khi sẵn sàng.")
        report("Đã có phiên đăng nhập. Đang tải danh mục các hồ sơ còn thiếu.")

    def fetch(self, nid: str, source_url: str = "") -> list[dict]:
        if not self.page or self.page.is_closed():
            raise RuntimeError("Trình duyệt đã đóng. Bấm quét lại để mở đăng nhập.")
        return fetch_lots_on_page(self.page, nid, source_url)

    def close(self) -> None:
        try:
            if self.browser:
                self.browser.close()
            if self.runtime:
                self.runtime.stop()
        except Exception:
            pass
        self.browser = self.runtime = self.page = None


def fetch_lots_on_page(page, nid: str, source_url: str = "") -> list[dict]:
    """Read one drug list through a browser that is already signed in."""
    if not page or page.is_closed():
        raise RuntimeError("Trình duyệt đã đóng.")
    data = page.evaluate(
        """async (nid) => {
            const res = await fetch('/api/unau/portal/ebidorg/bid-no-contractor/get-detail', {
                method: 'POST',
                credentials: 'include',
                headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
                body: JSON.stringify({body: {id: nid}})
            })
            if (!res.ok) return null
            return await res.json()
        }""",
        nid,
    )
    lots = _lots_in(data)
    if lots or not str(source_url).startswith("https://muasamcong.mpi.gov.vn/"):
        return lots
    found: list[dict] = []

    def grab(response):
        if found or response.status != 200:
            return
        if "json" not in (response.headers.get("content-type") or "").lower():
            return
        try:
            payload = response.json()
        except Exception:
            return
        rows = _lots_in(payload)
        if rows:
            found.extend(rows)

    page.on("response", grab)
    try:
        page.goto(source_url, wait_until="domcontentloaded", timeout=60000)
        for _ in range(24):
            if found:
                break
            page.wait_for_timeout(500)
    finally:
        page.remove_listener("response", grab)
    return found


def _save_scope(con, nid, tender_no, fetch=None, source_url: str = ""):
    lots = fetch(nid, source_url) if fetch else _fetch_lots(nid)
    if not lots:
        raise ValueError("Chưa lấy được danh mục thuốc; cần kiểm tra hồ sơ trên trang nguồn")
    level = match_lots(lots)
    stamp = now_iso()
    raw = json.dumps(lots, ensure_ascii=False)
    # Keep a source snapshot on disk as well as the searchable cache.
    folder = DATA_DIR / "msc_scope"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{nid}.json").write_text(json.dumps({"tender_no": tender_no, "fetched_at": stamp, "lots": lots}, ensure_ascii=False, indent=2), encoding="utf-8")
    con.execute("INSERT OR REPLACE INTO scope_lots VALUES (?,?,?)", (nid, raw, stamp))
    con.execute("INSERT OR REPLACE INTO scope_match VALUES (?,?,?,?)", (nid, tender_no, level, stamp))
    con.commit()
    return level


def enrich_page(items: list[dict], limit: int = 8) -> None:
    """Do not block table requests on remote downloads; admin runs the scan."""
    return


def _scope_message(result: dict) -> str:
    message = f"Đã tải {result.get('fetched', 0)}/{result.get('pending', 0)} hồ sơ · {result.get('exact', 0)} khớp · {result.get('near', 0)} gần khớp · {result.get('failed', 0)} chưa tải được"
    errors = result.get("errors") or []
    if errors:
        message += " · " + errors[0]["message"]
    return message


def _merge_scope(first: dict, second: dict) -> dict:
    return {
        "ok": second.get("ok"),
        "fetched": first.get("fetched", 0) + second.get("fetched", 0),
        "pending": first.get("pending", 0),
        "exact": first.get("exact", 0) + second.get("exact", 0),
        "near": first.get("near", 0) + second.get("near", 0),
        "failed": second.get("failed", 0),
        "errors": second.get("errors") or [],
    }


def refresh(limit: int | None = 40, force: bool = False, report=None, fetch=None, stop=None) -> dict:
    if not MSC_DB.exists():
        return {"ok": False, "fetched": 0, "message": "Chưa có dữ liệu MSC"}
    now = datetime.now()
    con = _connect()
    try:
        known = {row[0]: row[1] for row in con.execute("SELECT notify_id,fetched_at FROM scope_lots")}
        pending = []
        seen = set()
        sources = {}
        for (norm,) in con.execute("SELECT normalized FROM records WHERE kind='tenders' ORDER BY collected_at DESC"):
            item = json.loads(norm)
            nid = notify_id(item)
            if not _open(item, now) or not nid or nid in seen:
                continue
            if nid in known and not force:
                try:
                    fetched = datetime.fromisoformat(known[nid]).astimezone().replace(tzinfo=None)
                    changed = datetime.fromisoformat(item['collected_at']).astimezone().replace(tzinfo=None)
                    if fetched > now - timedelta(hours=24) and changed <= fetched:
                        continue
                except (KeyError, TypeError, ValueError):
                    pass
            seen.add(nid)
            sources[nid] = item.get("source_url") or ""
            pending.append((nid, str(item.get("tender_no") or "")))
            if limit and len(pending) >= limit:
                break
        fetched = exact = near = failed = 0
        errors = []
        for index, (nid, tender_no) in enumerate(pending):
            if stop is not None and stop.is_set():
                break
            if report:
                report(index, len(pending), tender_no)
            try:
                level = _save_scope(con, nid, tender_no, fetch=fetch, source_url=sources[nid])
            except Exception as exc:
                failed += 1
                errors.append({"tender_no": tender_no, "source_url": sources[nid], "message": str(exc)[:200]})
                continue
            fetched += 1
            exact += int(level == "exact")
            near += int(level == "near")
        return {"ok": failed == 0, "fetched": fetched, "pending": len(pending), "exact": exact, "near": near, "failed": failed, "errors": errors}
    finally:
        con.close()


def refresh_with_page(page, report=None, stop=None, limit: int | None = None) -> dict:
    """Finish open-package lists on the browser that just crawled tenders."""
    first = refresh(limit=limit, force=False, report=report, stop=stop)
    if not first.get("failed") or (stop is not None and stop.is_set()):
        return first

    def fetch(nid, source_url=""):
        if stop is not None and stop.is_set():
            raise RuntimeError("Đã dừng")
        return fetch_lots_on_page(page, nid, source_url)

    second = refresh(limit=limit, force=False, report=report, fetch=fetch, stop=stop)
    return _merge_scope(first, second)


def scan_open_with_page(page, report, stop) -> None:
    update_status("msc_scope", state="running", progress=1, message="Đang tải hồ sơ gói đang mở trong phiên đăng nhập vừa rồi", updated=now_iso())

    def scope_report(index, total, tender_no):
        message = f"Hồ sơ đang mở {index + 1}/{max(total, 1)} · {tender_no}"
        update_status("msc_scope", state="running", progress=max(1, round(index / max(total, 1) * 100)), message=message, updated=now_iso())
        report(message)

    try:
        result = refresh_with_page(page, report=scope_report, stop=stop, limit=None)
    except Exception as exc:
        text = str(exc).strip()
        if not isinstance(exc, (ValueError, RuntimeError)) or len(text) > 240:
            text = "Chưa tải được hồ sơ gói đang mở trong phiên này."
        update_status("msc_scope", state="error", progress=100, message=text, updated=now_iso())
        report(text)
        return
    message = _scope_message(result)
    update_status(
        "msc_scope",
        state="idle" if result.get("ok") else "error",
        progress=100,
        message=message,
        count=result.get("fetched", 0),
        errors=result.get("errors") or [],
        updated=now_iso(),
    )
    report(message)


def refresh_async(limit: int | None = 40, force: bool = False) -> dict:
    global _thread
    with _lock:
        if _thread and _thread.is_alive():
            return {"ok": False, "message": "Đang quét hồ sơ gói mở thầu"}
        from . import msc
        if getattr(msc, "_thread", None) and msc._thread.is_alive():
            return {"ok": False, "message": "Hồ sơ gói đang mở sẽ được quét trong phiên đăng nhập của crawl gói thầu."}
        if not MSC_DB.exists():
            return {"ok": False, "message": "Chưa có dữ liệu MSC"}
        update_status("msc_scope", state="running", progress=1, message="Chuẩn bị tải danh mục gói đang mở", updated=now_iso())
        def work():
            browser = None
            try:
                def report(index, total, tender_no):
                    update_status("msc_scope", state="running", progress=max(1, round(index / max(total, 1) * 100)), message=f"{index}/{total} · Đang tải {tender_no}", updated=now_iso())
                result = refresh(limit=limit, force=force, report=report)
                if result.get("failed"):
                    first = result
                    update_status("msc_scope", state="running", message="Có hồ sơ chưa có danh mục công khai. Mở trình duyệt để đăng nhập MSC…", updated=now_iso())
                    browser = _ScopeBrowser()
                    account = (load_secrets().get("msc") or {})
                    browser.open(
                        lambda text: update_status("msc_scope", state="running", message=str(text)[:300], updated=now_iso()),
                        username=account.get("username") or "",
                        password=account.get("password") or "",
                    )
                    second = refresh(limit=limit, force=False, report=report, fetch=browser.fetch)
                    result = _merge_scope(first, second)
                message = _scope_message(result)
                update_status("msc_scope", state="idle" if result["ok"] else "error", progress=100, message=message, count=result["fetched"], errors=result["errors"], updated=now_iso())
            except Exception as exc:
                text = str(exc).strip()
                if not isinstance(exc, (ValueError, RuntimeError)) or len(text) > 240:
                    text = "Chưa đăng nhập được MSC. Kiểm tra cửa sổ trình duyệt rồi quét lại."
                update_status("msc_scope", state="error", progress=100, message=text, updated=now_iso())
            finally:
                if browser:
                    browser.close()
        _thread = threading.Thread(target=work, daemon=True)
        _thread.start()
        return {"ok": True, "message": "Đã bắt đầu quét danh mục gói đang mở"}
