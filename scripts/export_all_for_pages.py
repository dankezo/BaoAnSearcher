# -*- coding: utf-8 -*-
"""Export slim, capped datasets for GitHub Pages (fast load) + rebuild docs/.

Local SQLite giữ FULL data; Pages chỉ nhận lát cắt tối ưu để sếp không bị lag.
"""
from __future__ import annotations
import gzip
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server import dav, msc, vss
from server.common import WEB_PUBLIC, MSC_DB

# Hard caps — keep Pages gzip small enough to decompress quickly in-browser.
VSS_PAGES_CAP = 40_000
DAV_PAGES_CAP = 40_000
MSC_PRICES_CAP = 12_000
MSC_TENDERS_CAP = 8_000

# Only fields the UI / client filters actually need (drop empty later).
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
        if isinstance(v, float):
            # keep ints clean
            if v == int(v):
                v = int(v)
        out[k] = v
    return out


def write_gz(name: str, payload: dict):
    WEB_PUBLIC.mkdir(parents=True, exist_ok=True)
    path = WEB_PUBLIC / f"{name}.json.gz"
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with gzip.open(path, "wb", compresslevel=9) as f:
        f.write(raw)
    n = payload.get("exported") or len(payload.get("items") or [])
    print(f"Wrote {path.name} {path.stat().st_size/1e6:.2f} MB · items={n:,} · totalDb={payload.get('total')}")


def export_dav():
    print("DAV slim…")
    con = dav.connect()
    try:
        rows = con.execute("SELECT raw FROM drugs").fetchall()
    finally:
        con.close()
    items = []
    for raw, in rows:
        flat = dav.flatten(json.loads(raw))
        items.append(slim(flat, DAV_SLIM_KEYS))
    items.sort(
        key=lambda f: str(f.get("ngayGiaHan") or f.get("ngayCap") or f.get("ngayHetHan") or ""),
        reverse=True,
    )
    total = len(items)
    truncated = total > DAV_PAGES_CAP
    if truncated:
        items = items[:DAV_PAGES_CAP]
    write_gz("dav", {
        "total": total,
        "exported": len(items),
        "truncated": truncated,
        "items": items,
        "updated": dav.meta_info(),
        "note": "Pages: lát cắt tối ưu. Local API = full DB." if truncated else None,
    })


def export_msc():
    print("MSC slim…")
    core = msc._import_core()
    specs = (
        ("prices", "msc_prices", MSC_PRICE_SLIM, MSC_PRICES_CAP),
        ("tenders", "msc_tenders", MSC_TENDER_SLIM, MSC_TENDERS_CAP),
    )
    for kind, name, keys, cap in specs:
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
            items.append(slim(item, keys + ("_collected_at",)))
        total = len(items)
        truncated = total > cap
        if truncated:
            items = items[:cap]
        payload = {
            "total": total,
            "exported": len(items),
            "truncated": truncated,
            "items": items,
            "note": "Pages: lát cắt tối ưu. Local API = full DB." if truncated else None,
        }
        if kind == "prices":
            payload["meta"] = msc.meta_info()
        write_gz(name, payload)


def export_vss():
    print("VSS slim + cap…")
    meta = vss.meta_info()
    total = int(meta.get("count") or 0)
    con = vss.connect()
    try:
        rows = con.execute(
            "SELECT raw, nam, tungay_hd FROM bids "
            "WHERE nam IS NULL OR nam >= 2023 "
            "ORDER BY coalesce(tungay_hd,'') DESC, id DESC "
            "LIMIT ?",
            (VSS_PAGES_CAP,),
        ).fetchall()
        if len(rows) < min(5000, VSS_PAGES_CAP):
            # fallback if nam sparsely filled
            rows = con.execute(
                "SELECT raw, nam, tungay_hd FROM bids "
                "ORDER BY coalesce(tungay_hd,'') DESC, id DESC "
                "LIMIT ?",
                (VSS_PAGES_CAP,),
            ).fetchall()
    finally:
        con.close()

    items = []
    for i, (raw, nam, tungay_hd) in enumerate(rows):
        d = json.loads(raw)
        if d.get("nam") is None and nam is not None:
            d["nam"] = nam
        if not d.get("tungay_hd") and tungay_hd:
            d["tungay_hd"] = tungay_hd
        if d.get("nam") is None:
            for k in ("congbo", "tungay_hd", "tungay"):
                m = re.search(r"(20\d{2})", str(d.get(k) or ""))
                if m:
                    d["nam"] = int(m.group(1))
                    break
        s = slim(d, VSS_SLIM_KEYS)
        s["stt"] = i + 1
        items.append(s)
        if (i + 1) % 10000 == 0:
            print(f"  … {i+1:,}")

    truncated = total > len(items)
    write_gz("vss", {
        "total": total,
        "exported": len(items),
        "truncated": truncated,
        "cap": VSS_PAGES_CAP,
        "items": items,
        "meta": meta,
        "note": (
            f"Pages chỉ tải {len(items):,}/{total:,} bản ghi mới nhất (tối ưu tốc độ). "
            "Chạy Local API (MO_WEB) để tra cứu toàn bộ."
            if truncated else None
        ),
    })


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
