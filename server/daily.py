# -*- coding: utf-8 -*-
"""One daily pass: DAV, incremental MSC tenders/prices, and VSS for 2 days.

Runs when the local app starts, and from DAILY_UPDATE.cmd at Windows logon.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path

from . import dav, msc, vss
from .common import VN, load_secrets, load_status, save_secrets

ROOT = Path(__file__).resolve().parents[1]
TASK_NAME = "BaoAnSearcher Daily Update"
_guard = threading.Lock()
_running = False


def _today() -> str:
    return datetime.now(VN).strftime("%Y-%m-%d")


def _crawl(secrets: dict | None = None) -> dict:
    data = secrets if secrets is not None else load_secrets()
    block = data.get("autoCrawl")
    return block if isinstance(block, dict) else {}


def finished_today(block: dict | None = None, today: str | None = None) -> bool:
    block = _crawl() if block is None else block
    today = today or _today()
    daily = block.get("daily") if isinstance(block.get("daily"), dict) else {}
    return daily.get("date") == today and all(daily.get(name) == "ok" for name in ("regulatory", "dav", "msc", "vss"))


def _save_daily(step: str, state: str, message: str = "") -> None:
    secrets = load_secrets()
    block = secrets.setdefault("autoCrawl", {})
    if not isinstance(block, dict):
        block = {}
        secrets["autoCrawl"] = block
    today = _today()
    daily = block.get("daily") if isinstance(block.get("daily"), dict) else {}
    if daily.get("date") != today:
        daily = {"date": today}
    daily[step] = state
    daily["updated"] = datetime.now(VN).strftime("%Y-%m-%d %H:%M:%S")
    if message:
        daily["message"] = message
    block["daily"] = daily
    save_secrets(secrets)


def _wait(thread: threading.Thread | None, timeout: int) -> bool:
    started = time.time()
    while thread is not None and thread.is_alive() and time.time() - started < timeout:
        time.sleep(2)
    return thread is None or not thread.is_alive()


def _require_idle(section: str, finished: bool) -> None:
    status = load_status().get(section) or {}
    if not finished or status.get("state") == "error":
        raise RuntimeError(status.get("message") or f"{section.upper()} chưa xong")


def _run_dav() -> None:
    dav.start_crawl(restart=False)
    _require_idle("dav", _wait(getattr(dav, "_download_thread", None), 3 * 3600))


def _run_msc() -> None:
    if not msc.start_tender_browser(pages=200).get('ok'):
        raise RuntimeError('MSC đang có lượt tải khác; chưa bắt đầu lượt cập nhật hằng ngày.')
    _require_idle("msc", _wait(getattr(msc, "_thread", None), 7200))
    _require_idle("msc_scope", True)
    end = datetime.now(VN).date()
    start = end - timedelta(days=19)
    if not msc.start_price_sync(start.isoformat(), end.isoformat(), refresh=True, incremental=True).get('ok'):
        raise RuntimeError('MSC đang có lượt tải khác; chưa cập nhật đơn giá hằng ngày.')
    _require_idle("msc", _wait(getattr(msc, "_thread", None), 3600))


def _run_vss() -> None:
    vss.crawl_vss(days=2, loai=1, catchup=False)
    _require_idle("vss", _wait(getattr(vss, "_crawl_thread", None), 1800))
    from .metric_slice import rebuild_heat
    rebuild_heat()


def _run_regulatory(force: bool = False) -> None:
    command = ["node", str(ROOT / "scripts" / "crawl_regulatory.mjs")]
    if force:
        command.append("--force")
    result = subprocess.run(
        command, cwd=ROOT,
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=900,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    if result.returncode:
        raise RuntimeError("Không cập nhật được tin pháp luật; xem Nguồn tin & quản trị.")
    lines = result.stdout.strip().splitlines()
    report = json.loads(lines[-1]) if lines else {}
    # A skipped source can retain its previous diagnostic until its scheduled
    # interval arrives.  It must not mark the whole daily pass failed again;
    # only this run's error/partial result is actionable.
    if any(row.get("state") in ("error", "partial") for row in report.get("results", [])):
        raise RuntimeError("Một số nguồn pháp luật chưa cập nhật được; xem Nguồn tin & quản trị.")


def run_daily(force: bool = False) -> dict:
    """Run the three sources that are not already marked ok for today."""
    global _running
    if not _guard.acquire(blocking=False):
        return {"ok": False, "message": "Lượt cập nhật hôm nay đang chạy."}
    try:
        _running = True
        block = _crawl()
        if not force and not block.get("enabled"):
            return {"ok": False, "message": "Tự cập nhật đang tắt."}
        if not force and finished_today(block):
            return {"ok": True, "skipped": True, "message": "Hôm nay đã cập nhật pháp luật, DAV, MSC và VSS."}
        steps = (("regulatory", _run_regulatory), ("dav", _run_dav), ("msc", _run_msc), ("vss", _run_vss))
        failures = []
        for name, action in steps:
            current = (_crawl().get("daily") or {})
            if not force and current.get("date") == _today() and current.get(name) == "ok":
                continue
            label = name.upper()
            _save_daily(name, "running", f"Đang cập nhật {label}…")
            try:
                action()
            except Exception as exc:
                _save_daily(name, "error", f"{label}: {exc}")
                failures.append(f"{label}: {exc}")
                continue
            _save_daily(name, "ok", f"{label} xong")
        if failures:
            _save_daily("summary", "error", " | ".join(failures))
            return {"ok": False, "message": " | ".join(failures)}
        _save_daily("summary", "ok", "Đã cập nhật pháp luật, DAV, MSC và VSS.")
        return {"ok": True, "message": "Đã cập nhật pháp luật, DAV, MSC và VSS."}
    finally:
        _running = False
        _guard.release()


def start_regulatory() -> dict:
    """Crawl official legal news only. Does not touch DAV, MSC, or VSS."""
    if _running or not _guard.acquire(blocking=False):
        return {"ok": False, "message": "Lượt cập nhật hôm nay đang chạy."}
    _guard.release()

    def work():
        global _running
        if not _guard.acquire(blocking=False):
            return
        try:
            _running = True
            _save_daily("regulatory", "running", "Đang cào tin pháp luật…")
            try:
                _run_regulatory(force=True)
            except Exception as exc:
                _save_daily("regulatory", "error", f"REGULATORY: {exc}")
                return
            _save_daily("regulatory", "ok", "Đã cào tin pháp luật.")
        finally:
            _running = False
            _guard.release()

    threading.Thread(target=work, daemon=True, name="regulatory-crawl").start()
    return {"ok": True, "message": "Đã bắt đầu cào tin pháp luật."}


def start_daily(force: bool = False) -> dict:
    if _running:
        return {"ok": False, "message": "Lượt cập nhật hôm nay đang chạy."}
    threading.Thread(target=run_daily, kwargs={"force": force}, daemon=True, name="daily-update").start()
    return {"ok": True, "message": "Đã bắt đầu cập nhật pháp luật, DAV, MSC và VSS."}


def sync_logon_task(enabled: bool) -> str:
    """Register or remove the Windows logon task. Failure here does not block saving settings."""
    script = str(ROOT / "DAILY_UPDATE.cmd")
    if enabled:
        proc = subprocess.run(
            ["schtasks", "/Create", "/F", "/TN", TASK_NAME, "/SC", "ONLOGON", "/RL", "LIMITED", "/TR", script],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if proc.returncode != 0:
            detail = (proc.stderr or proc.stdout or "Không tạo được tác vụ mở máy.").strip()
            if "access is denied" in detail.lower():
                return "Tài khoản đã lưu. Windows từ chối gắn tác vụ tự chạy khi đăng nhập máy."
            return "Tài khoản đã lưu. Chưa gắn được tác vụ tự chạy: " + detail[:160]
        return "Đã gắn tác vụ Windows: tự chạy khi đăng nhập máy."
    subprocess.run(
        ["schtasks", "/Delete", "/F", "/TN", TASK_NAME],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return "Đã gỡ tác vụ khi đăng nhập."


def main() -> int:
    result = run_daily(force=False)
    print(result.get("message") or result)
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
