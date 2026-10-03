# -*- coding: utf-8 -*-
"""Local SQLite and optional TiDB reads for the portfolio cockpit.

Portfolio code only sees TiDB column names (dav_drugs, vss_bids, msc_prices).
SQLite stores DAV/VSS/MSC as JSON, so this module projects those blobs onto the
same columns. A TiDB connection is used only when TIDB_HOST, TIDB_USER and
TIDB_DATABASE are set. Missing credentials stay on SQLite; this module does not
open a pretend TiDB session.
"""
from __future__ import annotations

import json
import os
import sqlite3
from typing import Any

from .common import DAV_DB, MSC_DB, VSS_DB, fold
from .dav import flatten

DAV_COLUMNS = (
    "so_dang_ky", "ten_thuoc", "hoat_chat", "ham_luong", "dang_bao_che",
    "dong_goi", "ngay_cap", "ngay_het_han", "cty_san_xuat", "cty_dang_ky",
    "so_quyet_dinh", "con_hieu_luc", "tag_id",
)
VSS_COLUMNS = (
    "sodk", "ten", "hoatchat", "hamluong", "gia", "thanhtien", "nhomthau",
    "ma_tinh", "ten_tinh", "ten_cskcb", "nam",
)
MSC_COLUMNS = (
    "registration", "ingredient", "strength", "unit_price", "unit",
    "group_name", "manufacturer", "name", "dosage_form", "route", "quantity", "published", "decision_date", "decision", "buyer", "winner", "province", "tender_no", "source_url", "source_id",
)


def tidb_configured() -> bool:
    # The desktop API is the local working copy.  It must not turn a page
    # render into several wide TiDB scans merely because global TiDB
    # credentials are present for the production synchronizer.  Opt in to
    # remote reads explicitly when diagnosing production data.
    return (
        str(os.environ.get("PORTFOLIO_BACKEND") or "").strip().lower() == "tidb"
        and bool(os.environ.get("TIDB_HOST") and os.environ.get("TIDB_USER") and os.environ.get("TIDB_DATABASE"))
    )


def backend_name() -> str:
    return "tidb" if tidb_configured() else "sqlite"


def connect_tidb():
    """Open a real MySQL-protocol connection. Call only when tidb_configured()."""
    if not tidb_configured():
        raise RuntimeError("Thiếu TIDB_HOST / TIDB_USER / TIDB_DATABASE")
    try:
        import pymysql
    except ImportError as exc:
        raise RuntimeError("Đã cấu hình TiDB nhưng chưa cài pymysql") from exc
    return pymysql.connect(
        host=os.environ["TIDB_HOST"],
        port=int(os.environ.get("TIDB_PORT") or "4000"),
        user=os.environ["TIDB_USER"],
        password=os.environ.get("TIDB_PASSWORD") or "",
        database=os.environ["TIDB_DATABASE"],
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=8,
        read_timeout=60,
    )


def _placeholders(n: int, style: str) -> str:
    token = "%s" if style == "pyformat" else "?"
    return ", ".join([token] * n)


def _like_or(column: str, n: int, style: str) -> str:
    token = "%s" if style == "pyformat" else "?"
    return " OR ".join([f"{column} LIKE {token}"] * n)


def dav_by_registration(registrations: list[str]) -> list[dict]:
    regs = [r for r in registrations if r]
    if not regs:
        return []
    if tidb_configured():
        sql = (
            "SELECT so_dang_ky, ten_thuoc, hoat_chat, ham_luong, dang_bao_che, dong_goi, "
            "ngay_cap, ngay_het_han, cty_san_xuat, cty_dang_ky, so_quyet_dinh, con_hieu_luc, tag_id "
            "FROM dav_drugs WHERE so_dang_ky IN ("
            + _placeholders(len(regs), "pyformat") + ")"
        )
        return _tidb_fetch(sql, regs)
    return _sqlite_dav(regs)


