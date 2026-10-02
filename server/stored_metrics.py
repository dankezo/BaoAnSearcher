# -*- coding: utf-8 -*-
"""Precomputed metric cards and typeahead values.

Rebuilt by scripts/refresh_app_metadata.py after a data update.
Opening the app only reads the stored payload.
"""
from __future__ import annotations
import json
import re
from collections import defaultdict
from datetime import datetime

from .common import DAV_DB, VSS_DB, fold, now_iso, write_metadata
from . import dav

METRICS_DDL = """
CREATE TABLE IF NOT EXISTS app_metrics (
    section TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
)
"""
SUGGEST_DDL = """
CREATE TABLE IF NOT EXISTS suggest_values (
    section TEXT NOT NULL,
    field TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (section, field, value)
)
"""

VSS_SUGGEST = {
    "q": "ten",
    "hoatchat": "hoatchat",
    "sodk": "sodk",
    "ten": "ten",
    "loai_thau": "loai_thau",
    "duongdung": "duongdung",
    "ma_tinh": "ma_tinh",
    "nuocsx": "nuocsx",
    "nhomthau": "nhomthau",
}
DAV_SUGGEST = {
    "q": "tenThuoc",
    "tenThuoc": "tenThuoc",
    "soDangKy": "soDangKy",
    "hoatChat": "hoatChat",
    "drugGroup": "phanLoai",
    "dangBaoChe": "dangBaoChe",
    "sanXuat": "ctySanXuat",
    "dangKy": "ctyDangKy",
    "nuocSanXuat": "nuocSanXuat",
}


def _con(path):
    import sqlite3
    con = sqlite3.connect(path, timeout=180)
    con.execute(METRICS_DDL)
    con.execute(SUGGEST_DDL)
    return con


def _fmt_int(n) -> str:
    return f"{int(n):,}".replace(",", ".")


def _fmt_money(n) -> str:
    v = float(n or 0)
    sign = "-" if v < 0 else ""
    a = abs(v)
    if a >= 1e9:
        text = f"{a / 1e9:.1f}".replace(".", ",")
        return f"{sign}{text} Tỷ"
    if a >= 1e6:
        text = f"{a / 1e6:.1f}".replace(".", ",")
        return f"{sign}{text} Tr"
    return f"{sign}{_fmt_int(round(a))}"


def _num(v):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v)
    s = str(v).strip().replace(" ", "")
    if re.match(r"^-?\d{1,3}(\.\d{3})+(,\d+)?$", s):
        s = s.replace(".", "").replace(",", ".")
    elif re.match(r"^-?\d+,\d+$", s):
        s = s.replace(",", ".")
    else:
        s = re.sub(r"[^\d.-]", "", s)
    try:
        return float(s)
    except ValueError:
        return None


def _line_value(row: dict) -> float:
    v = _num(row.get("thanhtien"))
    if v is not None:
        return v
    return (_num(row.get("gia")) or 0) * (_num(row.get("soluong")) or 0)


def _group(raw) -> str | None:
    s = str(raw or "").lower()
    if re.search(r"nhóm\s*1|\bn1\b|group\s*1|^1$", s):
        return "1"
    if re.search(r"nhóm\s*2|\bn2\b|group\s*2|^2$", s):
        return "2"
    if re.search(r"nhóm\s*3|\bn3\b|group\s*3|^3$", s):
        return "3"
    if re.search(r"nhóm\s*4|\bn4\b|group\s*4|^4$", s):
        return "4"
    if re.search(r"nhóm\s*5|\bn5\b|group\s*5|^5$", s):
        return "5"
    return None


def _short(name: str, max_len: int = 18) -> str:
    text = str(name or "").strip()
    if len(text) <= max_len:
        return text or "—"
    return text[: max_len - 1] + "…"


def _save(con, section: str, payload: dict) -> None:
    con.execute(
        "INSERT OR REPLACE INTO app_metrics (section, payload, updated_at) VALUES (?, ?, ?)",
        (section, json.dumps(payload, ensure_ascii=False), now_iso()),
    )


def _fill_column_suggest(con, section: str, table: str, fields: dict[str, str]) -> None:
    con.execute("DELETE FROM suggest_values WHERE section = ?", (section,))
    for field, column in fields.items():
        if field == "q":
            continue
        con.execute(
            f"INSERT OR IGNORE INTO suggest_values (section, field, value) "
            f"SELECT ?, ?, {column} FROM {table} "
            f"WHERE {column} IS NOT NULL AND trim({column}) != ''",
            (section, field),
        )


