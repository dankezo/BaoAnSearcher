# -*- coding: utf-8 -*-
"""BaoAn Searcher API."""
from __future__ import annotations
import json
import threading
import time
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import dav, msc, platform_status, stored_metrics, vss
from .common import (
    load_secrets, save_secrets, load_status, update_status, now_iso, DM93_PATH, DATA_DIR,
)

app = FastAPI(title="BaoAn Searcher", version="1.0.0")
from . import cloud_jobs


@app.get('/api/cloud-crawl/status')
def cloud_crawl_status():
    return cloud_jobs.status()


class CloudCrawlBody(BaseModel):
    action: str


@app.post('/api/cloud-crawl/control')
def cloud_crawl_control(body: CloudCrawlBody):
    try:
        return cloud_jobs.control(body.action)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except (RuntimeError, OSError):
        raise HTTPException(503, 'Chưa điều khiển được lịch cloud. Kiểm tra GitHub CLI và workflow.')


@app.post('/api/cloud-crawl/pull')
def cloud_crawl_pull():
    if any(value.get('state') == 'running' for value in load_status().values() if isinstance(value, dict)) or _tidb_sync_lock.locked():
        return {'ok': False, 'message': 'Đợi crawl / đồng bộ local xong trước khi tải dữ liệu online.'}
    return cloud_jobs.pull()

from .regulatory_proxy import router as regulatory_router
from .gemini_proxy import router as gemini_router
app.include_router(regulatory_router)
app.include_router(gemini_router)
from .analytics import router as analytics_router
app.include_router(analytics_router)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def warm_local_portfolio() -> None:
    from .portfolio import warm_portfolio
    threading.Thread(target=warm_portfolio, daemon=True, name="portfolio-warmup").start()
    # Populate the four lightweight Data Hub snapshots in the background.
    # The dashboard itself only reads the cache/status file and never starts a
    # catalog COUNT(*) on the user request.
    _queue_meta_refresh("dav", dav.meta_info)
    _queue_meta_refresh("msc", msc.meta_info)
    _queue_meta_refresh("vss", vss.meta_info)

# Status must remain fast while a crawler writes multi-gigabyte SQLite WAL
# files. Metadata is refreshed only while sources are idle, then reused.
_STATUS_META_CACHE: dict[str, tuple[float, dict]] = {}
_STATUS_META_LOCK = threading.Lock()
_STATUS_META_INFLIGHT: set[str] = set()


def _queue_meta_refresh(name: str, getter) -> dict:
    """Return cached metadata immediately; refresh it in a daemon worker.

    Status polling must never synchronously open a multi-GB SQLite/WAL file.
    An occasional stale count is preferable to freezing the control panel.
    """
    now = time.monotonic()
    with _STATUS_META_LOCK:
        cached = _STATUS_META_CACHE.get(name)
        fresh = cached and now - cached[0] < 12
        if fresh or name in _STATUS_META_INFLIGHT:
            return cached[1] if cached else {}
        _STATUS_META_INFLIGHT.add(name)

    def work():
        try:
            value = getter()
        except Exception as exc:
            value = {"error": str(exc)}
        with _STATUS_META_LOCK:
            _STATUS_META_CACHE[name] = (time.monotonic(), value)
            _STATUS_META_INFLIGHT.discard(name)

    threading.Thread(target=work, daemon=True, name=f"status-meta-{name}").start()
    return cached[1] if cached else {}


class SecretsBody(BaseModel):
    msc: Optional[dict] = None
    vss: Optional[dict] = None
    autoCrawl: Optional[dict] = None


class CrawlBody(BaseModel):
    restart: bool = False
    dateFrom: Optional[str] = None
    dateTo: Optional[str] = None
    pages: int = 200
    days: int = 2
    loai: int = 1
    excelPath: Optional[str] = None
    refresh: bool = False
    catchup: bool = False
    saveJson: bool = False
    fullScan: bool = False
    maxPages: Optional[int] = None


