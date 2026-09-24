# -*- coding: utf-8 -*-
"""DAV drug search, flatten, validity filter, crawl wrapper."""
from __future__ import annotations
import json
import re
import sqlite3
import sys
import threading
from datetime import datetime
from pathlib import Path

from .common import (
    DAV_DB, DM93_PATH, VN, fold, load_status, normalize_dosage_form,
    normalize_ingredient_token, normalize_strength, parse_date, split_ingredients,
    update_status, years_between, now_iso,
)

_dm93_cache = None
_dm93_index_cache = None
_validity_cache = None  # set of soDangKy that pass validity pipeline
_downloader = None
_download_thread = None


def _import_drug_tool():
    root = Path(__file__).resolve().parents[1] / "test zone"
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    import drug_tool  # noqa
    return drug_tool


def connect():
    if not DAV_DB.exists():
        raise FileNotFoundError(f"Chưa có DB DAV: {DAV_DB}")
    con = sqlite3.connect(DAV_DB, timeout=30)
    con.row_factory = sqlite3.Row
    con.create_function("fold", 1, fold)
    return con


def load_dm93() -> list[dict]:
    global _dm93_cache
    if _dm93_cache is None:
        _dm93_cache = json.loads(DM93_PATH.read_text(encoding="utf-8"))
    return _dm93_cache


def nested(record: dict, *paths, default=""):
    for path in paths:
        node = record
        ok = True
        for key in path.split("."):
            if isinstance(node, dict) and key in node:
                node = node[key]
            else:
                ok = False
                break
        if ok and node is not None:
            return node
    return default


def flatten(record: dict) -> dict:
    tt = record.get("thongTinThuocCoBan") or {}
    td = record.get("thongTinDangKyThuoc") or {}
    sx = record.get("congTySanXuat") or {}
    dk = record.get("congTyDangKy") or {}
    hc = tt.get("hoatChatChinh") or record.get("hoatChatChinh") or ""
    hl = tt.get("hamLuong") or record.get("hamLuong") or ""
    dang = tt.get("dangBaoChe") or record.get("dangBaoChe") or ""
    ngay_cap = td.get("ngayCapSoDangKy") or record.get("ngayCapSoDangKy")
    ngay_gh = td.get("ngayGiaHanSoDangKy")
    ngay_hh = td.get("ngayHetHanSoDangKy")
    # Prefer gia hạn date for period start if present
    start_raw = ngay_gh or ngay_cap
    start = parse_date(start_raw)
    end = parse_date(ngay_hh)
    now = datetime.now(VN)
    con_hl = False
    ky_nam = None
    if start and end:
        ky_nam = years_between(start, end)
        con_hl = end >= now and ky_nam >= 3.0 - 1e-9
    elif end:
        con_hl = end >= now

    ingredients = split_ingredients(hc)
    phan_loai = record.get("phanLoaiThuocEnum")
    pl_label = {1: "Không kê đơn", 2: "Kê đơn", 3: "Hạn chế", 4: "Kiểm soát đặc biệt"}.get(phan_loai, str(phan_loai or ""))

    # Packaging / release facility often embedded in manufacturer name
    sx_ten = sx.get("tenCongTySanXuat") or record.get("tenCongTySanXuat") or ""
    dong_goi_cs = ""
    xuat_xuong = ""
    m = re.search(r"Cơ sở đóng gói[^:]*:\s*([^(]+)(?:\(([^)]*)\))?", sx_ten, re.I)
    if m:
        dong_goi_cs = m.group(1).strip()
        xuat_xuong = (m.group(2) or "").strip()

    months_left = None
    if end:
        months_left = (end - now).total_seconds() / (30.4375 * 24 * 3600)

    flat = {
        "id": record.get("id"),
        "soDangKy": record.get("soDangKy") or "",
        "soDangKyCu": record.get("soDangKyCu") or "",
        "tenThuoc": record.get("tenThuoc") or "",
        "ngayCap": ngay_cap or "",
        "ngayGiaHan": ngay_gh or "",
        "ngayHetHan": ngay_hh or "",
        "hoatChat": hc,
        "hamLuong": hl,
        "dangBaoChe": dang,
        "dongGoi": tt.get("dongGoi") or record.get("dongGoi") or "",
        "hanDung": tt.get("tuoiTho") or record.get("tuoiTho") or "",
        "tieuChuan": tt.get("tieuChuan") or record.get("tieuChuan") or "",
        "soQuyetDinh": td.get("soQuyetDinh") or record.get("soQuyetDinh") or "",
        "dotCap": td.get("dotCap") or "",
        "phanLoai": pl_label,
        "ctySanXuat": sx_ten,
        "diaChiSanXuat": sx.get("diaChiSanXuat") or "",
        "nuocSanXuat": sx.get("nuocSanXuat") or "",
        "ctyDangKy": dk.get("tenCongTyDangKy") or "",
        "diaChiDangKy": dk.get("diaChiDangKy") or "",
        "nuocDangKy": dk.get("nuocDangKy") or "",
        "csDongGoi": dong_goi_cs,
        "csXuatXuong": xuat_xuong,
        "isActive": bool(record.get("isActive")),
        "isDeleted": bool(record.get("isDeleted")),
        "isDaRut": bool(record.get("isDaRutSoDangKy")),
        "isHetHan": bool(record.get("isHetHan")),
        "conHieuLuc": con_hl,
        "kyCapNam": round(ky_nam, 2) if ky_nam is not None else None,
        "monthsLeft": round(months_left, 1) if months_left is not None else None,
        "hasGiaHanPending": bool(record.get("maSoHoSoGiaHan") or record.get("ngayTiepNhanHSGiaHan") or record.get("urlGiayTiepNhanGiaHan")),
        "ingredientCount": len([x for x in ingredients if x]),
        "ingredients": ingredients,
        "ghiChu": record.get("ghiChu") or "",
        "dm93": None,  # filled below
        "tagId": None,
    }
    dm = match_dm93(flat)
    flat["dm93"] = dm
    flat["tagId"] = classify_sdk_tag(flat)
    return flat


