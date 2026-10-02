# -*- coding: utf-8 -*-
"""Aggregates for the Vietnam map.

MSC location fields in the local store:
tenders.locations[] and prices.diaDiem[] carry provCode, provName, districtCode, districtName.
Winner fields on tender raw JSON: winningContractorName, winningCode, bidWinningPrice.
procuringEntityName is present and used when investorName is empty.
The feed has no latitude, longitude, street address, or wardName.
Dots stay province-level; the client offsets them from the real province centroid.
"""
from __future__ import annotations

import json
import sqlite3
import time

from .baoan_match import exact_hits, msc_price_lot, public_lines
from .common import MSC_DB, VSS_DB, fold
from .metric_slice import (
    PROVINCES,
    _group,
    _heat_rows,
    _in_span,
    _msc_rows,
    _num,
    _parse_dt,
    _vss_sql,
    _window,
    province_label,
)

REGION_ORDER = [
    "Tây Bắc",
    "Đông Bắc",
    "Đồng bằng sông Hồng",
    "Bắc Trung Bộ",
    "Nam Trung Bộ",
    "Tây Nguyên",
    "Đông Nam Bộ",
    "Đồng bằng sông Cửu Long",
]
REGION_CODES = {
    "Tây Bắc": ["11", "12", "14", "17"],
    "Đông Bắc": ["02", "04", "06", "08", "10", "15", "19", "20", "22", "24", "25"],
    "Đồng bằng sông Hồng": ["01", "26", "27", "30", "31", "33", "34", "35", "36", "37"],
    "Bắc Trung Bộ": ["38", "40", "42", "44", "45", "46"],
    "Nam Trung Bộ": ["48", "49", "51", "52", "54", "56", "58", "60"],
    "Tây Nguyên": ["62", "64", "66", "67", "68"],
    "Đông Nam Bộ": ["70", "72", "74", "75", "77", "79"],
    "Đồng bằng sông Cửu Long": ["80", "82", "83", "84", "86", "87", "89", "91", "92", "93", "94", "95", "96"],
}
REGION_BY_CODE = {code: name for name, codes in REGION_CODES.items() for code in codes}

LOCATION_NOTE = (
    "MSC lưu locations và diaDiem với provName, districtName. "
    "Không có lat/lng, địa chỉ đường hay wardName trong dữ liệu đã tải. "
    "Chấm đặt theo trọng tâm tỉnh; nhiều chủ đầu tư cùng tỉnh được tách bằng độ lệch cố định."
)
STATUS_LABEL = {
    "open": "Đang mời thầu",
    "review": "Đang xét kết quả",
    "closed": "Vừa đóng thầu",
}
_MEMO: dict = {"key": "", "at": 0.0, "payload": None}
DOT_CAP = 450


def region_of(code: str) -> str:
    key = str(code or "").strip()
    if key.isdigit() and len(key) <= 2:
        key = key.zfill(2)
    return REGION_BY_CODE.get(key, "")


def _norm_place(text: str) -> str:
    token = fold(text).replace("-", " ").replace(".", " ")
    token = " ".join(token.split())
    for prefix in ("tinh ", "thanh pho ", "tp "):
        if token.startswith(prefix):
            token = token[len(prefix):].strip()
    return token


_BY_NAME = {_norm_place(name): code for code, name in PROVINCES.items()}
_BY_NAME.update({
    "tp ho chi minh": "79",
    "tphcm": "79",
    "hcm": "79",
    "sai gon": "79",
    "hue": "46",
    "ba ria vung tau": "77",
    "dac lak": "66",
    "daklak": "66",
    "dac nong": "67",
})


def resolve_province(name: str = "", code: str = "") -> tuple[str, str]:
    key = str(code or "").strip()
    if key.isdigit() and len(key) <= 2:
        key = key.zfill(2)
    if key in PROVINCES:
        return key, PROVINCES[key]
    found = _BY_NAME.get(_norm_place(name))
    if found:
        return found, PROVINCES[found]
    label = str(name or "").strip()
    return "", label or "Chưa xác định tỉnh"


def read_location(raw) -> dict:
    locs = raw
    if isinstance(raw, str):
        try:
            locs = json.loads(raw) if raw else []
        except json.JSONDecodeError:
            locs = []
    if isinstance(locs, dict):
        locs = [locs]
    if not isinstance(locs, list):
        locs = []
    loc = next((item for item in locs if isinstance(item, dict)), {})
    district = str(loc.get("districtName") or "").strip()
    return {
        "provCode": str(loc.get("provCode") or "").strip(),
        "provName": str(loc.get("provName") or "").strip(),
        "district": district,
        "precision": "province",
    }


def text_name(value) -> str:
    text = "" if value is None else str(value).strip()
    if text[:1] in "[{":
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return text
        if isinstance(parsed, list):
            return "; ".join(str(item).strip() for item in parsed if str(item).strip())
        if isinstance(parsed, dict):
            return str(parsed.get("name") or parsed.get("contractorName") or "").strip()
    return text


def place_note(district: str, *, source: str) -> str:
    if source == "vss":
        return "Mức tỉnh. VSS có mã tỉnh và tên cơ sở, không có tọa độ."
    if district:
        return f"Mức tỉnh. Hồ sơ có huyện/xã: {district}. Chưa có tọa độ đường phố."
    return "Mức tỉnh. Hồ sơ chỉ có tỉnh, chưa có tọa độ."


def wanted_status(raw: str) -> str:
    """Map a UI status value onto open / review / closed.

    Open tenders are empty status_code with a future or unknown close
    (bidStatus.js OPEN), the literal code OPEN, or the labels
    đang mời thầu / đang lựa chọn nhà thầu.
    """
    token = fold(raw)
    if not token:
        return ""
    if token in {"open", "opening"} or "moi thau" in token or "lua chon nha thau" in token:
        return "open"
    if token in {"review", "dxt"} or token.startswith("dang xet"):
        return "review"
    if token in {"closed", "cnttt"} or "vua dong" in token:
        return "closed"
    return token