@app.get("/api/health")
def health():
    return {"ok": True, "mode": "local", "time": now_iso()}


@app.get("/api/admin/datasets")
def local_data_registry():
    """Local Data Hub: four cached metadata snapshots, never table counts."""
    state = load_status()

    def item(code, name, description, section, count_key="count", *, meta_only=False):
        current = state.get(section) or {}
        persisted_meta = current.get("meta") if isinstance(current.get("meta"), dict) else {}
        # ``/api/status`` does not write its refreshed metadata to disk: that
        # is deliberate so polling cannot contend with crawls.  Reuse its
        # in-process snapshot when available, including the separate tender
        # count which has no standalone crawler state.
        with _STATUS_META_LOCK:
            cached = _STATUS_META_CACHE.get(section)
        live_meta = cached[1] if cached else {}
        meta = {**persisted_meta, **live_meta}
        # MSC stores the unit-price total in ``count`` and tender total in
        # ``meta.tenders``.  Never accidentally display the price count on the
        # tender card just because both belong to the same crawler state.
        count = meta.get(count_key) if meta_only else current.get("count")
        if count is None:
            count = meta.get(count_key, 0)
        return {
            "code": code,
            "name": name,
            "description": description,
            "totalRecords": int(count or 0),
            "status": "syncing" if current.get("state") == "running" else ("warning" if current.get("state") == "error" else "healthy"),
            "lastSyncedAt": current.get("updated") or meta.get("updated"),
            "r2DownloadUrl": None,
            "fileSizeMb": None,
        }

    return {"datasets": [
        item("DAV", "DAV", "Danh mục thuốc Cục Quản lý Dược", "dav"),
        item("MSC_PRICE", "MSC Đơn giá", "Đơn giá trúng thầu thuốc", "msc", "prices"),
        item("MSC_BID", "MSC Gói thầu", "Kế hoạch và thông báo mời thầu", "msc", "tenders", meta_only=True),
        item("VSS", "VSS", "Danh mục thuốc BHYT", "vss"),
    ]}


@app.get("/api/status")
def status():
    # Read-only by design: polling this endpoint must never compete with a
    # crawler's progress write or a SQLite writer lock.
    st = load_status()
    dav_state = st.setdefault("dav", {})
    msc_state = st.setdefault("msc", {})
    vss_state = st.setdefault("vss", {})
    dav_meta = _queue_meta_refresh("dav", dav.meta_info)
    msc_meta = _queue_meta_refresh("msc", msc.meta_info)
    vss_meta = _queue_meta_refresh("vss", vss.meta_info)
    for section, meta in ((dav_state, dav_meta), (msc_state, msc_meta), (vss_state, vss_meta)):
        if meta.get("error"):
            section["metaError"] = meta["error"]
            continue
        section["meta"] = meta
    if not dav_meta.get("error"):
        dav_state["count"] = dav_meta.get("count", dav_state.get("count", 0))
    if not msc_meta.get("error"):
        # Keep the primary MSC count strictly to unit prices. Tender records
        # remain available separately as ``meta.tenders``.
        msc_state["count"] = msc_meta.get("prices", 0)
    if not vss_meta.get("error"):
        vss_state["count"] = vss_meta.get("count", vss_state.get("count", 0))
    return st


@app.get("/api/secrets")
def get_secrets(revealPassword: bool = False):
    s = load_secrets()
    # The local administration screen may explicitly request a reveal. This API
    # is only served by the local crawler, never by the public Cloud build.
    out = json.loads(json.dumps(s))
    for key in ("msc", "vss"):
        if key in out and isinstance(out[key], dict) and out[key].get("password") and not revealPassword:
            out[key] = {**out[key], "password": "********", "hasPassword": True}
    return out


