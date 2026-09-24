# -*- coding: utf-8 -*-
"""Rebuild GitHub Pages SPA. Search data lives on Supabase — no large JSON.gz.

Keeps small static helpers (dm93, tt20). Writes tiny status stubs for offline meta.
"""
from __future__ import annotations
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server.common import WEB_PUBLIC, now_iso

# Re-export slim key lists for sync_to_supabase
VSS_SLIM_KEYS = (
    "hoatchat", "sodk", "ten", "duongdung", "hamluong", "donvitinh",
    "soluong", "gia", "thanhtien", "nhomthau", "nhasx", "nuocsx",
    "ma_tinh", "ma_cskcb", "tungay_hd", "denngay_hd", "loai_thau",
    "congbo", "nam", "ten_tinh", "ten_cskcb", "tennhathau", "dangbaoche",
    "loai",
)
DAV_SLIM_KEYS = (
    "id", "soDangKy", "soDangKyCu", "tenThuoc", "ngayCap", "ngayGiaHan", "ngayHetHan",
    "hoatChat", "hamLuong", "dangBaoChe", "dongGoi", "hanDung",
    "ctySanXuat", "nuocSanXuat", "ctyDangKy", "nuocDangKy",
    "soQuyetDinh", "tieuChuan", "kyCapNam", "conHieuLuc",
    "ingredientCount", "tagId",
)
MSC_PRICE_SLIM = (
    "name", "ingredient", "strength", "registration", "unit_price", "quantity", "unit",
    "group_name", "medicine_type", "manufacturer", "country", "buyer", "province",
    "tender_no", "published", "winner", "source_url", "source_id",
)
MSC_TENDER_SLIM = (
    "tender_no", "name", "buyer", "province", "published", "close_date",
    "status_label", "status_code", "bid_price", "bid_form", "source_url", "source_id",
)


def slim(row: dict, keys: tuple) -> dict:
    out = {}
    for k in keys:
        v = row.get(k)
        if v is None or v == "" or v == []:
            continue
        if isinstance(v, float) and v == int(v):
            v = int(v)
        out[k] = v
    return out


def write_status_stub():
    WEB_PUBLIC.mkdir(parents=True, exist_ok=True)
    stub = {
        "note": "Search data is on Supabase. Configure VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY.",
        "updated": now_iso(),
    }
    path = WEB_PUBLIC / "status.json"
    path.write_text(json.dumps(stub, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {path.name}")
    # Remove bulky gzip dumps if present (Pages must stay light)
    for name in ("vss.json.gz", "dav.json.gz", "msc_prices.json.gz", "msc_tenders.json.gz",
                 "vss.json", "dav.json", "msc_prices.json", "msc_tenders.json"):
        p = WEB_PUBLIC / name
        if p.exists():
            p.unlink()
            print(f"Removed {p.name} (data on Supabase)")


def rebuild_docs():
    import os
    print("Build web…")
    web = ROOT / "web"
    env = os.environ.copy()
    env["VITE_BASE"] = "./"
    subprocess.check_call(["npm", "run", "build"], cwd=str(web), shell=True, env=env)
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
    print("docs/ ready (no large search JSON.gz)")


if __name__ == "__main__":
    write_status_stub()
    rebuild_docs()
    print("DONE — set VITE_SUPABASE_* before build for Cloud search")