def refresh_vss(year: int | None = None) -> dict:
    year = year or datetime.now().year
    note = f"từ đầu năm {year}"
    con = _con(VSS_DB)
    try:
        _fill_column_suggest(con, "vss", "bids", VSS_SUGGEST)
        provinces = {}
        pay_g = {str(i): 0.0 for i in range(1, 6)}
        pay_all = 0.0
        facilities = set()
        tw = 0
        total = 0
        tinh = set()
        cur = con.execute(
            "SELECT nhomthau, ma_tinh, raw FROM bids WHERE nam = ? AND loai = ?",
            (year, "Tân dược"),
        )
        while True:
            rows = cur.fetchmany(2000)
            if not rows:
                break
            for nhom, ma, raw in rows:
                total += 1
                item = json.loads(raw)
                pay = _line_value(item)
                pay_all += pay
                g = _group(nhom or item.get("nhomthau"))
                if g:
                    pay_g[g] += pay
                facility = str(item.get("ma_cskcb") or item.get("ten_cskcb") or "").strip()
                if facility:
                    facilities.add(facility)
                name = str(item.get("ten_cskcb") or "").lower()
                if re.search(r"trung ương|trung uong|\btw\b|bạch mai|bach mai|chợ rẫy|cho ray|việt đức|viet duc", name):
                    tw += 1
                code = str(ma or item.get("ma_tinh") or "").strip()
                ten_tinh = str(item.get("ten_tinh") or "").strip()
                key = code or ten_tinh or "_unk"
                label = ten_tinh or (f"Tỉnh mã {code}" if code else "Chưa xác định tỉnh")
                bucket = provinces.setdefault(key, {
                    "key": key, "code": code, "name": label, "value": 0.0,
                    "count": 0, "facilities": set(), "groups": [0.0, 0.0, 0.0, 0.0, 0.0],
                })
                bucket["value"] += pay
                bucket["count"] += 1
                if facility:
                    bucket["facilities"].add(facility)
                if g:
                    bucket["groups"][int(g) - 1] += pay
                if ten_tinh:
                    tinh.add(ten_tinh)
        if tinh:
            con.executemany(
                "INSERT OR IGNORE INTO suggest_values (section, field, value) VALUES ('vss', 'ten_tinh', ?)",
                [(name,) for name in tinh],
            )
        ranked = sorted(provinces.values(), key=lambda row: row["value"], reverse=True)
        total_pay = sum(row["value"] for row in ranked) or 1
        province_rows = []
        for row in ranked:
            province_rows.append({
                "key": row["key"],
                "code": row["code"],
                "name": row["name"],
                "value": row["value"],
                "count": row["count"],
                "facilities": len(row["facilities"]),
                "groups": row["groups"],
                "share": row["value"] / total_pay * 100,
            })
        top = province_rows[0] if province_rows else None
        high = ((pay_g["1"] + pay_g["2"]) / (pay_all or 1)) * 100
        local = max(0, total - tw)
        tier = tw + local or 1
        payload = {
            "section": "vss",
            "year": year,
            "total": total,
            "sampleSize": total,
            "updatedAt": now_iso(),
            "fixed": True,
            "provinces": province_rows,
            "cards": [
                {
                    "key": "total", "scope": "fixed", "title": "Tổng giá trị trúng thầu",
                    "mainValue": _fmt_money(pay_all), "unit": "đ", "subtitle": note,
                    "subMetrics": [
                        {"id": "rows", "label": "Dòng", "count": _fmt_int(total), "tone": "neutral", "info": True},
                        {"id": "n12", "label": "N1+N2", "count": f"{high:.0f}%", "tone": "ok", "info": True},
                    ],
                },
                {
                    "key": "groups", "scope": "fixed", "title": "Dòng tiền theo nhóm",
                    "mainValue": f"{high:.0f}%", "unit": "N1+N2", "subtitle": note,
                    "subMetrics": [
                        {
                            "id": f"g{n}", "label": f"N{n}", "count": _fmt_money(pay_g[str(n)]),
                            "tone": "ok" if n <= 2 else "warn" if n == 4 else "neutral",
                            "patch": {"nhomthau": [str(n), f"N{n}"]},
                        }
                        for n in range(1, 6)
                    ],
                },
                {
                    "key": "cskcb", "scope": "fixed", "title": "Phủ CSKCB",
                    "mainValue": _fmt_int(len(facilities)), "unit": "cơ sở", "subtitle": note,
                    "subMetrics": [
                        {"id": "tw", "label": "TW / Hạng I", "count": _fmt_int(tw), "tone": "warn", "patch": {"_quick": "cskcb_tw"}},
                        {"id": "local", "label": "Tỉnh–Huyện", "count": _fmt_int(local), "tone": "ok", "patch": {"_quick": "cskcb_local"}},
                    ],
                    "segments": [
                        {"key": "t", "pct": tw / tier * 100, "color": "#7c3aed"},
                        {"key": "l", "pct": local / tier * 100, "color": "#94a3b8"},
                    ],
                },
                {
                    "key": "region", "scope": "fixed", "title": "Tỉnh dẫn đầu doanh thu",
                    "mainValue": _short(top["name"]) if top else "—",
                    "unit": _fmt_money(top["value"]) if top else "",
                    "subtitle": note,
                    "subMetrics": [
                        {"id": "prov_n", "label": "Số tỉnh", "count": _fmt_int(len(province_rows)), "tone": "neutral", "info": True},
                        {"id": "prov_share", "label": "Tỷ trọng", "count": f"{top['share']:.1f}%" if top else "—", "tone": "ok", "info": True},
                        {"id": "prov_total", "label": "Tổng", "count": _fmt_money(total_pay), "tone": "ok", "info": True},
                    ],
                    "explore": True,
                },
            ],
        }
        _save(con, "vss", payload)
        write_metadata(con, "vss_total", con.execute("SELECT COUNT(*) FROM bids").fetchone()[0])
        con.commit()
        return payload
    finally:
        con.close()


