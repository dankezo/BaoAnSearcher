# -*- coding: utf-8 -*-
"""Small aggregate payloads so filters redraw metrics without paging every row."""
from __future__ import annotations

import importlib.util
import json
import re
import sqlite3
import threading
from concurrent.futures import Future
from contextlib import closing
from datetime import datetime, timedelta
from functools import lru_cache
from pathlib import Path

from .common import MSC_DB, ROOT, VSS_DB, DAV_DB, fold
from .msc_scope import attach, load_cache, refresh_async

_HEAT = ROOT / "data" / "vss_heat.sqlite3"
_MONTH = 30.4375


def _provinces():
    path = ROOT / "scripts" / "build_vn_provinces_geojson.py"
    spec = importlib.util.spec_from_file_location("vn_province_codes", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.PROVINCES


PROVINCES = _provinces()


def province_label(code: str, fallback: str = "") -> str:
    key = str(code or "").strip()
    if key.isdigit():
        key = key.zfill(2)
    name = PROVINCES.get(key) or str(fallback or "").strip()
    if name and not name.lower().startswith("tỉnh mã") and not name.lower().startswith("tinh ma"):
        return name
    return PROVINCES.get(key) or (f"Tỉnh mã {key}" if key else "Chưa xác định tỉnh")


def _parse_dt(raw):
    if not raw:
        return None
    text = str(raw).strip()
    match = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})", text)
    if match:
        try:
            return datetime(int(match.group(3)), int(match.group(2)), int(match.group(1)))
        except ValueError:
            return None
    try:
        return datetime.fromisoformat(text.replace("Z", "")[:19])
    except ValueError:
        return None


def _num(value):
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    text = str(value or "").strip().replace(" ", "")
    if not text:
        return 0.0
    if re.match(r"^-?\d{1,3}(\.\d{3})+(,\d+)?$", text):
        text = text.replace(".", "").replace(",", ".")
    elif re.match(r"^-?\d+,\d+$", text):
        text = text.replace(",", ".")
    else:
        text = re.sub(r"[^\d.-]", "", text)
    try:
        return float(text)
    except ValueError:
        return 0.0


def _group(raw) -> str | None:
    text = fold(raw)
    match = re.search(r"([1-5])", text)
    return match.group(1) if match else None


