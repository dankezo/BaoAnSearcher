# -*- coding: utf-8 -*-
"""Match a tender drug line to the Bảo An catalog.

exact  = hoạt chất + dạng bào chế + hàm lượng (+ nhóm thầu khi cả hai phía có nhóm)
near   = cùng hoạt chất, khác nhẹ về mg hoặc dạng
A package with any exact line stays exact even if other lines are only near.

Danh mục Bảo An (baoan_products.json) chưa có trường nhóm; khi đó exact = INN + dạng + hàm lượng.
"""
from __future__ import annotations

import json
import re
from decimal import Decimal
from functools import lru_cache

import sqlite3

from .common import DATA_DIR, DAV_DB, fold, normalize_dosage_form

_CATALOG = DATA_DIR / "baoan_products.json"
_STRENGTH = re.compile(
    r"(\d+(?:[.,]\d+)?)\s*(mg|mcg|microgam|µg|μg|ug|g|ml|iu|%)",
    re.I,
)
_PAREN = re.compile(r"\([^)]*\)")
_TOKEN = re.compile(r"[a-z0-9]+")
# Short vitamin codes written after a shared "Vitamin", as in "Vitamin B1 + B6 + B12".
_VITAMIN_CODE = re.compile(r"(?:b\d{1,2}|d\d?|k\d?|[ace])")


def _stems(inn: str) -> list[str]:
    text = _PAREN.sub(" ", str(inn or ""))
    text = _STRENGTH.sub(" ", text)
    parts = re.split(r"\s*[;/+|,]\s*", text)
    stems = []
    for part in parts:
        token = fold(part)
        token = re.sub(r"[^a-z0-9 ]+", " ", token)
        token = re.sub(r"\s+", " ", token).strip()
        if len(token) >= 5:
            stems.append(token)
    return stems


def _strengths(text: str) -> set[tuple[float, str]]:
    """Mass amounts compare in mg. 500mcg and 0,5mg are the same amount."""
    found = set()
    for num, unit in _STRENGTH.findall(str(text or "")):
        unit = unit.lower().replace("µg", "mcg").replace("μg", "mcg").replace("ug", "mcg")
        unit = "mcg" if unit == "microgam" else unit
        try:
            value = Decimal(num.replace(",", "."))
        except Exception:
            continue
        if unit == "mcg":
            value = value / Decimal(1000)
            unit = "mg"
        elif unit == "g":
            # Keep grams distinct from milligrams.
            unit = "g"
        found.add((float(value.quantize(Decimal("0.000001"))), unit))
    return found


def _present(stem: str, blob: str, tokens: set[str]) -> bool:
    if stem in blob:
        return True
    head, _, code = stem.partition(" ")
    return (
        head == "vitamin"
        and "vitamin" in tokens
        and code in tokens
        and bool(_VITAMIN_CODE.fullmatch(code))
    )


def _family(text: str) -> str:
    return normalize_dosage_form(text) or fold(text)


def _tender_group(text: str) -> str:
    """Nhóm 1–5 from MSC groupMedicine / group_name."""
    token = fold(text)
    match = re.search(r"([1-5])", token)
    return match.group(1) if match else ""


def _group_ok(lot_group: str, catalog_group: str) -> bool:
    lot_g = _tender_group(lot_group)
    cat_g = _tender_group(catalog_group)
    if lot_g and cat_g:
        return lot_g == cat_g
    return True


@lru_cache(maxsize=1)
def catalog() -> tuple[dict, ...]:
    if not _CATALOG.exists():
        return tuple()
    rows = []
    for item in json.loads(_CATALOG.read_text(encoding="utf-8")):
        stems = _stems(item.get("inn") or "")
        if not stems:
            continue
        rows.append({
            "stems": stems,
            "form": _family(item.get("dosage_form") or ""),
            "strength": _strengths(f"{item.get('strength') or ''} {item.get('inn') or ''}"),
            "group": str(item.get("tender_group") or item.get("group") or ""),
            "card": {
                "brand": item.get("brand_name") or "",
                "inn": item.get("inn") or "",
                "strength": item.get("strength") or "",
                "form": item.get("dosage_form") or "",
                "reg": item.get("reg_number") or "",
            },
        })
    return tuple(rows)


def _lot_blob(lot: dict) -> tuple[str, str, set]:
    blob = fold(f"{lot.get('tenHoatChat') or ''} {lot.get('lotName') or ''} {lot.get('nongDo') or ''}")
    blob = re.sub(r"[^a-z0-9 ]+", " ", blob)
    blob = re.sub(r"\s+", " ", blob)
    form = _family(lot.get("dangBaoChe") or "")
    strength = _strengths(f"{lot.get('nongDo') or ''} {lot.get('lotName') or ''}")
    return blob, form, strength


def classify_lot(lot: dict) -> tuple[str | None, list[dict]]:
    """Return exact/near/None and the Bảo An products behind that level."""
    blob, form, strength = _lot_blob(lot if isinstance(lot, dict) else {})
    tokens = set(_TOKEN.findall(blob))
    exact = []
    near = []
    for item in catalog():
        if not _present(item["stems"][0], blob, tokens):
            continue
        all_inns = all(_present(stem, blob, tokens) for stem in item["stems"])
        form_ok = bool(form) and form == item["form"]
        strength_ok = bool(strength) and bool(item["strength"]) and strength == item["strength"]
        group_ok = _group_ok(lot.get("groupMedicine") or lot.get("group") or "", item.get("group") or "")
        if all_inns and form_ok and strength_ok and group_ok:
            exact.append(item["card"])
            continue
        overlap = len(strength & item["strength"]) if strength and item["strength"] else 0
        near.append((all_inns, form_ok, overlap, item["card"]))
    if exact:
        return "exact", exact[:6]
    if near:
        near.sort(key=lambda row: row[:3], reverse=True)
        return "near", [row[3] for row in near[:4]]
    return None, []