def keep_for_status(kind: str | None, status_filter: str) -> bool:
    if not kind:
        return False
    need = wanted_status(status_filter)
    return not need or kind == need


def classify_package(code: str, close_raw, now, window_start, winner: str) -> str | None:
    status = str(code or "").strip().upper()
    close = _parse_dt(close_raw)
    if status in {"DHTBMT", "DHT", "DHKQLCNT", "KCNTTT", "VHH"}:
        return None
    # Literal OPEN is still inviting, even when the close date has passed.
    if status == "OPEN":
        return "open"
    if status == "DXT" or (not status and close is not None and close < now):
        if close is not None and close < window_start:
            return None
        return "review"
    if status == "CNTTT":
        if close is None or close < window_start or close > now:
            return None
        if not str(winner or "").strip():
            return None
        return "closed"
    if not status and (close is None or close >= now):
        return "open"
    return None


def _pair_row(item) -> tuple[str, float, float, dict | None]:
    name = item[0]
    value = item[1] if len(item) > 1 else 0
    quantity = item[2] if len(item) > 2 else 0
    lot = item[3] if len(item) > 3 and isinstance(item[3], dict) else None
    return name, value, quantity, lot


def _merge_exact(slot: dict, lot: dict | None) -> None:
    if not lot:
        return
    seen = slot.setdefault("_hit_keys", set())
    bucket = slot.setdefault("baoanHits", [])
    for card in exact_hits(lot):
        key = str(card.get("reg") or card.get("brand") or "")
        if not key or key in seen:
            continue
        seen.add(key)
        bucket.append(card)


def rank_ingredients(pairs, limit: int = 60, *, keep_matches: bool = False) -> list[dict]:
    """Top ingredients by value.

    keep_matches also keeps lines with exact Bảo An khớp outside the value cap,
    so a khớp package still lists Ofloxacin even when pricier lines fill the top.
    """
    buckets: dict[str, dict] = {}
    for item in pairs:
        name, value, quantity, lot = _pair_row(item)
        label = " ".join(str(name or "").split())
        if not label:
            continue
        key = fold(label)
        slot = buckets.setdefault(key, {"name": label, "value": 0.0, "quantity": 0.0})
        slot["value"] += float(value or 0)
        slot["quantity"] += float(quantity or 0)
        _merge_exact(slot, lot)
    ranked = sorted(buckets.values(), key=lambda row: (row["value"], row["quantity"]), reverse=True)
    if not keep_matches:
        ranked = ranked[:limit]
    for row in ranked:
        row.setdefault("baoanHits", [])
        row.pop("_hit_keys", None)
    if not keep_matches:
        return ranked
    head = ranked[:limit]
    extras = [row for row in ranked[limit:] if row.get("baoanHits")]
    return head + extras[:24]


def area_ingredient_lists(coded_pairs, limit: int = 40) -> dict:
    """coded_pairs: (province code, ingredient, value, quantity[, lot dict])."""
    by_code: dict[str, list] = {}
    national = []
    for row in coded_pairs:
        code = row[0]
        name = row[1]
        value = row[2]
        quantity = row[3]
        lot = row[4] if len(row) > 4 and isinstance(row[4], dict) else None
        key = str(code or "").strip()
        key = key.zfill(2) if key.isdigit() else key
        national.append((name, value, quantity, lot))
        if key:
            by_code.setdefault(key, []).append((name, value, quantity, lot))
    areas = {code: rank_ingredients(pairs, limit) for code, pairs in by_code.items()}
    by_region: dict[str, list] = {}
    for code, pairs in by_code.items():
        region = region_of(code)
        if not region:
            continue
        by_region.setdefault(region, []).extend(pairs)
    for region, pairs in by_region.items():
        areas[region] = rank_ingredients(pairs, limit)
    return {"national": rank_ingredients(national, 60), "areas": areas}


def _month_of(*raws) -> str:
    for raw in raws:
        stamp = _parse_dt(raw)
        if stamp is not None:
            return f"{stamp.year}-{stamp.month:02d}"
    return ""


def _month_keys(start, end) -> list[str]:
    keys = []
    year, month = start.year, start.month
    while (year, month) <= (end.year, end.month):
        keys.append(f"{year}-{month:02d}")
        month += 1
        if month == 13:
            month = 1
            year += 1
    return keys


def _blank(code: str, name: str) -> dict:
    return {
        "code": code,
        "name": name,
        "region": region_of(code),
        "value": 0.0,
        "prev": 0.0,
        "lots": 0,
        "facilities": 0,
        "groups": [0.0, 0.0, 0.0, 0.0, 0.0],
        "month_values": {},
        "_facilities": set(),
    }


def _code_set(filters: dict) -> set[str]:
    raw = []
    for key in ("ma_tinh", "provinces"):
        value = filters.get(key)
        if isinstance(value, list):
            raw.extend(value)
        elif str(value or "").strip():
            raw.append(value)
    one = str(filters.get("province") or "").strip()
    if one:
        raw.append(one)
    codes = set()
    for item in raw:
        key = str(item or "").strip()
        if key.isdigit():
            codes.add(key.zfill(2))
    region_name = str(filters.get("region") or "").strip()
    if region_name:
        region_codes = set(REGION_CODES.get(region_name, []))
        codes = region_codes if not codes else (codes & region_codes)
    return codes


def _group_set(filters: dict) -> set[str]:
    raw = []
    value = filters.get("nhomthau")
    if isinstance(value, list):
        raw.extend(value)
    elif str(value or "").strip():
        raw.append(value)
    one = str(filters.get("group") or "").strip()
    if one:
        raw.append(one)
    return {group for group in (_group(item) for item in raw) if group}


def _name_needles(filters: dict) -> list[str]:
    raw = filters.get("ten_tinh") or []
    if isinstance(raw, str):
        raw = [raw] if raw.strip() else []
    return [fold(item) for item in raw if str(item or "").strip()]


def _seed_buckets(province_codes: set[str], region_name: str) -> dict[str, dict]:
    buckets = {}
    for code, name in PROVINCES.items():
        if province_codes and code not in province_codes:
            continue
        if region_name and region_of(code) != region_name:
            continue
        buckets[code] = _blank(code, name)
    return buckets


