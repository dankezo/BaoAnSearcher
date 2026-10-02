"""Read-only, cached health checks for the production data path.

No secret or connection string is returned to the browser.  Checks happen in
one background worker so opening the administration page never blocks on an
unavailable cloud service.
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
_lock = threading.Lock()
_running = False
_checked_mono = 0.0
_cache = {"state": "idle", "checkedAt": None, "checks": {}, "production": {}}


def _load_env() -> None:
    try:
        from dotenv import load_dotenv
        load_dotenv(ROOT / ".env")
        load_dotenv(ROOT / "web" / ".env.local")
    except Exception:
        pass


def _tidb() -> dict:
    _load_env()
    tidb_path = str(ROOT / "scripts" / "tidb")
    if tidb_path not in sys.path:
        sys.path.insert(0, tidb_path)
    try:
        from connect import config_from_env, connect
        cfg = config_from_env()
        if not cfg:
            return {"state": "not_configured", "message": "Chưa có cấu hình TiDB trên máy này."}
        conn = connect(cfg)
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
            conn.rollback()
        finally:
            conn.close()
        return {"state": "ok", "message": "TiDB trả lời được."}
    except BaseException:
        return {"state": "error", "message": "Không kết nối được TiDB. Kiểm tra cấu hình hoặc mạng."}


def _supabase() -> dict:
    _load_env()
    url = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""
    if not url or not key or "YOUR_PROJECT" in url:
        return {"state": "not_configured", "message": "Chưa có SUPABASE_URL / service role key."}
    req = urllib.request.Request(url + "/auth/v1/health", headers={"apikey": key, "Authorization": "Bearer " + key})
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            code = response.status
        return {"state": "ok" if 200 <= code < 300 else "error", "message": f"Supabase phản hồi HTTP {code}."}
    except urllib.error.HTTPError as exc:
        return {"state": "error", "message": f"Supabase phản hồi HTTP {exc.code}."}
    except Exception:
        return {"state": "error", "message": "Không kết nối được Supabase. Kiểm tra cấu hình hoặc mạng."}


def _vercel() -> dict:
    _load_env()
    token = os.environ.get("VERCEL_TOKEN") or ""
    project_file = ROOT / ".vercel" / "project.json"
    if not token:
        return {"state": "not_configured", "message": "Chưa có VERCEL_TOKEN để kiểm tra deploy."}
    try:
        project = json.loads(project_file.read_text(encoding="utf-8"))
        project_id = project.get("projectId")
    except Exception:
        project_id = os.environ.get("VERCEL_PROJECT_ID") or ""
    if not project_id:
        return {"state": "not_configured", "message": "Chưa xác định Vercel project."}
    url = "https://api.vercel.com/v13/deployments?projectId=" + urllib.parse.quote(project_id) + "&limit=1"
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + token})
    try:
        with urllib.request.urlopen(req, timeout=12) as response:
            data = json.load(response)
        latest = (data.get("deployments") or [{}])[0]
        state = str(latest.get("state") or "UNKNOWN").upper()
        return {
            "state": "ok" if state == "READY" else "error",
            "message": f"Deploy gần nhất: {state}.",
            "deployment": latest.get("url") or None,
        }
    except urllib.error.HTTPError as exc:
        return {"state": "error", "message": f"Vercel phản hồi HTTP {exc.code}."}
    except Exception:
        return {"state": "error", "message": "Không kiểm tra được Vercel. Kiểm tra token hoặc mạng."}


def _probe() -> None:
    global _running, _cache, _checked_mono
    def checked(fn, label):
        try:
            return fn()
        except BaseException:
            return {"state": "error", "message": f"Không kiểm tra được {label}."}
    checks = {"tidb": checked(_tidb, "TiDB"), "supabase": checked(_supabase, "Supabase"), "vercel": checked(_vercel, "Vercel")}
    _load_env()
    backend = (os.environ.get("SEARCH_BACKEND") or "supabase").strip().lower()
    with _lock:
        _cache = {
            "state": "idle", "checkedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "checks": checks,
            "production": {
                "configuredBackend": backend,
                "message": "Cấu hình backend trên máy local là TiDB; mỗi lượt sync đều đối chiếu số lượng." if backend == "tidb" else "Máy local đang cấu hình đọc " + backend + "; đồng bộ TiDB không tự đổi backend của bản Vercel đang phục vụ.",
            },
        }
        _checked_mono = time.monotonic()
        _running = False


def status(refresh: bool = False) -> dict:
    global _running
    with _lock:
        result = dict(_cache)
        stale = not _cache.get("checkedAt") or (time.monotonic() - _checked_mono > 60)
        if (refresh or stale) and not _running:
            _running = True
            _cache["state"] = "running"
            threading.Thread(target=_probe, daemon=True, name="platform-health").start()
            result = dict(_cache)
    return result
