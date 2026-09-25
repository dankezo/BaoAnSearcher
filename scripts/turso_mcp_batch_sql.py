# -*- coding: utf-8 -*-
"""Emit INSERT OR REPLACE SQL batches from local SQLite for Turso MCP write_database.

Usage:
  python scripts/turso_mcp_batch_sql.py vss --offset 0 --limit 100
  python scripts/turso_mcp_batch_sql.py dav
  python scripts/turso_mcp_batch_sql.py msc prices
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.export_all_for_pages import MSC_PRICE_SLIM, MSC_TENDER_SLIM, VSS_SLIM_KEYS
from server import dav, msc, vss
from server.common import MSC_DB, fold, now_iso

BATCH = 100
VSS_MIN_YEAR = 2024

VSS_COLS = (
    "fingerprint", "search", *VSS_SLIM_KEYS, "updated_at",
)

DAV_COLS = (
    "id", "search", "so_dang_ky", "so_dang_ky_cu", "ten_thuoc", "ngay_cap",
    "ngay_gia_han", "ngay_het_han", "hoat_chat", "ham_luong", "dang_bao_che",
    "dong_goi", "han_dung", "cty_san_xuat", "nuoc_san_xuat", "cty_dang_ky",
    "nuoc_dang_ky", "so_quyet_dinh", "tieu_chuan", "ky_cap_nam", "con_hieu_luc",
    "ingredient_count", "tag_id", "updated_at",
)


def sql_lit(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(int(value)) if isinstance(value, float) and value == int(value) else str(value)
    s = str(value).replace("'", "''")
    return f"'{s}'"


def insert_or_replace(table: str, cols: tuple[str, ...], rows: list[dict]) -> str:
    if not rows:
        return ""
    col_sql = ", ".join(cols)
    value_groups = []
    for row in rows:
        vals = ", ".join(sql_lit(row.get(c)) for c in cols)
        value_groups.append(f"({vals})")
    return f"INSERT OR REPLACE INTO {table} ({col_sql}) VALUES {', '.join(value_groups)}"


def _vss_row(fp, raw, search, nam, tungay_hd, denngay_hd) -> dict | None:
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
    row: dict = {
        "fingerprint": fp,
        "search": compact or (search or "")[:240],
        "updated_at": now_iso(),
    }
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
    return row


def iter_vss_batches(offset: int = 0, limit: int | None = None):
    con = vss.connect()
    try:
        cur = con.execute(
            "SELECT fingerprint, raw, search, nam, tungay_hd, denngay_hd FROM bids "
            "WHERE nam IS NULL OR nam >= ? ORDER BY id LIMIT -1 OFFSET ?",
            (VSS_MIN_YEAR, offset),
        )
        emitted = 0
        batch: list[dict] = []
        while True:
            rows = cur.fetchmany(BATCH)
            if not rows:
                if batch:
                    yield insert_or_replace("vss_bids", VSS_COLS, batch)
                break
            for tup in rows:
                row = _vss_row(*tup)
                if row:
                    batch.append(row)
                if len(batch) >= BATCH:
                    yield insert_or_replace("vss_bids", VSS_COLS, batch)
                    emitted += len(batch)
                    batch = []
                    if limit is not None and emitted >= limit:
                        return
            if not rows:
                break
    finally:
        con.close()


def _dav_row(raw: str) -> dict | None:
    flat = dav.flatten(json.loads(raw))
    pk = str(flat.get("id") or flat.get("soDangKy") or "")
    if not pk:
        return None
    search = fold(
        " ".join(
            str(flat.get(k) or "")
            for k in (
                "tenThuoc", "soDangKy", "hoatChat", "hamLuong", "dangBaoChe",
                "ctySanXuat", "ctyDangKy", "nuocSanXuat",
            )
        )
    )
    tag = flat.get("tagId")
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
        "tag_id": tag if not isinstance(tag, list) else ",".join(str(x) for x in tag or []),
        "updated_at": now_iso(),
    }
    return {k: v for k, v in row.items() if v is not None and v != ""}


def iter_dav_batches():
    con = dav.connect()
    try:
        cur = con.execute("SELECT raw FROM drugs")
        batch: list[dict] = []
        while True:
            rows = cur.fetchmany(BATCH)
            if not rows:
                if batch:
                    yield insert_or_replace("dav_drugs", DAV_COLS, batch)
                break
            for (raw,) in rows:
                row = _dav_row(raw)
                if row:
                    batch.append(row)
                if len(batch) >= BATCH:
                    yield insert_or_replace("dav_drugs", DAV_COLS, batch)
                    batch = []
    finally:
        con.close()


def iter_msc_batches(kind: str):
    if not MSC_DB.exists():
        return
    table = "msc_prices" if kind == "prices" else "msc_tenders"
    keys = MSC_PRICE_SLIM if kind == "prices" else MSC_TENDER_SLIM
    cols = ("source_id", "search", *[k for k in keys if k != "source_id"], "updated_at")
    core = msc._import_core()
    with core.connect(MSC_DB) as con:
        cur = con.execute(
            "SELECT source_id, normalized, collected_at, search_text FROM records WHERE kind=?",
            (kind,),
        )
        batch: list[dict] = []
        while True:
            rows = cur.fetchmany(BATCH)
            if not rows:
                if batch:
                    yield insert_or_replace(table, cols, batch)
                break
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
                row = {
                    "source_id": sid,
                    "search": search_text or fold(json.dumps(item, ensure_ascii=False)),
                    "updated_at": now_iso(),
                }
                for k in keys:
                    if k == "source_id":
                        continue
                    v = item.get(k)
                    if v is None or v == "":
                        continue
                    row[k] = v if not isinstance(v, (dict, list)) else json.dumps(v, ensure_ascii=False)
                batch.append(row)
                if len(batch) >= BATCH:
                    yield insert_or_replace(table, cols, batch)
                    batch = []


def app_meta_sql(key: str, value: dict) -> str:
    payload = json.dumps(value, ensure_ascii=False).replace("'", "''")
    ts = now_iso()
    return (
        "INSERT INTO app_meta (key, value, updated_at) VALUES "
        f"('{key}', '{payload}', '{ts}') "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at"
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("table", choices=("vss", "dav", "msc"))
    ap.add_argument("msc_kind", nargs="?", choices=("prices", "tenders"))
    ap.add_argument("--offset", type=int, default=0)
    ap.add_argument("--limit", type=int, default=None, help="max rows (vss only)")
    ap.add_argument("--meta", help="emit app_meta SQL for key after counting synced rows")
    args = ap.parse_args()

    if args.table == "vss":
        gen = iter_vss_batches(args.offset, args.limit)
    elif args.table == "dav":
        gen = iter_dav_batches()
    else:
        if not args.msc_kind:
            ap.error("msc requires prices or tenders")
        gen = iter_msc_batches(args.msc_kind)

    for sql in gen:
        if sql:
            print(sql, flush=True)


if __name__ == "__main__":
    main()