TAG_XANH = "TAG_XANH_LA"
TAG_VANG = "TAG_VANG_XAC_MINH"
TAG_CAM = "TAG_CAM_CMO"
TAG_XAM = "TAG_XAM_LICH_SU"


def classify_sdk_tag(flat: dict) -> str:
    """Primary commercial status tag for an SĐK row (mutually exclusive)."""
    end = parse_date(flat.get("ngayHetHan"))
    now = datetime.now(VN)
    expired = bool(flat.get("isHetHan")) or (end is not None and end < now)
    if flat.get("isDeleted") or flat.get("isDaRut") or expired or flat.get("isActive") is False:
        return TAG_XAM

    if flat.get("dm93") == "match":
        return TAG_CAM

    ky = flat.get("kyCapNam")
    months = flat.get("monthsLeft")
    pending = bool(flat.get("hasGiaHanPending"))
    cycle3 = ky is not None and 2.5 <= float(ky) < 4.0
    cycle5 = ky is not None and 4.5 <= float(ky) <= 6.0
    short = months is not None and float(months) < 18

    if short or cycle3 or pending:
        return TAG_VANG

    if (
        months is not None
        and float(months) >= 18
        and cycle5
        and flat.get("dm93") != "match"
        and (flat.get("hoatChat") or "").strip()
        and end is not None
    ):
        return TAG_XANH

    # Incomplete dates / odd cycle → verify
    return TAG_VANG


def _dm93_index():
    global _dm93_index_cache
    if _dm93_index_cache is not None:
        return _dm93_index_cache
    rows = []
    for item in load_dm93():
        rows.append({
            "hc": normalize_ingredient_token(item["hoatChat"]),
            "hl": normalize_strength(item["hamLuong"]),
            "dang": normalize_dosage_form(item["dangBaoChe"]),
            "raw_dang": fold(item["dangBaoChe"]),
            "parts": split_ingredients(item["hoatChat"]),
        })
    _dm93_index_cache = rows
    return rows


