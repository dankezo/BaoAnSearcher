# -*- coding: utf-8 -*-
"""Upsert local SQLite → Supabase (service role). VSS nam>=2024 + full DAV/MSC.

Env (local only, never commit):
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Usage:
  python scripts/sync_to_supabase.py
  python scripts/sync_to_supabase.py --only vss
  python scripts/sync_to_supabase.py --only dav,msc
"""
from __future__ import annotations
import argparse
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

try:
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
    load_dotenv(ROOT / "web" / ".env")
    load_dotenv(ROOT / "web" / ".env.local")
except ImportError:
    pass

from server import dav, msc, vss
from server.common import MSC_DB, fold, now_iso
from scripts.export_all_for_pages import (
    MSC_PRICE_SLIM,
    MSC_TENDER_SLIM,
    VSS_SLIM_KEYS,
)

BATCH = 500
VSS_MIN_YEAR = 2024


def _env(name: str) -> str:
    v = (os.environ.get(name) or "").strip()
    if not v:
        raise SystemExit(f"Missing env {name}. Set in .env (see .env.example).")
    return v


def _client():
    try:
        from supabase import create_client
    except ImportError:
        raise SystemExit("pip install supabase python-dotenv")
    return create_client(_env("SUPABASE_URL"), _env("SUPABASE_SERVICE_ROLE_KEY"))


def _upsert(sb, table: str, rows: list[dict], on_conflict: str):
    if not rows:
        return
    # Drop nulls to keep rows slim
    clean = []
    for r in rows:
        clean.append({k: v for k, v in r.items() if v is not None and v != ""})
    sb.table(table).upsert(clean, on_conflict=on_conflict).execute()


def _set_meta(sb, key: str, value: dict):
    sb.table("app_meta").upsert(
        {"key": key, "value": value, "updated_at": now_iso()},
        on_conflict="key",
    ).execute()


def sync_vss(sb) -> int:
    print(f"VSS sync nam>={VSS_MIN_YEAR}…")
    con = vss.connect()
    try:
        total = con.execute(
            "SELECT count(*) FROM bids WHERE nam IS NULL OR nam >= ?",
            (VSS_MIN_YEAR,),
        ).fetchone()[0]
        print(f"  rows to sync: {total:,}")
        cur = con.execute(
            "SELECT fingerprint, raw, search, nam, tungay_hd, denngay_hd FROM bids "
            "WHERE nam IS NULL OR nam >= ? ORDER BY id",
            (VSS_MIN_YEAR,),
        )
        n = 0
        batch = []
        while True:
            rows = cur.fetchmany(BATCH)
            if not rows:
                break
            for fp, raw, search, nam, tungay_hd, denngay_hd in rows:
                d = json.loads(raw)
                if d.get("nam") is None and nam is not None:
                    d["nam"] = nam
                if not d.get("tungay_hd") and tungay_hd:
                    d["tungay_hd"] = tungay_hd
                if not d.get("denngay_hd") and denngay_hd:
                    d["denngay_hd"] = denngay_hd
                row = {"fingerprint": fp, "search": search or ""}
                for k in VSS_SLIM_KEYS:
                    v = d.get(k)
                    if v is None or v == "":
                        continue
                    row[k] = v
                if "nam" in row and row["nam"] is not None:
                    try:
                        row["nam"] = int(row["nam"])
                    except (TypeError, ValueError):
                        del row["nam"]
                batch.append(row)
            _upsert(sb, "vss_bids", batch, "fingerprint")
            n += len(batch)
            batch = []
            if n % 5000 == 0 or n >= total:
                print(f"  … {n:,}/{total:,}")
    finally:
        con.close()
    meta = vss.meta_info()
    meta["synced"] = n
    meta["synced_at"] = now_iso()
    meta["min_year"] = VSS_MIN_YEAR
    _set_meta(sb, "vss", meta)
    print(f"VSS done: {n:,}")
    return n


