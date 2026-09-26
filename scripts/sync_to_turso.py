# -*- coding: utf-8 -*-
"""Upsert local SQLite → Turso (libSQL). Auth stays on Supabase; big data on Turso.

Env (local only, never commit):
  TURSO_DATABASE_URL=libsql://baoan-searcher-….turso.io
  TURSO_AUTH_TOKEN=…

Usage:
  python scripts/sync_to_turso.py
  python scripts/sync_to_turso.py --only vss
  VSS_SYNC_SKIP=100000 python scripts/sync_to_turso.py --only vss
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
    load_dotenv(ROOT / "web" / ".env.local")
except ImportError:
    pass

import libsql_client

from server import dav, msc, vss
from server.common import MSC_DB, fold, now_iso
from scripts.export_all_for_pages import (
    MSC_PRICE_SLIM,
    MSC_TENDER_SLIM,
    VSS_SLIM_KEYS,
)

BATCH = 100
VSS_MIN_YEAR = 2024


def _env(name: str) -> str:
    v = (os.environ.get(name) or "").strip()
    if not v:
        raise SystemExit(f"Missing env {name}. Set in .env (see .env.example).")
    return v


def _client():
    url = _env("TURSO_DATABASE_URL")
    token = _env("TURSO_AUTH_TOKEN")
    # libsql:// / wss:// often 400 on Windows; HTTP API is reliable for batch upserts
    if url.startswith("libsql://"):
        url = "https://" + url[len("libsql://"):]
    elif url.startswith("wss://"):
        url = "https://" + url[len("wss://"):]
    return libsql_client.create_client_sync(url=url, auth_token=token)


def _upsert_rows(db, table: str, rows: list[dict], pk: str):
    if not rows:
        return
    cols = sorted({k for r in rows for k in r.keys()})
    if pk not in cols:
        cols.insert(0, pk)
    placeholders = ", ".join("?" for _ in cols)
    col_sql = ", ".join(cols)
    updates = ", ".join(f"{c}=excluded.{c}" for c in cols if c != pk)
    sql = (
        f"INSERT INTO {table} ({col_sql}) VALUES ({placeholders}) "
        f"ON CONFLICT({pk}) DO UPDATE SET {updates}"
    )
    stmts = []
    for r in rows:
        args = [r.get(c) for c in cols]
        stmts.append(libsql_client.Statement(sql, args))
    db.batch(stmts)


def _set_meta(db, key: str, value: dict):
    db.execute(
        "INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
        [key, json.dumps(value, ensure_ascii=False), now_iso()],
    )


def _ensure_indexes(db):
    """Indexes for common filters / ORDER BY — IF NOT EXISTS is safe to re-run."""
    stmts = [
        "CREATE INDEX IF NOT EXISTS idx_dav_tag_id ON dav_drugs(tag_id)",
        "CREATE INDEX IF NOT EXISTS idx_dav_ngay_cap ON dav_drugs(ngay_cap DESC, ngay_gia_han DESC, id)",
        "CREATE INDEX IF NOT EXISTS idx_dav_search ON dav_drugs(search)",
        "CREATE INDEX IF NOT EXISTS idx_vss_loai ON vss_bids(loai)",
        "CREATE INDEX IF NOT EXISTS idx_vss_loai_nam ON vss_bids(loai, nam)",
        "CREATE INDEX IF NOT EXISTS idx_vss_tungay_fp ON vss_bids(tungay_hd DESC, fingerprint)",
        "CREATE INDEX IF NOT EXISTS idx_vss_search ON vss_bids(search)",
        "CREATE INDEX IF NOT EXISTS idx_msc_prices_pub ON msc_prices(published DESC, source_id)",
        "CREATE INDEX IF NOT EXISTS idx_msc_tenders_pub ON msc_tenders(published DESC, source_id)",
        "CREATE INDEX IF NOT EXISTS idx_msc_prices_search ON msc_prices(search)",
        "CREATE INDEX IF NOT EXISTS idx_msc_tenders_search ON msc_tenders(search)",
    ]
    for sql in stmts:
        try:
            db.execute(sql)
        except Exception as e:
            print(f"  index warn: {e}", flush=True)


def _clear_metrics_cache(db, *keys: str):
    """Force /api/tender/metrics to recompute after sync."""
    for key in keys:
        try:
            db.execute("DELETE FROM app_meta WHERE key = ?", [key])
        except Exception:
            pass


def sync_vss(db) -> int:
    print(f"VSS → Turso nam>={VSS_MIN_YEAR}…", flush=True)
    skip = int(os.environ.get("VSS_SYNC_SKIP", "0") or "0")
    con = vss.connect()
    try:
        total = con.execute(
            "SELECT count(*) FROM bids WHERE nam IS NULL OR nam >= ?",
            (VSS_MIN_YEAR,),
        ).fetchone()[0]
        print(f"  rows to sync: {total:,} (skip first {skip:,})", flush=True)
        cur = con.execute(
            "SELECT fingerprint, raw, search, nam, tungay_hd, denngay_hd FROM bids "
            "WHERE nam IS NULL OR nam >= ? ORDER BY id "
            "LIMIT -1 OFFSET ?",
            (VSS_MIN_YEAR, skip),
        )
        n = skip
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
                parts = [
                    d.get("hoatchat"), d.get("sodk"), d.get("ten"), d.get("tennhathau"),
                    d.get("nhasx"), d.get("ten_tinh"), d.get("ten_cskcb"),
                    d.get("hamluong"), d.get("duongdung"), d.get("dangbaoche"),
                    d.get("nhomthau"), d.get("loai_thau"), d.get("loai"),
                ]
                compact = fold(" ".join(str(p) for p in parts if p))
                row = {"fingerprint": fp, "search": compact or (search or "")[:240]}
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
            _upsert_rows(db, "vss_bids", batch, "fingerprint")
            n += len(batch)
            batch = []
            if n % 5000 == 0 or n >= total:
                print(f"  … {n:,}/{total:,}", flush=True)
    finally:
        con.close()
    meta = vss.meta_info()
    meta["synced"] = n
    meta["synced_at"] = now_iso()
    meta["min_year"] = VSS_MIN_YEAR
    meta["backend"] = "turso"
    _set_meta(db, "vss", meta)
    _clear_metrics_cache(db, "metrics_vss")
    print(f"VSS done: {n:,}")
    return n


def sync_dav(db) -> int:
    print("DAV → Turso…", flush=True)
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
            "con_hieu_luc": 1 if flat.get("conHieuLuc") else (0 if flat.get("conHieuLuc") is not None else None),
            "ingredient_count": flat.get("ingredientCount"),
            "tag_id": flat.get("tagId") if not isinstance(flat.get("tagId"), list)
            else ",".join(str(x) for x in flat.get("tagId") or []),
        }
        batch.append({k: v for k, v in row.items() if v is not None and v != ""})
        if len(batch) >= BATCH:
            _upsert_rows(db, "dav_drugs", batch, "id")
            n += len(batch)
            batch = []
            if n % 5000 == 0:
                print(f"  … {n:,}", flush=True)
    if batch:
        _upsert_rows(db, "dav_drugs", batch, "id")
        n += len(batch)
    meta = dav.meta_info()
    meta["synced"] = n
    meta["synced_at"] = now_iso()
    meta["backend"] = "turso"
    _set_meta(db, "dav", meta)
    _clear_metrics_cache(db, "metrics_dav")
    print(f"DAV done: {n:,}")
    return n


def sync_msc(db) -> int:
    print("MSC → Turso…", flush=True)
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
            batch.append(row)
            if len(batch) >= BATCH:
                _upsert_rows(db, table, batch, "source_id")
                n += len(batch)
                batch = []
        if batch:
            _upsert_rows(db, table, batch, "source_id")
            n += len(batch)
        print(f"  {kind}: {n:,}", flush=True)
        total_n += n
    meta = msc.meta_info()
    meta["synced"] = total_n
    meta["synced_at"] = now_iso()
    meta["backend"] = "turso"
    _set_meta(db, "msc", meta)
    _clear_metrics_cache(db, "metrics_msc_prices", "metrics_msc_tenders")
    print(f"MSC done: {total_n:,}")
    return total_n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="vss,dav,msc")
    args = ap.parse_args()
    only = {x.strip().lower() for x in args.only.split(",") if x.strip()}
    t0 = time.time()
    db = _client()
    try:
        print("Ensuring Turso indexes…", flush=True)
        _ensure_indexes(db)
        if "vss" in only:
            sync_vss(db)
        if "dav" in only:
            sync_dav(db)
        if "msc" in only:
            sync_msc(db)
    finally:
        db.close()
    print(f"ALL OK in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