@app.post("/api/secrets")
def post_secrets(body: SecretsBody):
    current = load_secrets()
    data = body.model_dump(exclude_none=True)
    for key in ("msc", "vss"):
        if key in data and isinstance(data[key], dict):
            prev = current.get(key) or {}
            merged = {**prev, **data[key]}
            if merged.get("password") == "********":
                merged["password"] = prev.get("password", "")
            current[key] = merged
    task_note = ""
    if "autoCrawl" in data:
        prev = current.get("autoCrawl") if isinstance(current.get("autoCrawl"), dict) else {}
        incoming = data["autoCrawl"] if isinstance(data["autoCrawl"], dict) else {}
        merged = {**prev, **incoming}
        if "daily" not in incoming and prev.get("daily"):
            merged["daily"] = prev["daily"]
        current["autoCrawl"] = merged
        from .daily import sync_logon_task
        task_note = sync_logon_task(bool(merged.get("enabled")))
    save_secrets(current)
    return {"ok": True, "task": task_note}


@app.get("/api/baoan-catalog")
def baoan_catalog():
    path = DATA_DIR / "baoan_products.json"
    if not path.exists():
        raise HTTPException(404, "Chưa có danh mục Bảo An")
    items = []
    for item in json.loads(path.read_text(encoding="utf-8")):
        items.append({
            "id": item.get("id"),
            "brand": item.get("brand_name") or "",
            "inn": item.get("inn") or "",
            "strength": item.get("strength") or "",
            "form": item.get("dosage_form") or "",
            "route": item.get("route") or "",
            "reg": item.get("reg_number") or "",
            "manufacturer": item.get("manufacturer") or "",
        })
    return {"items": items}


@app.get("/api/baoan-portfolio")
def baoan_portfolio(id: Optional[int] = None, registration: Optional[str] = None):
    from .portfolio import build_portfolio
    try:
        return build_portfolio(id, registration)
    except KeyError:
        raise HTTPException(404, "Không có SKU này trong danh mục Bảo An")


@app.get("/api/dm93")
def dm93():
    return json.loads(DM93_PATH.read_text(encoding="utf-8"))


@app.get("/api/metrics")
def metrics(section: str = "vss"):
    payload = stored_metrics.read_metrics(section)
    if not payload:
        raise HTTPException(404, "Chưa có chỉ số. Chạy làm mới dữ liệu trước.")
    return payload


@app.post("/api/metrics/slice")
def metrics_slice(body: dict[str, Any]):
    """One small aggregate for the current filters. Does not page source rows."""
    from .metric_slice import slice_payload
    try:
        return slice_payload(body or {})
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/metrics/map")
def metrics_map(body: dict[str, Any]):
    """Province, region, and investor dots for the map. No raw row pages."""
    from .map_view import map_payload
    try:
        return map_payload(body or {})
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/metrics/map/facility-ingredients")
def metrics_map_facility_ingredients(body: dict[str, Any]):
    """Lazy VSS facility details; keeps the first map response lightweight."""
    from .map_view import vss_facility_ingredients
    try:
        return vss_facility_ingredients(body or {})
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/msc/scope/refresh")
def msc_scope_refresh():
    from .msc_scope import refresh_async
    refresh_async(80)
    return {"ok": True, "message": "Đang đối chiếu gói đang mời thầu với danh mục Bảo An"}


@app.get("/api/suggest")
def suggest(section: str = "vss", field: str = "ten", q: str = ""):
    return {"items": stored_metrics.suggest(section, field, q)}


@app.post("/api/daily/run")
def daily_run():
    from .daily import start_daily
    return start_daily(force=True)


@app.post("/api/regulatory/crawl")
def regulatory_crawl():
    from .daily import start_regulatory
    return start_regulatory()


@app.post("/api/dav/search")
def dav_search(body: dict[str, Any]):
    filters = body.get("filters") or body
    page = int(body.get("page") or 0)
    size = int(body.get("size") or 50)
    try:
        return dav.search_drugs(filters, page=page, size=size)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/dav/validity/rebuild")