def _window(months: int):
    months = 12 if months not in (3, 6, 12) else months
    now = datetime.now()
    # Same calendar span one year earlier (cùng kỳ).
    start = datetime(now.year, now.month, 1)
    # step back `months` from the first of this month, then include this month
    idx = start.year * 12 + start.month - 1 - (months - 1)
    cur_from = datetime(idx // 12, idx % 12 + 1, 1)
    prev_idx = idx - 12
    prev_from = datetime(prev_idx // 12, prev_idx % 12 + 1, 1)
    prev_to = datetime(now.year - 1, now.month, 1)
    # previous window ends at the same month last year, inclusive through "now" shifted -1y when possible
    try:
        prev_end = now.replace(year=now.year - 1)
    except ValueError:
        prev_end = now.replace(year=now.year - 1, day=28)
    return months, now, cur_from, prev_from, prev_end


def _in_span(stamp: datetime | None, start: datetime, end: datetime) -> bool:
    return stamp is not None and start <= stamp <= end


def rebuild_heat() -> int:
    """Rebuild the month cube from VSS. About ten seconds, once per data load."""
    if not VSS_DB.exists():
        return 0
    src = sqlite3.connect(f"file:{VSS_DB}?mode=ro", uri=True)
    try:
        rows = src.execute(
            """
            SELECT coalesce(ma_tinh,''),
                   substr(coalesce(tungay_hd, ''), 1, 7),
                   coalesce(nhomthau,''),
                   sum(coalesce(cast(json_extract(raw, '$.thanhtien') AS real), 0)),
                   count(*),
                   max(coalesce(json_extract(raw, '$.ten_tinh'), ''))
            FROM bids
            WHERE length(coalesce(tungay_hd,'')) >= 7
            GROUP BY 1, 2, 3
            """
        ).fetchall()
    finally:
        src.close()
    if _HEAT.exists():
        _HEAT.unlink()
    out = sqlite3.connect(_HEAT)
    try:
        out.execute("CREATE TABLE heat (code TEXT, ym TEXT, grp TEXT, value REAL, cnt INTEGER, name TEXT)")
        out.executemany("INSERT INTO heat VALUES (?,?,?,?,?,?)", rows)
        out.commit()
    finally:
        out.close()
    return len(rows)


def slice_payload(body: dict) -> dict:
    section = str(body.get("section") or "")
    filters = body.get("filters") or {}
    if section == "dav":
        from .dav import search_drugs
        from .stored_metrics import read_metrics, summarize_dav
        payload = read_metrics("dav") if not any(filters.values()) else None
        if payload is None:
            payload = summarize_dav(search_drugs(filters, all_rows=True)["items"])
        for card in payload["cards"]:
            card["subtitle"] = "Theo bộ lọc hiện tại"
        return payload
    months = int(body.get("months") or 12)
    if section == "vss":
        return _vss(filters, months)
    if section == "msc_prices":
        return _msc_prices(filters, months)
    if section == "msc_tenders":
        return _msc_tenders(filters, months)
    return {"section": section, "error": "Không có chỉ số cho mục này"}


def _heat_rows(filters: dict):
    """Use the month cube when the filter is only province / group / year."""
    text_keys = ("q", "hoatchat", "sodk", "duongdung", "nuocsx", "loai_thau", "tuNgay", "denNgay",
                 "ten", "loai", "nhasx", "ma_cskcb", "ten_cskcb", "tennhathau", "hamluong", "donvitinh", "nam")
    if any(str(filters.get(key) or "").strip() for key in text_keys):
        return None
    if not _HEAT.exists():
        return None
    con = sqlite3.connect(f"file:{_HEAT}?mode=ro", uri=True)
    try:
        return con.execute("SELECT code, ym, grp, value, cnt, name FROM heat").fetchall()
    finally:
        con.close()


def _vss_sql(filters: dict):
    if not VSS_DB.exists():
        return []
    clauses, args = ["length(coalesce(tungay_hd,'')) >= 7"], []
    for field, column in (
        ("hoatchat", "hoatchat"),
        ("sodk", "sodk"),
        ("ten", "ten"),
        ("loai", "loai"),
        ("duongdung", "duongdung"),
        ("nuocsx", "nuocsx"),
        ("loai_thau", "loai_thau"),
        ("nhasx", "json_extract(raw,'$.nhasx')"),
        ("ma_cskcb", "json_extract(raw,'$.ma_cskcb')"),
        ("ten_cskcb", "json_extract(raw,'$.ten_cskcb')"),
        ("ten_tinh", "json_extract(raw,'$.ten_tinh')"),
        ("tennhathau", "json_extract(raw,'$.tennhathau')"),
        ("hamluong", "json_extract(raw,'$.hamluong')"),
        ("donvitinh", "json_extract(raw,'$.donvitinh')"),
    ):
        raw = filters.get(field)
        values = raw if isinstance(raw, list) else ([raw] if str(raw or "").strip() else [])
        parts = []
        for value in values:
            token = fold(value)
            if not token:
                continue
            parts.append(f"fold(coalesce({column},'')) LIKE ?")
            args.append(f"%{token}%")
        if parts:
            clauses.append("(" + " OR ".join(parts) + ")")
    if filters.get("tuNgay"):
        clauses.append("coalesce(tungay_hd,'') >= ?")
        args.append(str(filters["tuNgay"])[:10])
    if filters.get("denNgay"):
        clauses.append("coalesce(denngay_hd,'') <= ?")
        args.append(str(filters["denNgay"])[:10] + " 23:59:59")
    years = filters.get("nam") or []
    if isinstance(years, (str, int)):
        years = [years] if str(years).strip() else []
    year_parts = []
    for value in years:
        try:
            year = int(str(value).strip())
        except (TypeError, ValueError):
            continue
        y = str(year)
        year_parts.append("(nam = ? OR coalesce(tungay_hd,'') LIKE ? OR (tungay_hd <= ? AND denngay_hd >= ?) OR coalesce(json_extract(raw,'$.congbo'),'') LIKE ?)")
        args.extend([year, f"{y}%", f"{y}-12-31", f"{y}-01-01", f"{y}%"])
    if year_parts:
        clauses.append("(" + " OR ".join(year_parts) + ")")
    q = fold(filters.get("q") or "")
    if q:
        for word in q.split():
            clauses.append("search LIKE ?")
            args.append(f"%{word}%")
    where = " WHERE " + " AND ".join(clauses)
    con = sqlite3.connect(f"file:{VSS_DB}?mode=ro", uri=True)
    try:
        con.create_function("fold", 1, fold)
        return con.execute(
            f"""
            SELECT coalesce(ma_tinh,''), substr(coalesce(tungay_hd,''),1,7), coalesce(nhomthau,''),
                   sum(coalesce(cast(json_extract(raw,'$.thanhtien') AS real), 0)),
                   count(*),
                   max(coalesce(json_extract(raw,'$.ten_tinh'), ''))
            FROM bids
            {where}
            GROUP BY 1, 2, 3
            """,
            args,
        ).fetchall()
    finally:
        con.close()


def _vss(filters: dict, months: int) -> dict:
    months, now, cur_from, prev_from, prev_end = _window(months)
    rows = _heat_rows(filters)
    if rows is None:
        rows = _vss_sql(filters)
    wanted_codes = set()
    raw_codes = filters.get("ma_tinh") or []
    if isinstance(raw_codes, str):
        raw_codes = [raw_codes] if raw_codes.strip() else []
    for code in raw_codes:
        key = str(code).strip()
        wanted_codes.add(key.zfill(2) if key.isdigit() else key)
    raw_groups = filters.get("nhomthau") or []
    if isinstance(raw_groups, str):
        raw_groups = [raw_groups] if raw_groups.strip() else []
    wanted_groups = {g for g in (_group(x) for x in raw_groups) if g}
    names = filters.get("ten_tinh") or []
    if isinstance(names, str):
        names = [names] if names.strip() else []
    name_needles = [fold(x) for x in names if str(x).strip()]

    buckets: dict[str, dict] = {}
    for code, ym, grp, value, cnt, name in rows:
        stamp = _parse_dt(f"{ym}-01" if ym and len(str(ym)) == 7 else "")
        if stamp is None:
            continue
        current = _in_span(stamp, cur_from, now)
        previous = _in_span(stamp, prev_from, prev_end)
        if not current and not previous:
            continue
        key = str(code or "").strip()
        key = key.zfill(2) if key.isdigit() else key
        if wanted_codes and key not in wanted_codes:
            continue
        label = province_label(key, name or "")
        if name_needles and not any(n in fold(label) for n in name_needles):
            continue
        group = _group(grp)
        if wanted_groups and group not in wanted_groups:
            continue
        item = buckets.setdefault(key or label, {
            "code": key, "name": label, "value": 0.0, "prev": 0.0, "count": 0, "groups": [0, 0, 0, 0, 0],
        })
        if name and not str(name).lower().startswith("tỉnh mã"):
            item["name"] = province_label(key, name)
        amount = float(value or 0)
        if current:
            item["value"] += amount
            item["count"] += int(cnt or 0)
            if group:
                item["groups"][int(group) - 1] += amount
        elif previous:
            item["prev"] += amount
    ranked = []
    for item in buckets.values():
        prev = item["prev"]
        cur = item["value"]
        item["yoy"] = ((cur - prev) / prev * 100) if prev > 0 else (None if cur > 0 else 0)
        ranked.append(item)
    ranked.sort(key=lambda row: row["value"], reverse=True)
    total = sum(row["value"] for row in ranked) or 1
    for row in ranked:
        row["share"] = row["value"] / total * 100
    return {
        "section": "vss",
        "months": months,
        "provinces": ranked,
        "totalValue": sum(row["value"] for row in ranked),
    }


def _msc_rows(kind: str):
    if not MSC_DB.exists():
        return []
    con = sqlite3.connect(f"file:{MSC_DB}?mode=ro", uri=True)
    try:
        return [json.loads(raw) for (raw,) in con.execute(
            "SELECT normalized FROM records WHERE kind=? AND "
            "(kind <> 'prices' OR (json_extract(normalized, '$.source_label')='API Mua sắm công' "
            "AND NOT EXISTS (SELECT 1 FROM excel_matches m WHERE m.excel_id=records.source_id)))", (kind,))]
    finally:
        con.close()


def _msc_keep(item: dict, filters: dict, keys: tuple[str, ...]) -> bool:
    for key in keys:
        raw = filters.get(key)
        values = raw if isinstance(raw, list) else ([raw] if str(raw or "").strip() else [])
        needles = [fold(v) for v in values if str(v or "").strip()]
        if not needles:
            continue
        blob = fold(item.get(key) or "")
        if not any(n in blob for n in needles):
            return False
    q = fold(filters.get("q") or "")
    if q:
        blob = fold(" ".join(str(v) for v in item.values() if isinstance(v, str)))
        if any(word not in blob for word in q.split()):
            return False
    return True


def _monday(stamp: datetime) -> datetime:
    day = stamp.replace(hour=0, minute=0, second=0, microsecond=0)
    return day - timedelta(days=day.weekday())


def _week_span(buckets: dict, start: datetime, end: datetime) -> list:
    points = []
    cursor = _monday(start)
    last = _monday(end)
    while cursor <= last:
        key = cursor.strftime("%Y-%m-%d")
        row = buckets.get(key) or {}
        points.append({
            "key": key,
            "label": f"{cursor.day}/{cursor.month}",
            "qty": float(row.get("qty") or 0),
            "revenue": float(row.get("revenue") or 0),
        })
        cursor += timedelta(days=7)
    return points


def _month_span(buckets: dict, start: datetime, end: datetime) -> list:
    points = []
    year, month = start.year, start.month
    while (year, month) <= (end.year, end.month):
        key = f"{year}-{month:02d}"
        row = buckets.get(key) or {}
        points.append({
            "key": key,
            "label": f"T{month}/{str(year)[2:]}",
            "qty": float(row.get("qty") or 0),
            "revenue": float(row.get("revenue") or 0),
        })
        month += 1
        if month == 13:
            month = 1
            year += 1
    return points


def _price_aggregates(filters, start, end):
    from .msc import search_where
    if not MSC_DB.exists():
        return []
    with closing(sqlite3.connect(f"file:{MSC_DB}?mode=ro", uri=True)) as lookup:
        indexed = lookup.execute("SELECT 1 FROM sqlite_master WHERE name='records_search_fts'").fetchone() is not None
        dated = lookup.execute("SELECT 1 FROM sqlite_master WHERE name='idx_records_kind_cursor'").fetchone() is not None
    clauses, args = search_where("prices", filters, indexed=indexed)
    clauses.extend(["metric_day(json_extract(normalized, '$.published')) >= ?",
                    "metric_day(json_extract(normalized, '$.published')) <= ?"])
    args.extend([start.date().isoformat(), end.date().isoformat()])
    if dated:
        cursor = "coalesce(json_extract(normalized,'$.published'),json_extract(normalized,'$.close_date'),collected_at)"
        clauses.append(f"rowid IN (SELECT rowid FROM records INDEXED BY idx_records_kind_cursor WHERE kind='prices' AND {cursor}>=? AND {cursor}<=? UNION SELECT rowid FROM records INDEXED BY idx_records_kind_cursor WHERE kind='prices' AND {cursor} NOT GLOB '????-??-??*')")
        args.extend([start.date().isoformat(), end.date().isoformat() + "~"])
    with closing(sqlite3.connect(f"file:{MSC_DB}?mode=ro", uri=True)) as con:
        con.create_function("fold", 1, fold, deterministic=True)
        con.create_function("metric_num", 1, lru_cache(maxsize=8192)(_num), deterministic=True)
        con.create_function("metric_day", 1, lru_cache(maxsize=4096)(lambda v: stamp.date().isoformat() if (stamp := _parse_dt(v)) else None), deterministic=True)
        # Broad totals cannot use the registration index to narrow their rows.
        scan = " NOT INDEXED" if not any(value for key, value in filters.items() if key != "metricMonths") else ""
        rows = con.execute("""
          SELECT metric_day(json_extract(normalized, '$.published')) AS published,
                 coalesce(json_extract(normalized, '$.province'), ''),
                 coalesce(json_extract(normalized, '$.group_name'), ''),
                 coalesce(json_extract(normalized, '$.unit'), ''),
                 SUM(metric_num(json_extract(normalized, '$.quantity'))),
                 SUM(metric_num(json_extract(normalized, '$.quantity')) * metric_num(json_extract(normalized, '$.unit_price'))),
                 COUNT(*), MIN(metric_num(json_extract(normalized, '$.unit_price'))), MAX(metric_num(json_extract(normalized, '$.unit_price')))
            FROM records""" + scan + " WHERE " + " AND ".join(clauses) + " GROUP BY 1,2,3,4", args).fetchall()
    keys = ("published", "province", "group_name", "unit", "qty", "revenue", "cnt", "minPrice", "maxPrice")
    return [dict(zip(keys, row)) for row in rows]


def _shape_price_rows(rows, window, include_groups=True):
    months, now, cur_from, prev_from, prev_end = window
    series, provinces = {}, {}
    groups = [0.0] * 5
    previous_count = current_count = 0
    prev_revenue = 0.0
    for item in rows:
        stamp = _parse_dt(item.get("published"))
        current = _in_span(stamp, cur_from, now)
        previous = _in_span(stamp, prev_from, prev_end)
        if not current and not previous:
            continue
        qty, revenue = _num(item.get("qty")), _num(item.get("revenue"))
        group = _group(item.get("group_name")) or ""
        name = str(item.get("province") or "").strip() or "Chưa xác định tỉnh"
        prov = provinces.setdefault(name, {"name": name, "value": 0.0, "prev": 0.0})
        if current:
            current_count += int(item.get("cnt") or 0)
            prov["value"] += revenue
            key = stamp.strftime("%Y-%m")
            bucket = series.setdefault(key, {"qty": 0.0, "revenue": 0.0, "breakdown": {}})
            bucket["qty"] += qty
            bucket["revenue"] += revenue
            unit = str(item.get("unit") or "").strip() or "ĐVT chưa rõ"
            part = bucket["breakdown"].setdefault((group, unit), {"group": group, "unit": unit, "qty": 0.0, "revenue": 0.0, "minPrice": None, "maxPrice": None})
            part["qty"] += qty
            part["revenue"] += revenue
            lo, hi = item.get("minPrice"), item.get("maxPrice")
            if lo is not None: part["minPrice"] = min(lo, part["minPrice"]) if part["minPrice"] is not None else lo
            if hi is not None: part["maxPrice"] = max(hi, part["maxPrice"]) if part["maxPrice"] is not None else hi
            if group: groups[int(group) - 1] += revenue
        else:
            previous_count += int(item.get("cnt") or 0)
            prev_revenue += revenue
            prov["prev"] += revenue
    points = _month_span(series, cur_from, now)
    for point in points:
        point["breakdown"] = list(series.get(point["key"], {}).get("breakdown", {}).values())
    ranked = []
    for row in provinces.values():
        row["growth"] = (row["value"] - row["prev"]) / row["prev"] * 100 if row["prev"] > 0 else (None if row["value"] > 0 else 0)
        ranked.append(row)
    ranked.sort(key=lambda row: (row["growth"] is None, -(row["growth"] if row["growth"] is not None else -1e18), -row["value"]))
    rev_now = sum(p["revenue"] for p in points)
    payload = {"section": "msc_prices", "months": months, "series": points,
        "topGrowth": ranked[:3], "topProvinces": sorted(ranked, key=lambda r: r["value"], reverse=True)[:6],
        "groups": groups, "quantity": sum(p["qty"] for p in points), "revenue": rev_now,
        "prevRevenue": prev_revenue, "yoy": (rev_now - prev_revenue) / prev_revenue * 100 if prev_revenue > 0 else (None if rev_now > 0 else 0),
        "coverage": {"from": prev_from.date().isoformat() if rows else None, "to": now.date().isoformat() if rows else None, "records": current_count, "previousRecords": previous_count}}
    if include_groups:
        payload["groupViews"] = {g: _shape_price_rows([r for r in rows if _group(r.get("group_name")) == g], window, False) for g in "12345"}
    return payload


_PRICE_CACHE = {}
_PRICE_FLIGHTS = {}
_PRICE_LOCK = threading.Lock()

def _msc_prices(filters: dict, months: int) -> dict:
    window = _window(months)
    # SQLite WAL changes must invalidate aggregates as well as main DB changes.
    stamps = tuple((p.stat().st_mtime_ns, p.stat().st_size) if p.exists() else None for p in (MSC_DB, Path(str(MSC_DB) + "-wal")))
    key = (json.dumps(filters, sort_keys=True, ensure_ascii=False), months, window[1].strftime("%Y-%m-%d"), stamps)
    import time
    with _PRICE_LOCK:
        cached = _PRICE_CACHE.get(key)
        if cached and time.monotonic() - cached[0] < 300:
            return cached[1]
        future = _PRICE_FLIGHTS.get(key)
        owner = future is None
        if owner:
            future = _PRICE_FLIGHTS[key] = Future()
    if not owner:
        return future.result(timeout=90)
    try:
        result = _shape_price_rows(_price_aggregates(filters, window[3], window[1]), window)
        with _PRICE_LOCK:
            if len(_PRICE_CACHE) >= 16:
                _PRICE_CACHE.pop(next(iter(_PRICE_CACHE)))
            _PRICE_CACHE[key] = (time.monotonic(), result)
        future.set_result(result)
        return result
    except Exception as exc:
        future.set_exception(exc)
        raise
    finally:
        with _PRICE_LOCK:
            _PRICE_FLIGHTS.pop(key, None)


def _msc_tenders(filters: dict, months: int) -> dict:
    months, now, cur_from, _prev_from, _prev_end = _window(months)
    if not MSC_DB.exists():
        rows = []
    else:
        from .msc import search_where
        with sqlite3.connect(f"file:{MSC_DB}?mode=ro", uri=True) as lookup:
            indexed = lookup.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='records_search_fts'").fetchone() is not None
        clauses, args = search_where("tenders", filters, indexed=indexed)
        clauses.append("(json_extract(normalized, '$.published') IS NULL OR metric_day(json_extract(normalized, '$.published')) IS NULL OR (metric_day(json_extract(normalized, '$.published')) >= ? AND metric_day(json_extract(normalized, '$.published')) <= ?))")
        args.extend([cur_from.date().isoformat(), now.date().isoformat()])
        with sqlite3.connect(f"file:{MSC_DB}?mode=ro", uri=True) as con:
            con.create_function("fold", 1, fold, deterministic=True)
            con.create_function("metric_day", 1, lambda v: _parse_dt(v).date().isoformat() if _parse_dt(v) else None, deterministic=True)
            rows = [json.loads(raw) for (raw,) in con.execute(
                "SELECT normalized FROM records WHERE " + " AND ".join(clauses), args
            )]
    rows = attach(rows)
    cache = load_cache()
    from .msc_scope import matches_scope
    open_n = review_n = new_n = closing_n = 0
    open_value = 0.0
    exact = near = cached_open = 0
    for item in rows:
        if not matches_scope(item, filters):
            continue
        published = _parse_dt(item.get("published"))
        code = str(item.get("status_code") or "").strip().upper()
        close = _parse_dt(item.get("close_date"))
        price = _num(item.get("bid_price"))
        is_open = not code and (close is None or close >= now)
        if code == "DXT" or (not code and close is not None and close < now):
            review_n += 1
        elif is_open:
            open_n += 1
            open_value += price
            if published is not None and (now - published).total_seconds() < 72 * 3600:
                new_n += 1
            if close is not None:
                days = (close - now).total_seconds() / 86400
                if 0 <= days < 7:
                    closing_n += 1
            level = item.get("baoan_match") or cache.get(f"no:{item.get('tender_no')}") or ""
            if level in ("exact", "near", "none"):
                cached_open += 1
            if level == "exact":
                exact += 1
            elif level == "near":
                near += 1
    return {
        "section": "msc_tenders",
        "months": months,
        "openCount": open_n,
        "openValue": open_value,
        "matchExact": exact,
        "matchNear": near,
        "newCount": new_n,
        "closingCount": closing_n,
        "reviewCount": review_n,
        "cached": cached_open,
        "uncached": max(0, open_n - cached_open),
    }
