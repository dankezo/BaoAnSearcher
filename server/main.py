# -*- coding: utf-8 -*-
"""BaoAn Searcher API."""
from __future__ import annotations
import json
import threading
import time
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import dav, msc, vss
from .common import (
    WEB_PUBLIC, load_secrets, save_secrets, load_status, update_status, now_iso, DM93_PATH, VN,
)

app = FastAPI(title="BaoAn Searcher", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class SecretsBody(BaseModel):
    msc: Optional[dict] = None
    vss: Optional[dict] = None
    autoCrawl: Optional[dict] = None


class CrawlBody(BaseModel):
    restart: bool = False
    dateFrom: Optional[str] = None
    dateTo: Optional[str] = None
    pages: int = 20
    days: int = 2
    loai: int = 1
    excelPath: Optional[str] = None
    refresh: bool = False
    catchup: bool = False
    saveJson: bool = False


@app.get("/api/health")
def health():
    return {"ok": True, "mode": "local", "time": now_iso()}


@app.get("/api/status")
def status():
    st = load_status()
    try:
        st["dav"]["count"] = dav.meta_info().get("count", 0)
        st["dav"]["meta"] = dav.meta_info()
    except Exception as e:
        st["dav"]["error"] = str(e)
    try:
        info = msc.meta_info()
        st["msc"]["count"] = info.get("prices", 0) + info.get("tenders", 0)
        st["msc"]["meta"] = info
    except Exception as e:
        st["msc"]["error"] = str(e)
    try:
        st["vss"]["count"] = vss.meta_info().get("count", 0)
        st["vss"]["meta"] = vss.meta_info()
    except Exception as e:
        st["vss"]["error"] = str(e)
    return st


@app.get("/api/secrets")
def get_secrets():
    s = load_secrets()
    # Mask passwords
    out = json.loads(json.dumps(s))
    for key in ("msc", "vss"):
        if key in out and isinstance(out[key], dict) and out[key].get("password"):
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
    if "autoCrawl" in data:
        current["autoCrawl"] = data["autoCrawl"]
    save_secrets(current)
    return {"ok": True}


@app.get("/api/dm93")
def dm93():
    return json.loads(DM93_PATH.read_text(encoding="utf-8"))


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
        s = dav.build_validity_set(progress_cb=cb)
        update_status("dav", state="idle", progress=100, message=f"Hiệu lực: {len(s):,} SĐK", updated=now_iso())
        return {"ok": True, "count": len(s)}
    except Exception as e:
        update_status("dav", state="error", message=str(e))
        raise HTTPException(500, str(e))


@app.post("/api/dav/crawl")
def dav_crawl(body: CrawlBody):
    return dav.start_crawl(restart=body.restart)


@app.post("/api/dav/crawl/stop")
def dav_crawl_stop():
    return dav.stop_crawl()


@app.post("/api/msc/search")
def msc_search(body: dict[str, Any]):
    kind = body.get("kind") or "prices"
    filters = body.get("filters") or {}
    page = int(body.get("page") or 0)
    size = int(body.get("size") or 50)
    try:
        return msc.search(kind, filters, page=page, size=size)
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/msc/crawl/prices")
def msc_crawl_prices(body: CrawlBody):
    if not body.dateFrom or not body.dateTo:
        raise HTTPException(400, "Cần dateFrom và dateTo (YYYY-MM-DD)")
    return msc.start_price_sync(body.dateFrom, body.dateTo, refresh=body.refresh)


@app.post("/api/msc/crawl/tenders")
def msc_crawl_tenders(body: CrawlBody):
    return msc.start_tender_browser(pages=body.pages)


@app.post("/api/vss/search")
def vss_search(body: dict[str, Any]):
    filters = body.get("filters") or body
    page = int(body.get("page") or 0)
    size = int(body.get("size") or 50)
    return vss.search_bids(filters, page=page, size=size)


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
    """When autoCrawl.enabled: daily VSS crawl of last 2 days only (default)."""
    while True:
        try:
            time.sleep(1800)  # check every 30 min
            secrets = load_secrets()
            ac = secrets.get("autoCrawl") or {}
            if not ac.get("enabled"):
                continue
            from datetime import datetime
            today = datetime.now(VN).strftime("%Y-%m-%d")
            if ac.get("lastVssDate") == today:
                continue
            days = int(ac.get("vssDays") or 2)
            days = max(1, min(7, days))
            st = load_status().get("vss") or {}
            if st.get("state") == "running":
                continue
            vss.crawl_vss(days=days, loai=1, catchup=False)
            secrets = load_secrets()
            secrets.setdefault("autoCrawl", {})
            secrets["autoCrawl"]["lastVssDate"] = today
            secrets["autoCrawl"]["vssDays"] = days
            save_secrets(secrets)
        except Exception:
            time.sleep(60)


@app.on_event("startup")
def _startup_auto_crawl():
    t = threading.Thread(target=_auto_crawl_loop, daemon=True, name="vss-auto-crawl")
    t.start()