def dav_validity_rebuild():
    def cb(pct, msg):
        update_status("dav", progress=pct, message=msg, state="running", updated=now_iso())

    try:
        found = dav.build_validity_set(progress_cb=cb)
        update_status("dav", state="idle", progress=100, message=f"Hiệu lực: {len(found):,} SĐK", updated=now_iso())
        return {"ok": True, "count": len(found)}
    except Exception as e:
        update_status("dav", state="error", message=str(e))
        raise HTTPException(500, str(e))


@app.post("/api/dav/crawl")
def dav_crawl(body: CrawlBody):
    return dav.start_crawl(restart=body.restart)


@app.post("/api/dav/crawl/stop")
def dav_crawl_stop():
    return dav.stop_crawl()


@app.post("/api/msc/match-report")
def msc_match_report(body: dict[str, Any]):
    from .match_report import match_report
    try:
        return {"rows": match_report((body or {}).get("filters") or {}, str((body or {}).get("level") or "all"))}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/msc/search")
def msc_search(body: dict[str, Any]):
    kind = body.get("kind") or "prices"
    filters = body.get("filters") or {}
    page = int(body.get("page") or 0)
    size = int(body.get("size") or 50)
    try:
        return msc.search(kind, filters, page=page, size=size, cursor=body.get("cursor"))
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/msc/crawl/scope")
def msc_crawl_scope(body: dict[str, Any]):
    from .msc_scope import refresh_async
    return refresh_async(limit=None, force=bool(body.get("refresh")))


@app.post("/api/msc/crawl/prices")
def msc_crawl_prices(body: CrawlBody):
    if not body.dateFrom or not body.dateTo:
        raise HTTPException(400, "Cần dateFrom và dateTo (YYYY-MM-DD)")
    max_pages = body.maxPages
    if max_pages is not None:
        max_pages = max(1, min(100, int(max_pages)))
    return msc.start_price_sync(
        body.dateFrom, body.dateTo, refresh=body.refresh,
        max_pages=max_pages, full_scan=bool(body.fullScan),
    )


@app.post("/api/msc/crawl/prices/browser")
def msc_crawl_prices_browser(body: CrawlBody):
    if not body.dateFrom or not body.dateTo:
        raise HTTPException(400, "Cần dateFrom và dateTo (YYYY-MM-DD)")
    pages = body.maxPages if body.maxPages is not None else body.pages
    return msc.start_price_browser(
        body.dateFrom, body.dateTo, pages=pages or 20, full_scan=bool(body.fullScan),
    )


@app.post("/api/msc/crawl/tenders")
def msc_crawl_tenders(body: CrawlBody):
    return msc.start_tender_browser(pages=body.pages)


@app.post("/api/vss/search")
def vss_search(body: dict[str, Any]):
    filters = body.get("filters") or body
    page = int(body.get("page") or 0)
    size = int(body.get("size") or 50)
    return vss.search_bids(filters, page=page, size=size, cursor=body.get("cursor"))


@app.post("/api/vss/crawl")
def vss_crawl(body: CrawlBody):
    days = body.days
    if body.catchup and (not days or days < 30):
        days = 90
    return vss.crawl_vss(
        days=days,
        loai=body.loai,
        catchup=body.catchup,
        from_date=body.dateFrom,
        to_date=body.dateTo,
        save_json=body.saveJson,
    )


@app.post("/api/vss/crawl/stop")
def vss_crawl_stop():
    return vss.stop_crawl()


@app.post("/api/vss/import")
def vss_import(body: CrawlBody):
    path = body.excelPath
    if not path:
        # default desktop path if exists
        candidates = [
            Path(r"c:\Users\AD\Desktop\MouseWithoutBorders\Danh mục thuốc trúng thầu BHYT-2024.xls"),
            Path(__file__).resolve().parents[1] / "data" / "raw" / "bhyt.xls",
        ]
        path = next((str(p) for p in candidates if p.exists()), None)
    if not path or not Path(path).exists():
        raise HTTPException(400, "Không tìm thấy file Excel. Truyền excelPath.")
    try:
        return vss.import_spreadsheet_ml(path)
    except Exception as e:
        raise HTTPException(500, str(e))