def refresh_dav() -> dict:
    note = "Toàn bộ danh mục"
    con = _con(DAV_DB)
    try:
        by_sdk = defaultdict(set)
        by_form = defaultdict(set)
        tags = {"xanh": 0, "vang": 0, "cam": 0, "xam": 0}
        new3 = new6 = new12 = expire6 = 0
        suggest = {field: set() for field in DAV_SUGGEST if field != "q"}
        now = datetime.now().timestamp() * 1000
        month = 30.4375 * 24 * 3600 * 1000
        total = 0
        cur = con.execute("SELECT raw FROM drugs")
        while True:
            rows = cur.fetchmany(1000)
            if not rows:
                break
            for (raw,) in rows:
                flat = dav.flatten(json.loads(raw))
                total += 1
                key = fold(flat.get("hoatChat") or "") or "—"
                sdk = str(flat.get("soDangKy") or flat.get("id") or "")
                by_sdk[key].add(sdk)
                by_form[key].add(fold(flat.get("dangBaoChe") or ""))
                tag = flat.get("tagId")
                if tag == "TAG_XANH_LA":
                    tags["xanh"] += 1
                elif tag == "TAG_CAM_CMO":
                    tags["cam"] += 1
                elif tag == "TAG_XAM_LICH_SU":
                    tags["xam"] += 1
                else:
                    tags["vang"] += 1
                issued = flat.get("ngayCap")
                if issued:
                    try:
                        # Windows rejects timestamps far outside 1970–3000.
                        stamp = datetime.fromisoformat(str(issued)[:10]).timestamp() * 1000
                    except (ValueError, OSError):
                        stamp = None
                    if stamp is not None and 0 <= now - stamp:
                        age = now - stamp
                        if age <= 3 * month:
                            new3 += 1
                        if age <= 6 * month:
                            new6 += 1
                        if age <= 12 * month:
                            new12 += 1
                left = flat.get("monthsLeft")
                if left is not None and 0 <= float(left) <= 6:
                    expire6 += 1
                for field, attr in DAV_SUGGEST.items():
                    if field == "q":
                        continue
                    value = str(flat.get(attr) or "").strip()
                    if value:
                        suggest[field].add(value)
        blue = mid = red = 0
        for values in by_sdk.values():
            n = len(values)
            if n <= 2:
                blue += 1
            elif n <= 5:
                mid += 1
            else:
                red += 1
        forms = {1: 0, 2: 0, 3: 0, "4+": 0}
        for values in by_form.values():
            n = len({v for v in values if v})
            if n <= 1:
                forms[1] += 1
            elif n == 2:
                forms[2] += 1
            elif n == 3:
                forms[3] += 1
            else:
                forms["4+"] += 1
        form_total = sum(forms.values())
        con.execute("DELETE FROM suggest_values WHERE section = 'dav'")
        for field, values in suggest.items():
            con.executemany(
                "INSERT OR IGNORE INTO suggest_values (section, field, value) VALUES ('dav', ?, ?)",
                [(field, value) for value in values],
            )
        payload = {
            "section": "dav",
            "total": total,
            "sampleSize": total,
            "updatedAt": now_iso(),
            "fixed": True,
            "cards": [
                {
                    "key": "density", "scope": "fixed", "title": "Mật độ SĐK/HC",
                    "mainValue": _fmt_int(blue), "unit": "hoạt chất 1–2 SĐK", "subtitle": note,
                    "subMetrics": [
                        {"id": "sdk_1_2", "label": "1–2 SĐK", "count": _fmt_int(blue), "tone": "ok", "patch": {"ingredientCount": "1-2"}},
                        {"id": "sdk_3_5", "label": "3–5 SĐK", "count": _fmt_int(mid), "tone": "warn", "patch": {"ingredientCount": "3-5"}},
                        {"id": "sdk_red", "label": ">5 SĐK", "count": _fmt_int(red), "tone": "danger", "patch": {"ingredientCount": "6+"}},
                    ],
                },
                {
                    "key": "tags", "scope": "fixed", "title": "Tag hồ sơ",
                    "mainValue": _fmt_int(tags["xanh"]), "unit": "SĐK xanh", "subtitle": note,
                    "subMetrics": [
                        {"id": "tag_xanh", "label": "Sẵn sàng dự thầu", "count": _fmt_int(tags["xanh"]), "tone": "ok", "patch": {"_tag": "TAG_XANH_LA"}},
                        {"id": "tag_vang", "label": "Cần xác minh", "count": _fmt_int(tags["vang"]), "tone": "warn", "patch": {"_tag": "TAG_VANG_XAC_MINH"}},
                        {"id": "tag_cam", "label": "Bẫy DM93", "count": _fmt_int(tags["cam"]), "tone": "danger", "patch": {"_tag": "TAG_CAM_CMO"}},
                        {"id": "tag_xam", "label": "Đã hết hạn", "count": _fmt_int(tags["xam"]), "tone": "neutral", "patch": {"_tag": "TAG_XAM_LICH_SU"}},
                    ],
                },
                {
                    "key": "forms", "scope": "fixed", "title": "Dạng bào chế / hoạt chất",
                    "mainValue": _fmt_int(form_total), "unit": "HC", "subtitle": note,
                    "subMetrics": [
                        {"id": "form_1", "label": "1 dạng", "count": _fmt_int(forms[1]), "tone": "ok", "patch": {"dosageFormCount": "1"}},
                        {"id": "form_2", "label": "2 dạng", "count": _fmt_int(forms[2]), "tone": "warn", "patch": {"dosageFormCount": "2"}},
                        {"id": "form_3", "label": "3 dạng", "count": _fmt_int(forms[3]), "tone": "warn", "patch": {"dosageFormCount": "3"}},
                        {"id": "form_4", "label": "4+ dạng", "count": _fmt_int(forms["4+"]), "tone": "danger", "patch": {"dosageFormCount": "4"}},
                    ],
                },
                {
                    "key": "new", "scope": "fixed", "title": "SĐK mới cấp",
                    "mainValue": _fmt_int(new12), "unit": "trong 12 tháng", "subtitle": note,
                    "subMetrics": [
                        {"id": "new_3", "label": "3 tháng", "count": _fmt_int(new3), "tone": "ok", "info": True},
                        {"id": "new_6", "label": "6 tháng", "count": _fmt_int(new6), "tone": "ok", "info": True},
                        {"id": "new_12", "label": "12 tháng", "count": _fmt_int(new12), "tone": "neutral", "info": True},
                        {"id": "expire_6m", "label": "Sắp hết hạn", "count": _fmt_int(expire6), "tone": "danger", "info": True},
                    ],
                },
            ],
        }
        _save(con, "dav", payload)
        write_metadata(con, "dav_total", total)
        con.commit()
        return payload
    finally:
        con.close()