def dav_cell_candidates(tokens: list[str]) -> list[dict]:
    """Active-ingredient candidates. Counting happens in Python on normalized cells."""
    tokens = [t for t in tokens if t and len(t) >= 4]
    if not tokens:
        return []
    if tidb_configured():
        sql = (
            "SELECT so_dang_ky, ten_thuoc, hoat_chat, ham_luong, dang_bao_che, dong_goi, "
            "ngay_cap, ngay_het_han, cty_san_xuat, cty_dang_ky, so_quyet_dinh, con_hieu_luc, tag_id "
            "FROM dav_drugs WHERE con_hieu_luc = 1 AND ("
            + _like_or("hoat_chat", len(tokens), "pyformat") + ")"
        )
        return _tidb_fetch(sql, [f"%{t}%" for t in tokens])
    return _sqlite_dav_tokens(tokens)


def vss_candidates(tokens: list[str], registrations: list[str], brands: list[str] | None = None) -> list[dict]:
    tokens = [t for t in tokens if t and len(t) >= 4]
    regs = [r for r in registrations if r]
    names = [b for b in (brands or []) if b and len(b) >= 5]
    if not tokens and not regs and not names:
        return []
    if tidb_configured():
        parts, args = [], []
        if tokens:
            parts.append("(" + _like_or("hoatchat", len(tokens), "pyformat") + ")")
            args.extend(f"%{t}%" for t in tokens)
        if regs:
            parts.append("sodk IN (" + _placeholders(len(regs), "pyformat") + ")")
            args.extend(regs)
        if names:
            parts.append("(" + _like_or("ten", len(names), "pyformat") + ")")
            args.extend(f"%{b}%" for b in names)
        sql = (
            "SELECT sodk, ten, hoatchat, hamluong, gia, thanhtien, nhomthau, "
            "ma_tinh, ten_tinh, ten_cskcb, nam FROM vss_bids WHERE " + " OR ".join(parts)
        )
        return _tidb_fetch(sql, args)
    return _sqlite_vss(tokens, regs, names)


def msc_candidates(tokens: list[str], registrations: list[str]) -> list[dict]:
    tokens = [t for t in tokens if t and len(t) >= 4]
    regs = [r for r in registrations if r]
    if tidb_configured():
        parts, args = [], []
        if regs:
            parts.append("registration IN (" + _placeholders(len(regs), "pyformat") + ")")
            args.extend(regs)
        if tokens:
            parts.append("(" + _like_or("ingredient", len(tokens), "pyformat") + ")")
            args.extend(f"%{t}%" for t in tokens)
        if not parts:
            return []
        sql = (
            "SELECT registration, ingredient, strength, unit_price, unit, group_name, manufacturer "
            "FROM msc_prices WHERE " + " OR ".join(parts)
        )
        return _tidb_fetch(sql, args)
    return _sqlite_msc(tokens, regs)


def _tidb_fetch(sql: str, args: list) -> list[dict]:
    con = connect_tidb()
    try:
        with con.cursor() as cur:
            cur.execute(sql, args)
            rows = cur.fetchall()
        return [dict(row) for row in rows]
    finally:
        con.close()


def _dav_from_raw(raw: str) -> dict:
    record = json.loads(raw)
    flat = flatten(record)
    return {
        "so_dang_ky": flat.get("soDangKy") or "",
        "so_dang_ky_cu": flat.get("soDangKyCu") or "",
        "ten_thuoc": flat.get("tenThuoc") or "",
        "hoat_chat": flat.get("hoatChat") or "",
        "ham_luong": flat.get("hamLuong") or "",
        "dang_bao_che": flat.get("dangBaoChe") or "",
        "dong_goi": flat.get("dongGoi") or "",
        "ngay_cap": flat.get("ngayCap") or "",
        "ngay_het_han": flat.get("ngayHetHan") or "",
        "cty_san_xuat": flat.get("ctySanXuat") or "",
        "cty_dang_ky": flat.get("ctyDangKy") or "",
        "so_quyet_dinh": flat.get("soQuyetDinh") or "",
        "con_hieu_luc": 1 if flat.get("conHieuLuc") else 0,
        "tag_id": flat.get("tagId") or "",
        "_months_left": flat.get("monthsLeft"),
        "_active_record": not (flat.get("isDeleted") or flat.get("isDaRut") or flat.get("isHetHan") or flat.get("isActive") is False),
    }


