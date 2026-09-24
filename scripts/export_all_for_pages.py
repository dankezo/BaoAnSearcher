# -*- coding: utf-8 -*-
"""Fast full export: one-pass dumps from SQLite → web/public/data + docs/."""
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
from server.common import WEB_PUBLIC, DAV_DB, MSC_DB, VSS_DB
import re


def write_gz(name: str, payload):
    WEB_PUBLIC.mkdir(parents=True, exist_ok=True)
    path = WEB_PUBLIC / f"{name}.json.gz"
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with gzip.open(path, "wb", compresslevel=6) as f:
        f.write(raw)
    n = payload.get("exported") or len(payload.get("items") or [])
    print(f"Wrote {path.name} {path.stat().st_size/1e6:.2f} MB items={n:,}")


def export_dav():
    print("DAV one-pass…")
    con = dav.connect()
    try:
        rows = con.execute("SELECT raw FROM drugs").fetchall()
    finally:
        con.close()
    items = []
    for i, (raw,) in enumerate(rows):
        flat = dav.flatten(json.loads(raw))
        items.append(flat)
        if (i + 1) % 10000 == 0:
            print(f"  … {i+1:,}")
    items.sort(key=lambda f: str(f.get("ngayGiaHan") or f.get("ngayCap") or f.get("ngayHetHan") or ""), reverse=True)
    write_gz("dav", {"total": len(items), "exported": len(items), "items": items, "updated": dav.meta_info()})


def export_msc():
    print("MSC one-pass…")
    core = msc._import_core()
    for kind, name in (("prices", "msc_prices"), ("tenders", "msc_tenders")):
        with core.connect(MSC_DB) as con:
            rows = con.execute(
                "SELECT normalized, collected_at FROM records WHERE kind=? "
                "ORDER BY coalesce(json_extract(normalized, '$.published'), collected_at) DESC",
                (kind,),
            ).fetchall()
        items = []
        for norm, collected in rows:
            item = json.loads(norm)
            item["_collected_at"] = collected
            items.append(item)
        items.sort(
            key=lambda it: str(it.get("published") or it.get("close_date") or it.get("_collected_at") or ""),
            reverse=True,
        )
        meta = msc.meta_info() if kind == "prices" else None
        payload = {"total": len(items), "exported": len(items), "items": items}
        if meta:
            payload["meta"] = meta
        write_gz(name, payload)


def export_vss():
    print("VSS one-pass…")
    con = vss.connect()
    try:
        rows = con.execute(
            "SELECT raw, nam, tungay_hd FROM bids ORDER BY coalesce(tungay_hd,'') DESC, id DESC"
        ).fetchall()
    finally:
        con.close()
    items = []
    for i, (raw, nam, tungay_hd) in enumerate(rows):
        d = json.loads(raw)
        if d.get("nam") is None:
            if nam is not None:
                d["nam"] = nam
            else:
                for k in ("congbo", "tungay_hd", "tungay"):
                    s = str(d.get(k) or "")
                    m = re.match(r"(20\d{2})", s)
                    if m:
                        d["nam"] = int(m.group(1))
                        break
        if not d.get("tungay_hd") and tungay_hd:
            d["tungay_hd"] = tungay_hd
        d["stt"] = i + 1
        items.append(d)
        if (i + 1) % 30000 == 0:
            print(f"  … {i+1:,}")
    write_gz("vss", {"total": len(items), "exported": len(items), "items": items, "meta": vss.meta_info()})


def rebuild_docs():
    print("Build web…")
    web = ROOT / "web"
    subprocess.check_call(["npm", "run", "build"], cwd=str(web), shell=True)
    docs = ROOT / "docs"
    dist = web / "dist"
    docs.mkdir(exist_ok=True)
    for name in ("index.html", "assets"):
        src, dst = dist / name, docs / name
        if dst.exists():
            shutil.rmtree(dst) if dst.is_dir() else dst.unlink()
        if src.is_dir():
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)
    data_dst = docs / "data"
    if data_dst.exists():
        shutil.rmtree(data_dst)
    shutil.copytree(WEB_PUBLIC, data_dst)
    print("docs/ ready")


if __name__ == "__main__":
    export_dav()
    export_msc()
    export_vss()
    rebuild_docs()
    print("DONE")