def _add_amount(bucket: dict, stamp, amount: float, lots: int, group: str | None, current: bool, previous: bool):
    if current:
        bucket["value"] += amount
        bucket["lots"] += lots
        if group:
            bucket["groups"][int(group) - 1] += amount
        if stamp is not None:
            key = f"{stamp.year}-{stamp.month:02d}"
            bucket["month_values"][key] = bucket["month_values"].get(key, 0.0) + amount
    elif previous:
        bucket["prev"] += amount


def _finalize(bucket: dict, keys: list[str]) -> dict:
    prev = float(bucket["prev"])
    cur = float(bucket["value"])
    yoy = ((cur - prev) / prev * 100) if prev > 0 else (None if cur > 0 else 0)
    trend = [{"key": key, "value": float(bucket["month_values"].get(key) or 0)} for key in keys]
    return {
        "code": bucket["code"],
        "name": bucket["name"],
        "region": bucket["region"],
        "value": cur,
        "prev": prev,
        "yoy": yoy,
        "lots": int(bucket["lots"]),
        "facilities": int(bucket["facilities"] or len(bucket.get("_facilities") or ())),
        "activeMonths": sum(1 for point in trend if point["value"] > 0),
        "trend": trend,
        "groups": [float(v) for v in bucket["groups"]],
    }


def _rollup(items: list[dict], keys: list[str], *, code: str, name: str, region: str) -> dict:
    bucket = _blank(code, name)
    bucket["region"] = region
    for item in items:
        bucket["value"] += float(item.get("value") or 0)
        bucket["prev"] += float(item.get("prev") or 0)
        bucket["lots"] += int(item.get("lots") or 0)
        bucket["facilities"] += int(item.get("facilities") or 0)
        for index, amount in enumerate(item.get("groups") or []):
            bucket["groups"][index] += float(amount or 0)
        for point in item.get("trend") or []:
            bucket["month_values"][point["key"]] = bucket["month_values"].get(point["key"], 0.0) + float(point.get("value") or 0)
    return _finalize(bucket, keys)


def _vss_rows(filters: dict):
    rows = _heat_rows(filters)
    if rows is None:
        rows = _vss_sql(filters)
    return rows or []