def read_metrics(section: str) -> dict | None:
    path = VSS_DB if section == "vss" else DAV_DB
    if section not in {"vss", "dav"} or not path.exists():
        return None
    con = _con(path)
    try:
        row = con.execute("SELECT payload FROM app_metrics WHERE section = ?", (section,)).fetchone()
    finally:
        con.close()
    if not row:
        return None
    return json.loads(row[0])


def suggest(section: str, field: str, q: str, limit: int = 8) -> list[str]:
    path = VSS_DB if section == "vss" else DAV_DB if section == "dav" else None
    if path is None or not path.exists():
        return []
    if field == "q":
        field = "tenThuoc" if section == "dav" else "ten"
    needle = str(q or "").strip()
    if len(needle) < 2:
        return []
    limit = max(1, min(12, int(limit)))
    con = _con(path)
    try:
        prefix = con.execute(
            "SELECT value FROM suggest_values WHERE section = ? AND field = ? AND value LIKE ? LIMIT ?",
            (section, field, f"{needle}%", limit),
        ).fetchall()
        found = [_clean_suggest(row[0]) for row in prefix]
        found = [text for text in found if text]
        if len(found) >= 3:
            return found[:limit]
        contains = con.execute(
            "SELECT value FROM suggest_values WHERE section = ? AND field = ? AND value LIKE ? LIMIT ?",
            (section, field, f"%{needle}%", limit),
        ).fetchall()
    finally:
        con.close()
    seen = []
    for text in found + [_clean_suggest(row[0]) for row in contains]:
        if text and text not in seen:
            seen.append(text)
        if len(seen) >= limit:
            break
    return seen


def _clean_suggest(value) -> str:
    return " ".join(str(value or "").split())