def match_dm93(flat: dict) -> str:
    """Return 'match' | 'no' | 'uncertain'."""
    hc = normalize_ingredient_token(flat["hoatChat"])
    hl = normalize_strength(flat["hamLuong"])
    dang = normalize_dosage_form(flat["dangBaoChe"])
    parts = flat.get("ingredients") or split_ingredients(flat["hoatChat"])
    if not hc or not hl:
        return "uncertain"
    index = _dm93_index()
    # Exact-ish triple match
    for row in index:
        hc_ok = hc == row["hc"] or set(parts) == set(row["parts"])
        # Also allow each part contained
        if not hc_ok and parts and row["parts"]:
            hc_ok = all(any(p == rp or p in rp or rp in p for rp in row["parts"]) for p in parts)
        hl_ok = hl == row["hl"] or hl.replace(".", "") == row["hl"].replace(".", "")
        # Dosage: conventional viên/tiêm flexible
        dang_ok = dang == row["dang"] or fold(flat["dangBaoChe"]) == row["raw_dang"]
        if row["dang"] == "vien" and dang in ("vien", "vien nang"):
            dang_ok = True
        if row["dang"] == "vien nang" and "nang" in fold(flat["dangBaoChe"]):
            dang_ok = True
        if row["dang"] == "thuoc tiem" and dang == "thuoc tiem":
            dang_ok = True
        if hc_ok and hl_ok and dang_ok:
            return "match"
        if hc_ok and hl_ok and not dang_ok:
            return "uncertain"
        if hc_ok and not hl_ok:
            # same name only — keep uncertain per rules (don't exclude on name alone)
            continue
    # ingredient name overlap without strength → uncertain keep
    for row in index:
        if any(p and any(p == rp or p in rp or rp in p for rp in row["parts"]) for p in parts):
            return "uncertain"
    return "no"


def step1_commercial(flat: dict, record: dict) -> bool:
    if flat["isDeleted"] or flat["isDaRut"] or not flat["isActive"]:
        return False
    # Prefer SĐK that look like commercial VN/VD/QLSP etc.
    sdk = (flat["soDangKy"] or "").upper()
    if not sdk:
        return False
    # Exclude obvious non-targets if flagged
    if record.get("isDuocPhep") is False:
        return False
    return True


def step2_complete(flat: dict) -> bool:
    if not (flat["hoatChat"] or "").strip():
        return False
    if not parse_date(flat["ngayHetHan"]):
        return False
    if not (parse_date(flat["ngayGiaHan"]) or parse_date(flat["ngayCap"])):
        return False
    return True


def step3_validity_period(flat: dict) -> bool:
    start = parse_date(flat["ngayGiaHan"]) or parse_date(flat["ngayCap"])
    end = parse_date(flat["ngayHetHan"])
    if not start or not end:
        return False
    now = datetime.now(VN)
    if end < now:
        return False
    return years_between(start, end) >= 3.0 - 1e-9


def build_validity_set(progress_cb=None) -> set[str]:
    """Full 6-step pipeline; returns set of soDangKy that PASS (kept for research)."""
    global _validity_cache
    con = connect()
    try:
        total = con.execute("SELECT count(*) FROM drugs").fetchone()[0]
        rows = con.execute("SELECT raw FROM drugs").fetchall()
    finally:
        con.close()

    # Pass A: steps 1-4 → candidates before ingredient expansion
    passed_14 = []
    dm93_excluded = 0
    for i, (raw,) in enumerate(rows):
        if progress_cb and i % 2000 == 0:
            progress_cb(5 + int(40 * i / max(1, total)), f"Hiệu lực bước 1–4… {i:,}/{total:,}")
        rec = json.loads(raw)
        flat = flatten(rec)
        if not step1_commercial(flat, rec):
            continue
        if not step2_complete(flat):
            continue
        if not step3_validity_period(flat):
            continue
        m = match_dm93(flat)
        if m == "match":
            dm93_excluded += 1
            continue  # exclude definite DM93 matches
        # uncertain or no → keep
        passed_14.append(flat)

    # Ingredient pool from passed_14 (for step 5 matching)
    pool_ingredients = set()
    for flat in passed_14:
        for p in flat.get("ingredients") or []:
            if p:
                pool_ingredients.add(p)

    if progress_cb:
        progress_cb(55, f"Khớp hoạt chất pool ({len(pool_ingredients):,})…")

    # Step 5+6: among commercial complete validity rows, keep if ingredient overlaps pool
    # Actually re-read rules:
    # 5. Match at least one ingredient with the "DAV đạt" set (after 1-4)
    # 6. Each SĐK stands alone
    # So the result set IS passed_14 filtered by ingredient in pool — but pool IS from passed_14,
    # so everyone in passed_14 already has their own ingredients in the pool.
    # The intent of step 5 is: when filtering a LARGER set for research, keep drugs whose
    # ingredients appear in the đạt set. For the "còn hiệu lực" filter itself, passed_14 is the set.
    # We'll also allow expanding: any drug that fails 1-4 but shares ingredient with pool? No —
    # "giúp thu hẹp danh sách" means the filter KEEPS the đạt set. So result = passed_14.

    result = {f["soDangKy"] for f in passed_14 if f["soDangKy"]}
    _validity_cache = result
    if progress_cb:
        progress_cb(70, f"Còn hiệu lực: {len(result):,} SĐK (loại DM93: {dm93_excluded:,})")
    return result