def match_lot(lot: dict) -> str | None:
    """Return 'exact', 'near', or None."""
    level, _hits = classify_lot(lot)
    return level


def msc_price_lot(item: dict) -> dict:
    """Build a scope-like lot dict from an MSC price row."""
    name = str(item.get("name") or "")
    return {
        "tenHoatChat": str(item.get("ingredient") or ""),
        "lotName": name,
        "nongDo": name,
        "dangBaoChe": str(item.get("dosage_form") or ""),
        "groupMedicine": str(item.get("group_name") or ""),
    }


def exact_hits(lot: dict) -> list[dict]:
    """Catalog cards that exactly match this tender line (same rules as scope Khớp)."""
    level, hits = classify_lot(lot if isinstance(lot, dict) else {})
    return hits if level == "exact" else []


def public_lines(lots) -> list[dict]:
    """Slim drug rows for the tender popup, with per-line Bảo An hits."""
    rows = []
    for lot in lots or []:
        if not isinstance(lot, dict):
            continue
        level, hits = classify_lot(lot)
        rows.append({
            "code": lot.get("medicineCode") or "",
            "name": lot.get("tenHoatChat") or lot.get("lotName") or "",
            "strength": lot.get("nongDo") or "",
            "form": lot.get("dangBaoChe") or "",
            "route": lot.get("duongDung") or "",
            "qty": lot.get("quantity"),
            "unit": lot.get("uom") or "",
            "price": lot.get("pricePlan"),
            "group": lot.get("groupMedicine") or "",
            "match": level or "",
            "hits": hits,
        })
    return rows


_DENSITY = {"path": None, "mtime": None, "counts": {}}


def _density_counts() -> dict[str, int]:
    path = str(DAV_DB)
    try:
        mtime = DAV_DB.stat().st_mtime
    except OSError:
        _DENSITY.update(path=path, mtime=None, counts={})
        return {}
    if _DENSITY["path"] == path and _DENSITY["mtime"] == mtime and _DENSITY["counts"]:
        return _DENSITY["counts"]
    grouped: dict[str, set] = {}
    try:
        con = sqlite3.connect(f"file:{DAV_DB}?mode=ro", uri=True)
        try:
            cur = con.execute(
                """
                SELECT coalesce(json_extract(raw, '$.soDangKy'), ''),
                       coalesce(json_extract(raw, '$.thongTinThuocCoBan.hoatChatChinh'),
                                json_extract(raw, '$.hoatChatChinh'), '')
                FROM drugs
                """
            )
            for sdk, inn in cur:
                token = fold(inn)
                ident = str(sdk or "").strip()
                if token and ident:
                    grouped.setdefault(token, set()).add(ident)
        finally:
            con.close()
    except sqlite3.Error:
        grouped = {}
    packed = {key: len(values) for key, values in grouped.items()}
    _DENSITY.update(path=path, mtime=mtime, counts=packed)
    return packed


def ingredient_hits(name: str) -> list[dict]:
    """Hoạt chất liên quan: INN có trong tên, không phải khớp danh mục (không so dạng/hàm lượng).

    Dùng exact_hits(classify_lot) cho nhãn «Khớp danh mục Bảo An» trên bản đồ và bảng tin.
    """
    label = " ".join(str(name or "").split())
    if not label:
        return []
    rows = _ingredient_hits_cached(label, id(catalog()))
    return [dict(row) for row in rows][:8]


@lru_cache(maxsize=2048)
def _ingredient_hits_cached(name: str, _catalog_token: int) -> tuple[dict, ...]:
    blob = re.sub(r"[^a-z0-9 ]+", " ", fold(name))
    blob = re.sub(r"\s+", " ", blob).strip()
    if not blob:
        return tuple()
    tokens = set(_TOKEN.findall(blob))
    hits = []
    seen = set()
    for item in catalog():
        stems = item.get("stems") or []
        if not stems or not all(_present(stem, blob, tokens) for stem in stems):
            continue
        card = item.get("card") or {}
        reg = str(card.get("reg") or "")
        brand = str(card.get("brand") or "")
        key = reg or brand
        if not key or key in seen:
            continue
        seen.add(key)
        hits.append({
            "brand": brand,
            "strength": str(card.get("strength") or ""),
            "form": str(card.get("form") or ""),
            "reg": reg,
        })
    return tuple(hits)


def sdk_density(inn: str) -> int | None:
    """Distinct DAV registrations sharing this hoạt chất. None when unknown."""
    key = fold(inn)
    if not key:
        return None
    count = _density_counts().get(key)
    return count or None


def match_lots(lots) -> str:
    level = "none"
    for lot in lots or []:
        hit = match_lot(lot if isinstance(lot, dict) else {})
        if hit == "exact":
            return "exact"
        if hit == "near":
            level = "near"
    return level