class SyncBody(BaseModel):
    only: Optional[str] = "vss,dav,msc"


class ProductionSyncBody(BaseModel):
    only: Optional[str] = "vss,dav,prices,tenders,rollup,suggest"
    fromStart: bool = False


_sync_lock = threading.Lock()
_sync_state = {"state": "idle", "message": "", "ok": True}
_tidb_sync_lock = threading.Lock()
_tidb_sync_state = {"state": "idle", "phase": "", "message": "", "ok": True, "verified": False}


@app.get("/api/platform/status")
def platform_health(refresh: bool = False):
    return platform_status.status(refresh=refresh)


@app.get("/api/production/sync/status")
def production_sync_status():
    return dict(_tidb_sync_state)


@app.post("/api/production/sync")
def production_sync(body: ProductionSyncBody):
    """Upsert to TiDB, then compare TiDB counts with local sources.

    Completion is only reported after the independent verify step succeeds.
    Supabase remains a separate optional mirror, not the production sync target.
    """
    import os
    import subprocess
    import sys
    try:
        from dotenv import load_dotenv
        root = Path(__file__).resolve().parents[1]
        load_dotenv(root / ".env")
    except Exception:
        root = Path(__file__).resolve().parents[1]
    if not (os.environ.get("TIDB_DATABASE_URL") or (os.environ.get("TIDB_HOST") and os.environ.get("TIDB_USER") and os.environ.get("TIDB_DATABASE"))):
        raise HTTPException(400, "Chưa có cấu hình TiDB trong .env. Thêm TIDB_DATABASE_URL hoặc TIDB_HOST/TIDB_USER/TIDB_DATABASE trước.")
    if load_status().get("msc", {}).get("state") == "running":
        return {"ok": False, "message": "MSC đang ghi dữ liệu. Đợi crawl xong rồi mới đồng bộ TiDB để đối chiếu chính xác."}
    allowed = {"vss", "dav", "prices", "tenders", "rollup", "suggest"}
    requested = [part.strip().lower() for part in (body.only or "").split(",") if part.strip()]
    if not requested or any(part not in allowed for part in requested):
        raise HTTPException(400, "Nhóm đồng bộ không hợp lệ.")
    only = ",".join(dict.fromkeys(requested))
    if not _tidb_sync_lock.acquire(blocking=False):
        return {"ok": False, "message": "Đồng bộ TiDB đang chạy."}

    def _run():
        global _tidb_sync_state
        try:
            _tidb_sync_state = {"state": "running", "phase": "upload", "message": "Đang đẩy dữ liệu local lên TiDB…", "ok": True, "verified": False}
            command = [sys.executable, str(root / "scripts" / "tidb" / "sync_to_tidb.py"), "--yes-remote", "--only", only]
            if body.fromStart:
                command.append("--from-start")
            upload = subprocess.run(command, cwd=str(root), capture_output=True, text=True, encoding="utf-8", errors="replace")
            if upload.returncode != 0:
                _tidb_sync_state = {"state": "error", "phase": "upload", "message": "TiDB chưa nhận đủ dữ liệu; tiến độ có thể chạy lại an toàn.", "ok": False, "verified": False}
                return
            _tidb_sync_state = {"state": "running", "phase": "verify", "message": "Đang đối chiếu số lượng local với TiDB…", "ok": True, "verified": False}
            verify = subprocess.run(
                [sys.executable, str(root / "scripts" / "tidb" / "verify.py"), "--yes-remote"],
                cwd=str(root), capture_output=True, text=True, encoding="utf-8", errors="replace",
            )
            if verify.returncode != 0:
                _tidb_sync_state = {"state": "error", "phase": "verify", "message": "Đã đẩy xong nhưng đối chiếu TiDB chưa đạt; chưa xác nhận production an toàn.", "ok": False, "verified": False}
                return
            _tidb_sync_state = {"state": "idle", "phase": "done", "message": "TiDB đã đồng bộ và đối chiếu số lượng thành công.", "ok": True, "verified": True, "updated": now_iso()}
        except Exception:
            _tidb_sync_state = {"state": "error", "phase": "unexpected", "message": "Đồng bộ TiDB gặp lỗi nội bộ; chưa xác nhận production.", "ok": False, "verified": False}
        finally:
            _tidb_sync_lock.release()

    threading.Thread(target=_run, daemon=True, name="tidb-production-sync").start()
    return {"ok": True, "message": "Đã bắt đầu đồng bộ TiDB. Hệ thống sẽ chỉ báo hoàn tất sau bước đối chiếu."}