def get_validity_set(force=False, progress_cb=None) -> set[str]:
    global _validity_cache
    if _validity_cache is not None and not force:
        return _validity_cache
    return build_validity_set(progress_cb)


def count_ingredients(text: str) -> int:
    return len([x for x in split_ingredients(text) if x])


def search_drugs(filters: dict, page: int = 0, size: int = 50) -> dict:
    """Search with text + structured filters."""
    q = fold(filters.get("q") or "")
    ten = fold(filters.get("tenThuoc") or "")
    sdk = fold(filters.get("soDangKy") or "")
    hc = fold(filters.get("hoatChat") or "")
    dang = fold(filters.get("dangBaoChe") or "")
    sx = fold(filters.get("sanXuat") or "")
    dk = fold(filters.get("dangKy") or "")
    nuoc = fold(filters.get("nuocSanXuat") or "")

    ingredient_n = filters.get("ingredientCount")
    ingredient_other = filters.get("ingredientCountOther")
    dosage_n = filters.get("dosageFormCount")
    dosage_other = filters.get("dosageFormCountOther")
    strength_n = filters.get("strengthCount")
    strength_other = filters.get("strengthCountOther")
    con_hieu_luc = bool(filters.get("conHieuLuc"))
    raw_tags = filters["tags"] if "tags" in filters else filters.get("selectedTags", None)
    tags_set = None
    if raw_tags is not None:
        if isinstance(raw_tags, str):
            raw_tags = [t for t in raw_tags.split(",") if t.strip()]
        tags_set = {str(t).strip() for t in (raw_tags or []) if str(t).strip()}

    validity = set()
    if con_hieu_luc:
        validity = get_validity_set()

    if tags_set is not None and len(tags_set) == 0:
        con = connect()
        try:
            total_db = con.execute("SELECT count(*) FROM drugs").fetchone()[0]
        finally:
            con.close()
        return {"total": 0, "page": max(0, int(page)), "size": max(1, min(5000, int(size))), "items": [], "dbTotal": total_db}

    need_group = any([dosage_n, strength_n])
    # Fast path: SQL prefilter on FTS-ish search column (broad), then precise match on flatten()
    clauses, args = [], []
    for word in q.split():
        clauses.append("search LIKE ?")
        args.append(f"%{word}%")
    for blob in (ten, sdk, hc, dang, sx, dk, nuoc):
        for word in (blob.split() if blob else []):
            clauses.append("search LIKE ?")
            args.append(f"%{word}%")

    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    con = connect()
    try:
        total_db = con.execute("SELECT count(*) FROM drugs").fetchone()[0]
        rows = con.execute("SELECT raw FROM drugs" + where, args).fetchall()
    finally:
        con.close()

    group_stats = {}
    if need_group:
        # Build stats from full DB for HC groups (once per request)
        con = connect()
        try:
            all_rows = con.execute("SELECT raw FROM drugs").fetchall()
        finally:
            con.close()
        for (raw,) in all_rows:
            rec = json.loads(raw)
            flat = flatten(rec)
            key = fold(flat["hoatChat"]) or "__empty__"
            g = group_stats.setdefault(key, {"sdk": set(), "forms": set(), "strengths": set()})
            if flat["soDangKy"]:
                g["sdk"].add(flat["soDangKy"])
            if flat["dangBaoChe"]:
                g["forms"].add(fold(flat["dangBaoChe"]))
            if flat["hamLuong"]:
                g["strengths"].add(normalize_strength(flat["hamLuong"]))

    def match_count(val, choice, other):
        if not choice:
            return True
        if choice == "other":
            try:
                n = int(other)
            except (TypeError, ValueError):
                return True
            return val == n
        try:
            return val == int(choice)
        except ValueError:
            return True

    results = []
    for (raw,) in rows:
        rec = json.loads(raw)
        flat = flatten(rec)
        # Reliable text match on flattened fields (json_extract paths can miss variants)
        if ten and ten not in fold(flat.get("tenThuoc") or ""):
            continue
        if sdk and sdk not in fold(f"{flat.get('soDangKy') or ''} {flat.get('soDangKyCu') or ''}"):
            continue
        if hc and not all(w in fold(flat.get("hoatChat") or "") for w in hc.split()):
            continue
        if dang and dang not in fold(flat.get("dangBaoChe") or ""):
            continue
        if sx and sx not in fold(flat.get("ctySanXuat") or ""):
            continue
        if dk and dk not in fold(flat.get("ctyDangKy") or ""):
            continue
        if nuoc and nuoc not in fold(flat.get("nuocSanXuat") or ""):
            continue
        if con_hieu_luc and flat["soDangKy"] not in validity:
            continue
        if tags_set is not None and flat.get("tagId") not in tags_set:
            continue
        if ingredient_n and not match_count(flat["ingredientCount"], ingredient_n, ingredient_other):
            continue
        if need_group:
            key = fold(flat["hoatChat"]) or "__empty__"
            g = group_stats.get(key, {"sdk": set(), "forms": set(), "strengths": set()})
            flat["groupSdkCount"] = len(g["sdk"])
            flat["groupFormCount"] = len(g["forms"])
            flat["groupStrengthCount"] = len(g["strengths"])
            if not match_count(flat["groupFormCount"], dosage_n, dosage_other):
                continue
            if not match_count(flat["groupStrengthCount"], strength_n, strength_other):
                continue
        results.append(flat)

    # Newest first (gia hạn / ngày cấp)
    results.sort(
        key=lambda f: str(f.get("ngayGiaHan") or f.get("ngayCap") or f.get("ngayHetHan") or ""),
        reverse=True,
    )

    total = len(results)
    page = max(0, int(page))
    size = max(1, min(5000, int(size)))
    start = page * size
    slice_ = results[start: start + size]
    return {
        "total": total,
        "page": page,
        "size": size,
        "items": slice_,
        "dbTotal": total_db,
    }