def _sqlite_dav(registrations: list[str]) -> list[dict]:
    if not DAV_DB.exists():
        return []
    clause = " OR ".join(["search LIKE ?"] * len(registrations))
    args = [f"%{fold(r)}%" for r in registrations]
    con = sqlite3.connect(DAV_DB, timeout=30)
    try:
        rows = con.execute(f"SELECT raw FROM drugs WHERE {clause}", args).fetchall()
    finally:
        con.close()
    wanted = {fold(r) for r in registrations}
    out = []
    for (raw,) in rows:
        item = _dav_from_raw(raw)
        if fold(item["so_dang_ky"]) in wanted or any(r in fold(item.get('so_dang_ky_cu') or '') for r in wanted):
            out.append(item)
    return out


def _sqlite_dav_tokens(tokens: list[str]) -> list[dict]:
    if not DAV_DB.exists():
        return []
    clause = " OR ".join(["search LIKE ?"] * len(tokens))
    args = [f"%{fold(t)}%" for t in tokens]
    con = sqlite3.connect(DAV_DB, timeout=60)
    try:
        rows = con.execute(f"SELECT raw FROM drugs WHERE {clause}", args).fetchall()
    finally:
        con.close()
    out = []
    for (raw,) in rows:
        item = _dav_from_raw(raw)
        if item["con_hieu_luc"]:
            out.append(item)
    return out


def _sqlite_vss(tokens: list[str], registrations: list[str], brands: list[str] | None = None) -> list[dict]:
    if not VSS_DB.exists():
        return []
    parts, args = [], []
    if tokens:
        parts.append("(" + " OR ".join(["hoatchat LIKE ?"] * len(tokens)) + ")")
        args.extend(f"%{t}%" for t in tokens)
    if registrations:
        parts.append("(" + " OR ".join(["sodk = ?"] * len(registrations)) + ")")
        args.extend(registrations)
    for brand in brands or []:
        parts.append("ten LIKE ?")
        args.append(f"%{brand}%")
    sql = (
        "SELECT sodk, ten, hoatchat, nam, nhomthau, ma_tinh, "
        "json_extract(raw, '$.gia') AS gia, "
        "json_extract(raw, '$.thanhtien') AS thanhtien, "
        "json_extract(raw, '$.ten_tinh') AS ten_tinh, "
        "json_extract(raw, '$.ten_cskcb') AS ten_cskcb, "
        "json_extract(raw, '$.hamluong') AS hamluong, raw "
        "FROM bids WHERE " + " OR ".join(parts)
    )
    con = sqlite3.connect(VSS_DB, timeout=60)
    try:
        cur = con.execute(sql, args)
        cols = [d[0] for d in cur.description]
        result = []
        for row in cur.fetchall():
            item = dict(zip(cols, row))
            raw = json.loads(item.pop('raw'))
            result.append({**raw, **item})
        return result
    finally:
        con.close()


def _sqlite_msc(tokens: list[str], registrations: list[str]) -> list[dict]:
    if not MSC_DB.exists():
        return []
    parts, args = ["kind = ?"], ["prices"]
    inner, inner_args = [], []
    if registrations:
        inner.append("json_extract(normalized, '$.registration') IN (" + ",".join(["?"] * len(registrations)) + ")")
        inner_args.extend(registrations)
    if tokens:
        inner.append("(" + " OR ".join(["json_extract(normalized, '$.ingredient') LIKE ?"] * len(tokens)) + ")")
        inner_args.extend(f"%{t}%" for t in tokens)
    if inner:
        parts.append("(" + " OR ".join(inner) + ")")
        args.extend(inner_args)
    sql = "SELECT normalized FROM records WHERE " + " AND ".join(parts)
    con = sqlite3.connect(MSC_DB, timeout=30)
    try:
        rows = con.execute(sql, args).fetchall()
    finally:
        con.close()
    out = []
    for (norm,) in rows:
        item = json.loads(norm)
        out.append(item)
    return out


def project_columns(row: dict, columns: tuple[str, ...]) -> dict[str, Any]:
    return {key: row.get(key) for key in columns}