def _vss_where(filters: dict, start, end):
    clauses = ["coalesce(tungay_hd,'') >= ?", "coalesce(tungay_hd,'') <= ?"]
    args: list = [start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d 23:59:59")]
    token = fold(filters.get("hoatchat") or "")
    if token:
        clauses.append("fold(coalesce(hoatchat,'')) LIKE ?")
        args.append(f"%{token}%")
    groups = _group_set(filters)
    if groups:
        parts = []
        for group in sorted(groups):
            parts.append("fold(coalesce(nhomthau,'')) LIKE ?")
            args.append(f"%{group}%")
        clauses.append("(" + " OR ".join(parts) + ")")
    codes = _code_set(filters)
    if codes:
        slots = []
        for code in sorted(codes):
            slots.extend([code, str(int(code))])
        clauses.append("coalesce(ma_tinh,'') IN (" + ",".join("?" * len(slots)) + ")")
        args.extend(slots)
    for needle in _name_needles(filters):
        clauses.append("fold(coalesce(json_extract(raw,'$.ten_tinh'),'')) LIKE ?")
        args.append(f"%{needle}%")
    query = fold(filters.get("q") or "")
    if query:
        for word in query.split():
            clauses.append("search LIKE ?")
            args.append(f"%{word}%")
    return " WHERE " + " AND ".join(clauses), args


def _vss_ingredients(filters: dict, start, end):
    if not VSS_DB.exists():
        return {"national": [], "areas": {}}
    where, args = _vss_where(filters, start, end)
    con = sqlite3.connect(f"file:{VSS_DB}?mode=ro", uri=True)
    try:
        con.create_function("fold", 1, fold)
        rows = con.execute(
            f"""
            SELECT coalesce(ma_tinh, ''),
                   coalesce(hoatchat, ''),
                   sum(coalesce(cast(json_extract(raw,'$.thanhtien') AS real), 0)),
                   sum(coalesce(cast(json_extract(raw,'$.soluong') AS real), 0))
            FROM bids
            {where}
            GROUP BY coalesce(ma_tinh, ''), fold(coalesce(hoatchat, ''))
            """,
            args,
        ).fetchall()
    finally:
        con.close()
    return area_ingredient_lists(rows)


def _vss_facilities(filters: dict, start, end, limit: int = 220, with_dots: bool = True):
    if not VSS_DB.exists():
        return {}, [], []
    where, args = _vss_where(filters, start, end)
    con = sqlite3.connect(f"file:{VSS_DB}?mode=ro", uri=True)
    try:
        con.create_function("fold", 1, fold)
        counts = {
            (str(code).zfill(2) if str(code).isdigit() else str(code)): int(count or 0)
            for code, count in con.execute(
                f"""
                SELECT coalesce(ma_tinh,''),
                       count(DISTINCT coalesce(json_extract(raw,'$.ma_cskcb'), json_extract(raw,'$.ten_cskcb')))
                FROM bids
                {where}
                GROUP BY 1
                """,
                args,
            )
        }
        dots = []
        by_province = []
        if with_dots:
            dots = con.execute(
                f"""
                SELECT coalesce(json_extract(raw,'$.ma_cskcb'), ''),
                       max(coalesce(json_extract(raw,'$.ten_cskcb'), '')),
                       coalesce(ma_tinh, ''),
                       max(coalesce(json_extract(raw,'$.ten_tinh'), '')),
                       sum(coalesce(cast(json_extract(raw,'$.thanhtien') AS real), 0)),
                       count(*)
                FROM bids
                {where}
                GROUP BY 1, 3
                ORDER BY 5 DESC
                LIMIT ?
                """,
                [*args, limit],
            ).fetchall()
            by_province = con.execute(
                f"""
                SELECT fac, name, code, province, value, lots FROM (
                    SELECT coalesce(json_extract(raw,'$.ma_cskcb'), '') AS fac,
                           max(coalesce(json_extract(raw,'$.ten_cskcb'), '')) AS name,
                           coalesce(ma_tinh, '') AS code,
                           max(coalesce(json_extract(raw,'$.ten_tinh'), '')) AS province,
                           sum(coalesce(cast(json_extract(raw,'$.thanhtien') AS real), 0)) AS value,
                           count(*) AS lots,
                           row_number() OVER (
                               PARTITION BY coalesce(ma_tinh, '')
                               ORDER BY sum(coalesce(cast(json_extract(raw,'$.thanhtien') AS real), 0)) DESC
                           ) AS rn
                    FROM bids
                    {where}
                    GROUP BY 1, 3
                ) WHERE rn <= 20
                """,
                args,
            ).fetchall()
    finally:
        con.close()
    return counts, dots, by_province


def _build_vss(filters: dict, months: int, *, with_dots: bool = True, with_ingredients: bool = True) -> dict:
    months, now, cur_from, prev_from, prev_end = _window(months)
    keys = _month_keys(cur_from, now)
    province_codes = _code_set(filters)
    region_name = str(filters.get("region") or "").strip()
    group_need = _group_set(filters)
    name_needles = _name_needles(filters)
    sql_filters = {"hoatchat": filters.get("hoatchat") or ""}
    buckets = _seed_buckets(province_codes, region_name)
    for code, ym, grp, value, cnt, name in _vss_rows(sql_filters):
        stamp = _parse_dt(f"{ym}-01" if ym and len(str(ym)) == 7 else "")
        if stamp is None:
            continue
        current = _in_span(stamp, cur_from, now)
        previous = _in_span(stamp, prev_from, prev_end)
        if not current and not previous:
            continue
        key = str(code or "").strip()
        key = key.zfill(2) if key.isdigit() else key
        if key not in buckets:
            if province_codes or region_name:
                continue
            buckets[key] = _blank(key, province_label(key, name or ""))
        group = _group(grp)
        if group_need and group not in group_need:
            continue
        label = province_label(key, name or "")
        if name_needles and not any(needle in fold(label) for needle in name_needles):
            continue
        bucket = buckets[key]
        if name:
            bucket["name"] = label
        _add_amount(bucket, stamp, float(value or 0), int(cnt or 0), group, current, previous)
    counts, raw_dots, area_rows = _vss_facilities(filters, cur_from, now, with_dots=with_dots)
    for code, count in counts.items():
        if province_codes and code not in province_codes:
            continue
        if region_name and region_of(code) != region_name:
            continue
        if code in buckets:
            buckets[code]["facilities"] = count
    provinces = [_finalize(bucket, keys) for bucket in buckets.values()]
    provinces.sort(key=lambda row: row["value"], reverse=True)
    regions = [
        _rollup([row for row in provinces if row["region"] == name], keys, code=name, name=name, region=name)
        for name in REGION_ORDER
        if not region_name or name == region_name
    ]
    dots = []
    seen = set()
    national_ids = set()
    area_ids = set()
    for is_national, row in [(True, row) for row in raw_dots] + [(False, row) for row in area_rows]:
        fac_code, fac_name, raw_code, raw_name, value, lots = row
        code, label = resolve_province(raw_name or "", raw_code or "")
        if province_codes and code not in province_codes:
            continue
        if region_name and region_of(code) != region_name:
            continue
        name = str(fac_name or "").strip()
        if not name:
            continue
        dot_id = f"{code}:{fac_code or name}"
        if is_national:
            national_ids.add(dot_id)
        else:
            area_ids.add(dot_id)
        if dot_id in seen:
            continue
        seen.add(dot_id)
        dots.append({
            "id": dot_id,
            "kind": "facility",
            "ingredients": [],
            "name": name,
            "buyer": name,
            "province": label,
            "provinceCode": code,
            "region": region_of(code),
            "district": "",
            "precision": "province",
            "placeNote": place_note("", source="vss"),
            "value": float(value or 0),
            "lots": int(lots or 0),
            "status": "",
            "statusLabel": "Cơ sở y tế",
        })
    if with_ingredients:
        _attach_vss_ingredients(dots, filters, cur_from, now)
    area_dots = {}
    for dot in dots:
        if dot["id"] in area_ids:
            area_dots.setdefault(dot["provinceCode"], []).append(dot)
    for rows in area_dots.values():
        rows.sort(key=lambda item: item["value"], reverse=True)
    dots = [dot for dot in dots if dot["id"] in national_ids]
    summary = _rollup(provinces, keys, code="", name="Bộ lọc hiện tại", region=region_name)
    lists = _vss_ingredients(filters, cur_from, now) if with_ingredients else {"national": [], "areas": {}}
    return _payload(
        "vss", months, summary, provinces, regions, dots, len(dots), lists,
        title="Hoạt chất trúng thầu",
        note="Giá trị là thành tiền trúng thầu. Số lượng là tổng số lượng trúng.",
        value_label="Giá trị",
        qty_label="Số lượng",
        area_dots=area_dots,
    )


def _attach_vss_ingredients(dots, filters, start, end):
    """Top ingredients for each facility card, so the list follows the clicked site."""
    if not dots or not VSS_DB.exists():
        return
    lookup = {}
    for dot in dots:
        fac = dot["id"].split(":", 1)[1] if ":" in dot["id"] else ""
        lookup[(dot.get("provinceCode") or "", fac)] = dot["id"]
    where, args = _vss_where(filters, start, end)
    con = sqlite3.connect(f"file:{VSS_DB}?mode=ro", uri=True)
    try:
        con.create_function("fold", 1, fold)
        rows = con.execute(
            f"""
            SELECT coalesce(json_extract(raw,'$.ma_cskcb'), ''),
                   coalesce(ma_tinh, ''),
                   coalesce(hoatchat, ''),
                   sum(coalesce(cast(json_extract(raw,'$.thanhtien') AS real), 0)),
                   sum(coalesce(cast(json_extract(raw,'$.soluong') AS real), 0))
            FROM bids
            {where}
            GROUP BY 1, 2, fold(coalesce(hoatchat, ''))
            """,
            args,
        ).fetchall()
    finally:
        con.close()
    grouped: dict[str, list] = {}
    for fac, raw_code, name, value, qty in rows:
        key = str(raw_code or "").strip()
        key = key.zfill(2) if key.isdigit() else key
        dot_id = lookup.get((key, str(fac or "").strip()))
        if not dot_id:
            continue
        grouped.setdefault(dot_id, []).append((name, value, qty))
    for dot in dots:
        dot["ingredients"] = rank_ingredients(grouped.get(dot["id"]) or [], 15)


def _scope_lots_index() -> tuple[dict, dict]:
    """notify_id → lots JSON; tender_no → notify_id."""
    if not MSC_DB.exists():
        return {}, {}
    con = sqlite3.connect(f"file:{MSC_DB}?mode=ro", uri=True)
    try:
        lots_by_id = {
            nid: json.loads(raw)
            for nid, raw in con.execute("SELECT notify_id, lots FROM scope_lots")
        }
        by_no = {}
        try:
            for nid, tender_no in con.execute("SELECT notify_id, tender_no FROM scope_match"):
                number = str(tender_no or "").strip()
                if number and nid:
                    by_no[number] = nid
        except sqlite3.OperationalError:
            by_no = {}
    finally:
        con.close()
    return lots_by_id, by_no


def _ingredient_from_scope_line(row: dict) -> dict:
    """One MSC scope row — same shape as MSC gói thầu scope_lines."""
    qty = _num(row.get("qty"))
    unit_price = _num(row.get("price"))
    value = unit_price * qty if unit_price and qty else unit_price
    match = str(row.get("match") or "").strip()
    hits = list(row.get("hits") or [])
    card_hits = [
        {
            "brand": hit.get("brand") or "",
            "strength": hit.get("strength") or "",
            "form": hit.get("form") or "",
            "reg": hit.get("reg") or "",
        }
        for hit in hits
        if isinstance(hit, dict)
    ]
    return {
        "name": str(row.get("name") or "").strip(),
        "strength": str(row.get("strength") or "").strip(),
        "form": str(row.get("form") or "").strip(),
        "value": value,
        "quantity": qty,
        "match": match,
        "baoanHits": card_hits if match in ("exact", "near") else [],
    }


def _ingredients_from_price_rows(pairs: list) -> list[dict]:
    """Awarded price lines — one row per price, not merged by hoạt chất name."""
    lines = []
    for item in pairs:
        name, value, quantity, lot = _pair_row(item)
        label = " ".join(str(name or "").split())
        if not label:
            continue
        hits = exact_hits(lot) if lot else []
        lines.append({
            "name": label,
            "strength": str((lot or {}).get("nongDo") or "").strip(),
            "form": str((lot or {}).get("dangBaoChe") or "").strip(),
            "value": float(value or 0),
            "quantity": float(quantity or 0),
            "match": "exact" if hits else "",
            "baoanHits": hits,
        })
    lines.sort(key=lambda row: (row["value"], row["quantity"]), reverse=True)
    return lines


def _attach_msc_ingredients(dots, price_pairs, scope_detailed, tender_meta=None):
    """Full phạm vi gói (scope_lots) when cached — same list as MSC gói thầu."""
    from .msc_scope import notify_id

    lots_by_id, by_no = _scope_lots_index()
    grouped: dict[str, list] = {}
    for row in price_pairs:
        number = str(row[4] or "").strip() if len(row) > 4 else ""
        if not number:
            continue
        lot = row[5] if len(row) > 5 and isinstance(row[5], dict) else None
        grouped.setdefault(number, []).append((row[1], row[2], row[3], lot))
    meta = tender_meta or {}
    for dot in dots:
        if str(dot.get("kind") or "") != "package":
            continue
        number = str(dot.get("tenderNo") or "").strip()
        row_meta = meta.get(number) or {}
        nid = by_no.get(number) or notify_id({
            "source_url": dot.get("sourceUrl") or row_meta.get("source_url") or "",
            "source_id": dot.get("id") or row_meta.get("source_id") or "",
        })
        lots = [lot for lot in (lots_by_id.get(nid) or []) if isinstance(lot, dict)]
        if lots:
            scope_rows = public_lines(lots)
            dot["scopeLines"] = scope_rows
            dot["ingredients"] = [_ingredient_from_scope_line(r) for r in scope_rows]
            continue
        dot["scopeLines"] = []
        dot["ingredients"] = _ingredients_from_price_rows(grouped.get(number) or [])


def _build_msc(filters: dict, months: int, *, with_ingredients: bool = True) -> dict:
    months, now, cur_from, prev_from, prev_end = _window(months)
    keys = _month_keys(cur_from, now)
    province_codes = _code_set(filters)
    region_name = str(filters.get("region") or "").strip()
    group_need = _group_set(filters)
    status_need = str(filters.get("status") or "")
    query = fold(filters.get("q") or "")
    needle = fold(filters.get("hoatchat") or "")
    buckets = _seed_buckets(province_codes, region_name)
    ingredient_ids = set() if needle else None
    group_ids = set() if group_need else None
    ingredient_pairs = []
    for item in _msc_rows("prices"):
        ingredient_ok = not needle or needle in fold(item.get("ingredient") or "")
        group = _group(item.get("group_name"))
        group_ok = not group_need or group in group_need
        tender_no = str(item.get("tender_no") or "").strip()
        if ingredient_ids is not None and ingredient_ok and tender_no:
            ingredient_ids.add(tender_no)
        if group_ids is not None and group_ok and tender_no:
            group_ids.add(tender_no)
        if not ingredient_ok or not group_ok:
            continue
        stamp = _parse_dt(item.get("published") or item.get("decision_date"))
        current = _in_span(stamp, cur_from, now)
        previous = _in_span(stamp, prev_from, prev_end)
        if not current and not previous:
            continue
        code, label = resolve_province(item.get("province") or "")
        if not code:
            continue
        if code not in buckets:
            continue
        qty = _num(item.get("quantity"))
        amount = qty * _num(item.get("unit_price"))
        bucket = buckets[code]
        if label:
            bucket["name"] = label
        _add_amount(bucket, stamp, amount, 1 if current else 0, group, current, previous)
        if current:
            if with_ingredients:
                ingredient_pairs.append((code, item.get("ingredient"), amount, qty, tender_no, msc_price_lot(item)))
            buyer = str(item.get("buyer") or "").strip()
            if buyer:
                bucket["_facilities"].add(fold(buyer))
    named = [_finalize(bucket, keys) for bucket in buckets.values()]
    _kept, matched, allowed_tenders, tender_meta, packages, package_areas, package_total = _msc_dots(
        now, cur_from, province_codes, region_name, status_need, query, needle, ingredient_ids, group_ids,
    )
    if status_need:
        ingredient_pairs = [row for row in ingredient_pairs if row[4] in allowed_tenders]
    price_rows = [(row[0], row[1], row[2], row[3], row[5] if len(row) > 5 else None) for row in ingredient_pairs]
    covered = {row[4] for row in ingredient_pairs if row[4]}
    missing = {
        number: meta for number, meta in tender_meta.items() if number not in covered
    } if status_need else {}
    scope_detailed = _scope_ingredient_pairs(missing, needle) if with_ingredients else []
    scope_rows = [(row[0], row[1], row[2], row[3], row[5] if len(row) > 5 else None) for row in scope_detailed]
    if with_ingredients:
        shown = []
        seen = set()
        for dot in [*packages, *[item for rows in package_areas.values() for item in rows]]:
            key = dot.get("id")
            if key in seen:
                continue
            seen.add(key)
            shown.append(dot)
        _attach_msc_ingredients(shown, ingredient_pairs, scope_detailed, tender_meta)
    investors, investor_areas, investor_total = _investor_directory(tender_meta, ingredient_pairs, scope_detailed)
    if price_rows and scope_rows:
        title = "Hoạt chất trong gói thầu"
        note = "Có đơn giá trúng thì lấy số lượng × đơn giá. Gói chưa có đơn giá lấy giá dự toán phần trong phạm vi."
        value_label, qty_label = "Giá trị", "Số lượng"
    elif scope_rows:
        title = "Hoạt chất trong gói thầu"
        note = "Giá trị là giá dự toán phần trong phạm vi gói. Số lượng là số lượng mời thầu."
        value_label, qty_label = "Giá phần", "Số lượng"
    else:
        title = "Hoạt chất theo đơn giá trúng"
        note = "Gói thầu không tách giá gói theo hoạt chất. Giá trị = số lượng × đơn giá trúng đã tải."
        value_label, qty_label = "SL × đơn giá", "Số lượng"
    provinces = _package_provinces(named, tender_meta, keys)
    provinces.sort(key=lambda row: row["value"], reverse=True)
    regions = [
        _rollup([row for row in provinces if row["region"] == name], keys, code=name, name=name, region=name)
        for name in REGION_ORDER
        if not region_name or name == region_name
    ]
    summary = _rollup(provinces, keys, code="", name="Bộ lọc hiện tại", region=region_name)
    lists = area_ingredient_lists(price_rows + scope_rows) if with_ingredients else {"national": [], "areas": {}}
    trend_label = msc_trend_label(status_need)
    return _payload(
        "msc", months, summary, provinces, regions, investors, investor_total, lists,
        title=title,
        note=note,
        value_label=value_label,
        qty_label=qty_label,
        area_dots=investor_areas,
        packages=packages,
        package_areas=package_areas,
        package_total=package_total,
        trend_label=trend_label,
    )


def msc_trend_label(status_need: str) -> str:
    """Đang mời thầu: tổng giá gói mỗi tháng, theo đúng bộ lọc."""
    if wanted_status(status_need) == "open":
        return "Giá trị gói mỗi tháng"
    return "Giá trị gói trong tháng"


def _value_trend(month_values: dict, keys: list[str]) -> list[dict]:
    amounts = month_values or {}
    return [{"key": key, "value": float(amounts.get(key) or 0)} for key in keys]


def _package_provinces(named: list[dict], tender_meta: dict, keys: list[str]) -> list[dict]:
    """Map and side cards follow the packages in the current status filter.

    Each month in the 12-month series is the sum of giá gói published
    in that month. The set is whatever tender_meta already kept
    (status, province, region, ingredient, group, buyer).
    """
    by_code: dict[str, dict] = {}
    allowed = set(keys)
    for meta in tender_meta.values():
        code = str(meta.get("code") or "").strip()
        if not code:
            continue
        slot = by_code.setdefault(code, {"value": 0.0, "lots": 0, "buyers": set(), "months": {}})
        slot["value"] += _num(meta.get("value"))
        slot["lots"] += 1
        buyer = fold(meta.get("buyer") or "")
        if buyer:
            slot["buyers"].add(buyer)
        month = ""
        for raw in (meta.get("published"), meta.get("close")):
            candidate = _month_of(raw)
            if candidate in allowed:
                month = candidate
                break
        if month:
            slot["months"][month] = float(slot["months"].get(month) or 0) + _num(meta.get("value"))
    empty_trend = [{"key": key, "value": 0} for key in keys]
    out = []
    for row in named:
        slot = by_code.get(row["code"])
        if not slot:
            out.append({
                **row,
                "value": 0.0,
                "prev": 0.0,
                "yoy": 0,
                "lots": 0,
                "facilities": 0,
                "activeMonths": 0,
                "trend": empty_trend,
                "groups": [0.0, 0.0, 0.0, 0.0, 0.0],
            })
            continue
        trend = _value_trend(slot["months"], keys)
        out.append({
            **row,
            "value": slot["value"],
            "prev": 0.0,
            "yoy": None,
            "lots": slot["lots"],
            "facilities": len(slot["buyers"]),
            "activeMonths": sum(1 for point in trend if point["value"] > 0),
            "trend": trend,
            "groups": [0.0, 0.0, 0.0, 0.0, 0.0],
        })
    return out


def _investor_directory(tender_meta: dict, price_pairs, scope_detailed):
    """One row per chủ đầu tư, including provinces outside the national top packages."""
    by_tender: dict[str, list] = {}
    priced = set()
    for row in price_pairs:
        number = str(row[4] or "").strip() if len(row) > 4 else ""
        if not number:
            continue
        priced.add(number)
        lot = row[5] if len(row) > 5 and isinstance(row[5], dict) else None
        by_tender.setdefault(number, []).append((row[1], row[2], row[3], lot))
    for row in scope_detailed:
        number = str(row[4] or "").strip() if len(row) > 4 else ""
        if not number or number in priced:
            continue
        lot = row[5] if len(row) > 5 and isinstance(row[5], dict) else None
        by_tender.setdefault(number, []).append((row[1], row[2], row[3], lot))
    grouped: dict[tuple, dict] = {}
    for number, meta in tender_meta.items():
        code = str(meta.get("code") or "").strip()
        buyer = str(meta.get("buyer") or "").strip() or "Chưa rõ nhà đầu tư"
        slot = grouped.setdefault((code, fold(buyer)), {
            "code": code,
            "buyer": buyer,
            "value": 0.0,
            "lots": 0,
            "pairs": [],
        })
        slot["value"] += _num(meta.get("value"))
        slot["lots"] += 1
        slot["pairs"].extend(by_tender.get(str(number or "").strip(), []))
    made = []
    for slot in grouped.values():
        code = slot["code"]
        made.append({
            "id": f"{code}:{fold(slot['buyer'])}",
            "kind": "investor",
            "name": slot["buyer"],
            "buyer": slot["buyer"],
            "province": PROVINCES.get(code, ""),
            "provinceCode": code,
            "region": region_of(code),
            "district": "",
            "precision": "province",
            "placeNote": "Nhà đầu tư trong bộ lọc hiện tại.",
            "value": slot["value"],
            "lots": slot["lots"],
            "ingredients": rank_ingredients(slot["pairs"], 15),
            "status": "",
            "statusLabel": "Nhà đầu tư",
        })
    area: dict[str, list] = {}
    for dot in made:
        area.setdefault(dot["provinceCode"], []).append(dot)
    for rows in area.values():
        rows.sort(key=lambda item: item["value"], reverse=True)
        del rows[20:]
    national = sorted(made, key=lambda item: item["value"], reverse=True)[:120]
    return national, area, len(made)


def _scope_ingredient_pairs(tender_meta: dict, needle: str) -> list[tuple]:
    """Packages with no awarded price line still list ingredients from saved scope lots."""
    if not tender_meta or not MSC_DB.exists():
        return []
    from .msc_scope import notify_id
    con = sqlite3.connect(f"file:{MSC_DB}?mode=ro", uri=True)
    try:
        lots_by_id = {
            nid: json.loads(raw)
            for nid, raw in con.execute("SELECT notify_id, lots FROM scope_lots")
        }
        by_no = {}
        try:
            for nid, tender_no in con.execute("SELECT notify_id, tender_no FROM scope_match"):
                number = str(tender_no or "").strip()
                if number and nid:
                    by_no[number] = nid
        except sqlite3.OperationalError:
            by_no = {}
    finally:
        con.close()
    pairs = []
    for tender_no, meta in tender_meta.items():
        code = str(meta.get("code") or "").strip()
        if not code:
            continue
        nid = by_no.get(tender_no) or notify_id({
            "source_url": meta.get("source_url") or "",
            "source_id": meta.get("source_id") or "",
        })
        lots = [lot for lot in (lots_by_id.get(nid) or []) if isinstance(lot, dict)]
        named = []
        seen = set()
        for lot in lots:
            name = str(lot.get("tenHoatChat") or lot.get("lotName") or "").strip()
            if not name or (needle and needle not in fold(name)):
                continue
            key = fold(name)
            if key in seen:
                continue
            seen.add(key)
            named.append(lot)
        if not named:
            continue
        fallback = _num(meta.get("value")) / len(named)
        for lot in named:
            name = str(lot.get("tenHoatChat") or lot.get("lotName") or "").strip()
            amount = _num(lot.get("lotPrice")) or fallback
            qty = _num(lot.get("quantity")) or 1
            pairs.append((code, name, amount, qty, tender_no, lot))
    return pairs


def _baoan_level(cache: dict, tender_no: str, source_id: str) -> str:
    """exact or near from the scope-match cache. Empty when the package is not cached."""
    level = cache.get(f"no:{tender_no}") if tender_no else ""
    if level not in ("exact", "near"):
        level = cache.get(f"id:{source_id}") if source_id else ""
    return level if level in ("exact", "near") else ""


def _package_directory(grouped: dict):
    """Packages for the left column: national top 120 and 40 per province, same objects."""
    made = []
    for kind in ("open", "review", "closed"):
        made.extend(grouped.get(kind) or [])
    area: dict[str, list] = {}
    for dot in made:
        code = str(dot.get("provinceCode") or "").strip()
        if not code:
            continue
        area.setdefault(code, []).append(dot)
    for rows in area.values():
        rows.sort(key=lambda item: float(item.get("value") or 0), reverse=True)
        del rows[40:]
    national = sorted(made, key=lambda item: float(item.get("value") or 0), reverse=True)[:120]
    return national, area, len(made)


def _msc_dots(now, window_start, province_codes, region_name, status_need, query, needle, ingredient_ids, group_ids):
    if not MSC_DB.exists():
        return [], 0, set(), {}, [], {}, 0
    con = sqlite3.connect(f"file:{MSC_DB}?mode=ro", uri=True)
    try:
        rows = con.execute(
            """
            SELECT json_extract(normalized,'$.tender_no'),
                   json_extract(normalized,'$.name'),
                   json_extract(normalized,'$.buyer'),
                   json_extract(normalized,'$.province'),
                   json_extract(normalized,'$.published'),
                   json_extract(normalized,'$.close_date'),
                   json_extract(normalized,'$.status_code'),
                   json_extract(normalized,'$.bid_price'),
                   json_extract(normalized,'$.bid_form'),
                   json_extract(normalized,'$.source_url'),
                   json_extract(normalized,'$.source_id'),
                   json_extract(raw,'$.winningContractorName'),
                   json_extract(raw,'$.winningCode'),
                   json_extract(raw,'$.bidWinningPrice'),
                   json_extract(raw,'$.locations'),
                   json_extract(raw,'$.procuringEntityName')
            FROM records WHERE kind='tenders'
            """
        ).fetchall()
    finally:
        con.close()
    from .msc_scope import load_cache
    match_cache = load_cache()
    grouped = {"open": [], "review": [], "closed": []}
    tender_meta = {}
    for row in rows:
        (tender_no, name, buyer, province, published, close_raw, status_code,
         bid_price, bid_form, source_url, source_id, winner, winner_code, winner_price,
         locations, procuring) = row
        winner_name = text_name(winner)
        kind = classify_package(status_code, close_raw, now, window_start, winner_name or winner_code or "")
        if not keep_for_status(kind, status_need):
            continue
        tender_no = str(tender_no or "").strip()
        if group_ids is not None and tender_no not in group_ids:
            continue
        blob = fold(f"{name or ''} {buyer or ''} {procuring or ''}")
        ingredient_hit = bool(needle) and needle in blob
        if ingredient_ids is not None and tender_no not in ingredient_ids and not ingredient_hit:
            continue
        buyer_name = text_name(buyer) or text_name(procuring)
        if query and query not in fold(f"{buyer_name} {name or ''}"):
            continue
        loc = read_location(locations)
        code, label = resolve_province(loc.get("provName") or province or "")
        if province_codes and code not in province_codes:
            continue
        if region_name and region_of(code) != region_name:
            continue
        district = loc.get("district") or ""
        if tender_no and code:
            tender_meta[tender_no] = {
                "code": code,
                "value": _num(bid_price),
                "buyer": buyer_name,
                "published": published or "",
                "close": close_raw or "",
                "source_url": str(source_url or ""),
                "source_id": str(source_id or ""),
            }
        level = _baoan_level(match_cache, tender_no, str(source_id or "").strip())
        grouped[kind].append({
            "id": str(source_id or tender_no or buyer_name),
            "kind": "package",
            "name": str(name or "").strip(),
            "buyer": buyer_name,
            "province": label,
            "provinceCode": code,
            "region": region_of(code),
            "district": district,
            "precision": "province",
            "placeNote": place_note(district, source="msc"),
            "value": _num(bid_price),
            "status": kind,
            "statusLabel": STATUS_LABEL[kind],
            "winner": winner_name if kind == "closed" else "",
            "winnerCode": str(winner_code or "").strip() if kind == "closed" else "",
            "winnerPrice": _num(winner_price) if kind == "closed" else 0,
            "tenderNo": tender_no,
            "closeDate": close_raw or "",
            "published": published or "",
            "bidForm": str(bid_form or ""),
            "sourceUrl": str(source_url or ""),
            "baoanMatch": level,
            "baoan_match": level,
        })
    grouped["closed"].sort(key=lambda item: str(item.get("closeDate") or ""), reverse=True)
    grouped["review"].sort(key=lambda item: float(item.get("value") or 0), reverse=True)
    matched = sum(len(items) for items in grouped.values())
    kept = list(grouped["open"])
    room = max(0, DOT_CAP - len(kept))
    kept.extend(grouped["review"][:room])
    room = max(0, DOT_CAP - len(kept))
    kept.extend(grouped["closed"][:room])
    allowed = set()
    for bucket in grouped.values():
        for item in bucket:
            number = str(item.get("tenderNo") or "").strip()
            if number:
                allowed.add(number)
    packages, package_areas, package_total = _package_directory(grouped)
    return kept, matched, allowed, tender_meta, packages, package_areas, package_total


def _payload(source, months, summary, provinces, regions, dots, matched, ingredients, *, title, note, value_label, qty_label, area_dots=None, packages=None, package_areas=None, package_total=0, trend_label="") -> dict:
    return {
        "source": source,
        "months": months,
        "summary": summary,
        "provinces": provinces,
        "regions": regions,
        "dots": dots,
        "areaDots": area_dots or {},
        "dotTotal": matched,
        "truncated": matched > len(dots),
        "locationNote": LOCATION_NOTE,
        "ingredients": ingredients.get("national") if isinstance(ingredients, dict) else ingredients,
        "ingredientAreas": ingredients.get("areas") if isinstance(ingredients, dict) else {},
        "ingredientTitle": title,
        "ingredientNote": note,
        "ingredientValueLabel": value_label,
        "ingredientQtyLabel": qty_label,
        "packages": packages or [],
        "packageAreas": package_areas or {},
        "packageTotal": int(package_total or 0),
        "trendLabel": trend_label or "",
    }


def map_payload(body: dict) -> dict:
    source = "msc" if str(body.get("source") or "").lower() == "msc" else "vss"
    filters = body.get("filters") or {}
    if not isinstance(filters, dict):
        filters = {}
    months = int(body.get("months") or 12)
    with_dots = body.get("dots", True) is not False
    with_ingredients = body.get("ingredients", True) is not False
    key = json.dumps({
        "source": source,
        "months": months,
        "filters": filters,
        "dots": with_dots,
        "ingredients": with_ingredients,
    }, sort_keys=True, ensure_ascii=False, default=str)
    now = time.time()
    if _MEMO["key"] == key and _MEMO["payload"] is not None and now - _MEMO["at"] < 90:
        return _MEMO["payload"]
    if source == "msc":
        payload = _build_msc(filters, months, with_ingredients=with_ingredients)
        if not with_dots:
            payload = {**payload, "dots": [], "dotTotal": 0, "truncated": False}
    else:
        payload = _build_vss(filters, months, with_dots=with_dots, with_ingredients=with_ingredients)
    _MEMO.update(key=key, at=now, payload=payload)
    return payload