def meta_info() -> dict:
    info = {"count": 0, "updated": None, "complete": False, "skip": 0, "sourceTotal": 0}
    if not DAV_DB.exists():
        return info
    con = connect()
    try:
        info["count"] = con.execute("SELECT count(*) FROM drugs").fetchone()[0]
        for key in ("updated", "complete", "skip", "total"):
            row = con.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
            if row:
                info[{"total": "sourceTotal"}.get(key, key)] = json.loads(row[0])
    finally:
        con.close()
    return info


def start_crawl(restart: bool = False) -> dict:
    global _downloader, _download_thread
    if _download_thread and _download_thread.is_alive():
        return {"ok": False, "message": "Đang tải DAV…"}

    drug_tool = _import_drug_tool()

    def report(text):
        # Parse progress from messages like "Đã duyệt 200/55000"
        pct = 0
        m = re.search(r"([\d,]+)/([\d,]+)", text.replace(".", ""))
        if m:
            a = int(m.group(1).replace(",", ""))
            b = max(1, int(m.group(2).replace(",", "")))
            pct = min(99, int(100 * a / b))
        update_status("dav", state="running", progress=pct, message=text, updated=now_iso())

    def work():
        global _downloader
        try:
            update_status("dav", state="running", progress=1, message="Kết nối DAV…", updated=now_iso())
            _downloader = drug_tool.Downloader(report)
            _downloader.run(restart=restart)
            info = meta_info()
            update_status("dav", state="idle", progress=100, message="Hoàn tất", updated=now_iso(), count=info["count"])
        except Exception as e:
            update_status("dav", state="error", message=str(e), updated=now_iso())

    _download_thread = threading.Thread(target=work, daemon=True)
    _download_thread.start()
    return {"ok": True, "message": "Đã bắt đầu tải DAV"}


def stop_crawl():
    global _downloader
    if _downloader:
        _downloader.stop.set()
        update_status("dav", message="Đang dừng…")
        return {"ok": True}
    return {"ok": False, "message": "Không có tiến trình"}
