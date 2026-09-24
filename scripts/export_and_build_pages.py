# -*- coding: utf-8 -*-
"""Export larger slices for Pages then rebuild docs/."""
from __future__ import annotations
import gzip
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server import dav, msc, vss
from server.common import WEB_PUBLIC


def write_gz(name: str, payload):
    WEB_PUBLIC.mkdir(parents=True, exist_ok=True)
    path = WEB_PUBLIC / f"{name}.json.gz"
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with gzip.open(path, "wb", compresslevel=9) as f:
        f.write(raw)
    mb = path.stat().st_size / 1e6
    print(f"Wrote {path.name} {mb:.2f} MB items={payload.get('exported') or payload.get('total') or len(payload.get('items') or [])}")
    return mb


def dump_dav(limit=15000):
    print("DAV…")
    items = []
    page = 0
    total = None
    while len(items) < limit:
        res = dav.search_drugs({}, page=page, size=min(200, limit - len(items)))
        total = res["total"]
        if not res["items"]:
            break
        items.extend(res["items"])
        page += 1
        if page > 500:
            break
    return write_gz("dav", {"total": total, "exported": len(items), "items": items, "updated": dav.meta_info()})


def dump_msc(limit_p=8000, limit_t=5000):
    print("MSC…")
    prices = msc.search("prices", {}, page=0, size=min(limit_p, 200))
    items = list(prices["items"])
    page = 1
    while len(items) < min(limit_p, prices["total"]):
        more = msc.search("prices", {}, page=page, size=200)
        if not more["items"]:
            break
        items.extend(more["items"])
        page += 1
        if page > 100:
            break
    write_gz("msc_prices", {"total": prices["total"], "exported": len(items), "items": items, "meta": msc.meta_info()})

    tenders = msc.search("tenders", {}, page=0, size=min(limit_t, 200))
    titems = list(tenders["items"])
    page = 1
    while len(titems) < min(limit_t, tenders["total"]):
        more = msc.search("tenders", {}, page=page, size=200)
        if not more["items"]:
            break
        titems.extend(more["items"])
        page += 1
        if page > 100:
            break
    write_gz("msc_tenders", {"total": tenders["total"], "exported": len(titems), "items": titems})


def dump_vss(limit=20000):
    print("VSS…")
    res = vss.search_bids({}, page=0, size=min(200, limit))
    items = list(res["items"])
    page = 1
    while len(items) < min(limit, res["total"]):
        more = vss.search_bids({}, page=page, size=200)
        if not more["items"]:
            break
        items.extend(more["items"])
        page += 1
        if page > 200:
            break
    write_gz("vss", {"total": res["total"], "exported": len(items), "items": items, "meta": vss.meta_info()})


def rebuild_docs():
    web = ROOT / "web"
    subprocess.check_call(["npm", "run", "build"], cwd=web, shell=True)
    docs = ROOT / "docs"
    if docs.exists():
        shutil.rmtree(docs)
    shutil.copytree(web / "dist", docs)
    print("docs/ ready")


if __name__ == "__main__":
    dump_dav(15000)
    dump_msc(8000, 5000)
    dump_vss(20000)
    rebuild_docs()
    print("DONE")