@app.get("/api/supabase/sync/status")
def supabase_sync_status():
    return dict(_sync_state)


@app.post("/api/supabase/sync")
def supabase_sync(body: SyncBody):
    """Run scripts/sync_to_supabase.py in a background thread (needs .env service role)."""
    import os
    import subprocess
    import sys

    if not os.environ.get("SUPABASE_URL") or not os.environ.get("SUPABASE_SERVICE_ROLE_KEY"):
        try:
            from dotenv import load_dotenv
            root = Path(__file__).resolve().parents[1]
            load_dotenv(root / ".env")
        except Exception:
            pass
    if not os.environ.get("SUPABASE_URL") or not os.environ.get("SUPABASE_SERVICE_ROLE_KEY"):
        raise HTTPException(
            400,
            "Thiếu SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY trong .env — xem .env.example và supabase/README.md",
        )
    if not _sync_lock.acquire(blocking=False):
        return {"ok": False, "message": "Sync đang chạy."}

    only = (body.only or "vss,dav,msc").strip()

    def _run():
        global _sync_state
        _sync_state = {"state": "running", "message": f"Sync {only}…", "ok": True}
        try:
            root = Path(__file__).resolve().parents[1]
            proc = subprocess.run(
                [sys.executable, str(root / "scripts" / "sync_to_supabase.py"), "--only", only],
                cwd=str(root),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            out = (proc.stdout or "")[-2000:]
            err = (proc.stderr or "")[-1000:]
            if proc.returncode != 0:
                _sync_state = {"state": "error", "message": err or out or "sync failed", "ok": False}
            else:
                last = out.strip().splitlines()[-1] if out.strip() else "Sync OK"
                _sync_state = {"state": "idle", "message": last, "ok": True}
        except Exception as e:
            _sync_state = {"state": "error", "message": str(e), "ok": False}
        finally:
            _sync_lock.release()

    threading.Thread(target=_run, daemon=True, name="supabase-sync").start()
    return {"ok": True, "message": f"Đã bắt đầu sync ({only}). Theo dõi /api/supabase/sync/status."}


# Serve built SPA if present
DIST = Path(__file__).resolve().parents[1] / "web" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(404)
        candidate = DIST / full_path
        if full_path and candidate.exists() and candidate.is_file():
            return FileResponse(candidate)
        data_candidate = DIST / full_path
        index = DIST / "index.html"
        return FileResponse(index)


def create_app():
    return app


def _auto_crawl_loop():
    """When autoCrawl.enabled: DAV + MSC + VSS once per day, including right after the app opens."""
    from .daily import start_daily

    while True:
        try:
            start_daily(force=False)
        except Exception:
            pass
        time.sleep(1800)


@app.on_event("startup")
def _startup_auto_crawl():
    try:
        vss.reconcile_status()
    except Exception:
        pass
    threading.Thread(target=_auto_crawl_loop, daemon=True, name="daily-update-watch").start()
