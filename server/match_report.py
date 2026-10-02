# -*- coding: utf-8 -*-
"""Excel rows for open tenders that match the Bảo An catalog."""
from __future__ import annotations

from datetime import datetime

from .baoan_match import public_lines, sdk_density
from .metric_slice import _in_span, _msc_keep, _msc_rows, _parse_dt, _window
from .msc_scope import attach, matches_scope


def _price(value):
    if isinstance(value, bool) or value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        return int(number) if number.is_integer() else number
    return None


def _link(url) -> str:
    text = str(url or "").strip()
    if text.startswith("https://") or text.startswith("http://"):
        return text
    return ""


def _close_iso(raw) -> str:
    stamp = _parse_dt(raw)
    if stamp is None:
        return ""
    return stamp.strftime("%Y-%m-%dT%H:%M:%S")


def select_open(items, filters, now=None) -> list[dict]:
    """Same open-window population as the Bảo An match cards."""
    filters = filters or {}
    months = int(filters.get("metricMonths") or 12)
    _months, stamp, cur_from, _prev_from, _prev_end = _window(months)
    if now is not None:
        stamp = now
    chosen = []
    for item in items or []:
        if not _msc_keep(item, filters, ("name", "province", "buyer", "tender_no")):
            continue
        if not matches_scope(item, filters):
            continue
        published = _parse_dt(item.get("published"))
        if published is not None and not _in_span(published, cur_from, stamp):
            continue
        code = str(item.get("status_code") or "").strip().upper()
        close = _parse_dt(item.get("close_date"))
        if code or (close is not None and close < stamp):
            continue
        if item.get("baoan_match") not in ("exact", "near"):
            continue
        chosen.append(item)
    unique = {}
    for item in chosen:
        key = str(item.get("tender_no") or "") or str(id(item))
        current = unique.get(key)
        if current is None or len(item.get("scope_lots") or []) > len(current.get("scope_lots") or []):
            unique[key] = item
    chosen = list(unique.values())
    chosen.sort(key=lambda item: (
        _parse_dt(item.get("close_date")) is None,
        _parse_dt(item.get("close_date")) or datetime.max,
        str(item.get("tender_no") or ""),
    ))
    return chosen


def build_rows(items, level: str, density) -> list[dict]:
    """One row per matched tender line and Bảo An product."""
    level = level if level in ("exact", "near", "all") else "all"
    rows = []
    for item in items or []:
        package = item.get("baoan_match")
        for line in public_lines(item.get("scope_lots") or []):
            hit_level = line.get("match") or ""
            if level == "exact" and hit_level != "exact":
                continue
            if level == "near" and not (hit_level == "near" and package == "near"):
                continue
            if level == "all" and hit_level not in ("exact", "near"):
                continue
            hits = line.get("hits") or [{}]
            for hit in hits:
                inn = hit.get("inn") or ""
                rows.append({
                    "tenderNo": item.get("tender_no") or "",
                    "name": item.get("name") or "",
                    "buyer": item.get("buyer") or "",
                    "province": item.get("province") or "",
                    "innMt": line.get("name") or "",
                    "strengthMt": line.get("strength") or "",
                    "formMt": line.get("form") or "",
                    "routeMt": line.get("route") or "",
                    "unit": line.get("unit") or "",
                    "price": _price(line.get("price")),
                    "inn": inn,
                    "brand": hit.get("brand") or "",
                    "strength": hit.get("strength") or "",
                    "form": hit.get("form") or "",
                    "sdkDensity": density(inn) if inn else None,
                    "closeDate": _close_iso(item.get("close_date")),
                    "link": _link(item.get("source_url")),
                    "match": hit_level,
                })
    for index, row in enumerate(rows, start=1):
        row["stt"] = index
    return rows


def match_report(filters: dict, level: str) -> list[dict]:
    items = attach(_msc_rows("tenders"))
    return build_rows(select_open(items, filters), level, sdk_density)