def sync_dav(sb) -> int:
    print("DAV sync…")
    con = dav.connect()
    try:
        rows = con.execute("SELECT raw FROM drugs").fetchall()
    finally:
        con.close()
    batch, n = [], 0
    for (raw,) in rows:
        flat = dav.flatten(json.loads(raw))
        pk = str(flat.get("id") or flat.get("soDangKy") or "")
        if not pk:
            continue
        search = fold(
            " ".join(
                str(flat.get(k) or "")
                for k in (
                    "tenThuoc", "soDangKy", "hoatChat", "hamLuong", "dangBaoChe",
                    "ctySanXuat", "ctyDangKy", "nuocSanXuat",
                )
            )
        )
        row = {
            "id": pk,
            "search": search,
            "so_dang_ky": flat.get("soDangKy"),
            "so_dang_ky_cu": flat.get("soDangKyCu"),
            "ten_thuoc": flat.get("tenThuoc"),
            "ngay_cap": flat.get("ngayCap"),
            "ngay_gia_han": flat.get("ngayGiaHan"),
            "ngay_het_han": flat.get("ngayHetHan"),
            "hoat_chat": flat.get("hoatChat"),
            "ham_luong": flat.get("hamLuong"),
            "dang_bao_che": flat.get("dangBaoChe"),
            "dong_goi": flat.get("dongGoi"),
            "han_dung": flat.get("hanDung"),
            "cty_san_xuat": flat.get("ctySanXuat"),
            "nuoc_san_xuat": flat.get("nuocSanXuat"),
            "cty_dang_ky": flat.get("ctyDangKy"),
            "nuoc_dang_ky": flat.get("nuocDangKy"),
            "so_quyet_dinh": flat.get("soQuyetDinh"),
            "tieu_chuan": flat.get("tieuChuan"),
            "ky_cap_nam": flat.get("kyCapNam"),
            "con_hieu_luc": bool(flat.get("conHieuLuc")) if flat.get("conHieuLuc") is not None else None,
            "ingredient_count": flat.get("ingredientCount"),
            "tag_id": flat.get("tagId") if not isinstance(flat.get("tagId"), list)
            else ",".join(str(x) for x in flat.get("tagId") or []),
        }
        batch.append(row)
        if len(batch) >= BATCH:
            _upsert(sb, "dav_drugs", batch, "id")
            n += len(batch)
            batch = []
            if n % 5000 == 0:
                print(f"  … {n:,}")
    if batch:
        _upsert(sb, "dav_drugs", batch, "id")
        n += len(batch)
    meta = dav.meta_info()
    meta["synced"] = n
    meta["synced_at"] = now_iso()
    _set_meta(sb, "dav", meta)
    print(f"DAV done: {n:,}")
    return n


def sync_msc(sb) -> int:
    print("MSC sync…")
    if not MSC_DB.exists():
        print("  skip — no MSC DB")
        return 0
    core = msc._import_core()
    total_n = 0
    for kind, table, keys in (
        ("prices", "msc_prices", MSC_PRICE_SLIM),
        ("tenders", "msc_tenders", MSC_TENDER_SLIM),
    ):
        with core.connect(MSC_DB) as con:
            rows = con.execute(
                "SELECT source_id, normalized, collected_at, search_text FROM records WHERE kind=?",
                (kind,),
            ).fetchall()
        batch, n = [], 0
        for sid0, norm, collected, search_text in rows:
            item = json.loads(norm)
            sid = str(sid0 or item.get("source_id") or item.get("tender_no") or "")
            if not sid and kind == "prices":
                sid = fold(
                    f"{item.get('registration')}|{item.get('tender_no')}|"
                    f"{item.get('name')}|{item.get('unit_price')}|{collected}"
                )[:120]
            if not sid:
                continue
            row = {"source_id": sid, "search": search_text or fold(json.dumps(item, ensure_ascii=False))}
            for k in keys:
                if k == "source_id":
                    continue
                v = item.get(k)
                if v is None or v == "":
                    continue
                row[k] = v if not isinstance(v, (dict, list)) else json.dumps(v, ensure_ascii=False)
            row["collected_at"] = collected
            batch.append(row)
            if len(batch) >= BATCH:
                _upsert(sb, table, batch, "source_id")
                n += len(batch)
                batch = []
        if batch:
            _upsert(sb, table, batch, "source_id")
            n += len(batch)
        print(f"  {kind}: {n:,}")
        total_n += n
    meta = msc.meta_info()
    meta["synced"] = total_n
    meta["synced_at"] = now_iso()
    _set_meta(sb, "msc", meta)
    print(f"MSC done: {total_n:,}")
    return total_n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="vss,dav,msc", help="Comma list: vss,dav,msc")
    args = ap.parse_args()
    only = {x.strip().lower() for x in args.only.split(",") if x.strip()}
    t0 = time.time()
    sb = _client()
    if "vss" in only:
        sync_vss(sb)
    if "dav" in only:
        sync_dav(sb)
    if "msc" in only:
        sync_msc(sb)
    print(f"ALL OK in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
