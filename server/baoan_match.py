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

from .common import DATA_DIR, DAV_DB, fold

_CATALOG = DATA_DIR / "baoan_products.json"
_STRENGTH = re.compile(
    r"(\d+(?:[.,]\d+)?)\s*(mg|mcg|microgam|µg|μg|ug|g|ml|iu|ui|%)",
    re.I,
)
_PAREN = re.compile(r"\([^)]*\)")
_TOKEN = re.compile(r"[a-z0-9]+")
_RATIO = re.compile(
    r"(\d+(?:[.,]\d+)?)\s*(mg|mcg|microgam|µg|μg|ug|g)\s*/\s*(\d+(?:[.,]\d+)?)?\s*ml",
    re.I,
)
# Short vitamin codes written after a shared "Vitamin", as in "Vitamin B1 + B6 + B12".
_VITAMIN_CODE = re.compile(r"(?:b\d{1,2}|d\d?|k\d?|[ace])")
_ALIASES = {
    "fenofibrat": "fenofibrate", "fenofibrate": "fenofibrate",
    "atorvastatine": "atorvastatin", "ciprofloxacine": "ciprofloxacin",
    "hydroclorid": "hydrochloride", "hydrochlorid": "hydrochloride", "hcl": "hydrochloride",
    "sulphate": "sulfate", "sulfat": "sulfate",
}


def _stems(inn: str) -> list[str]:
    text = _PAREN.sub(" ", str(inn or ""))
    text = _STRENGTH.sub(" ", text)
    parts = re.split(r"\s*[;/+|,]\s*", text)
    stems = []
    for part in parts:
        token = fold(part)
        token = re.sub(r"[^a-z0-9 ]+", " ", token)
        token = re.sub(r"\s+", " ", token).strip()
        token = " ".join(_ALIASES.get(word, word) for word in token.split())
        if len(token) >= 5:
            stems.append(token)
    return stems


def _strengths(text: str) -> set[tuple[float, str]]:
    """Quantity-normalised strengths, matching the shared browser policy."""
    found = set()
    source = str(text or "")
    masked = source
    for amount, unit, volume in _RATIO.findall(source):
        try:
            value = Decimal(amount.replace(",", "."))
            volume_value = Decimal((volume or "1").replace(",", "."))
        except Exception:
            continue
        normalized_unit = unit.lower().replace("µg", "mcg").replace("μg", "mcg").replace("ug", "mcg")
        if normalized_unit == "microgam":
            normalized_unit = "mcg"
        if normalized_unit == "mcg":
            value /= Decimal(1000)
        elif normalized_unit == "g":
            value *= Decimal(1000)
        if volume_value > 0:
            found.add((float((value / volume_value).quantize(Decimal("0.000001"))), "mg/ml"))
    masked = _RATIO.sub(" ", source)
    for num, unit in _STRENGTH.findall(masked):
        unit = unit.lower().replace("µg", "mcg").replace("μg", "mcg").replace("ug", "mcg")
        unit = "mcg" if unit == "microgam" else unit
        try:
            value = Decimal(num.replace(",", "."))
        except Exception:
            continue
        if unit == "%":
            found.add((float((value * Decimal(10)).quantize(Decimal("0.000001"))), "mg/ml"))
            continue
        if unit in {"iu", "ui"}:
            found.add((float(value.quantize(Decimal("0.000001"))), "iu"))
            continue
        if unit == "mcg":
            value = value / Decimal(1000)
            unit = "mg"
        elif unit == "g":
            value = value * Decimal(1000)
            unit = "mg"
        found.add((float(value.quantize(Decimal("0.000001"))), unit))
    return found


def _present(stem: str, blob: str, tokens: set[str]) -> bool:
    parts = [part for part in str(stem or "").split() if part]
    if not parts:
        return False
    # Ingredient names must be whole tokens: ``ofloxacin`` is not a match for
    # ``ciprofloxacin``.  This mirrors lib/regulatory/baoanMatch.js, used by
    # the production API and exports.
    if all(part in tokens for part in parts):
        return True
    if len(parts) != 2:
        return False
    head, code = parts
    return (
        head == "vitamin"
        and "vitamin" in tokens
        and code in tokens
        and bool(_VITAMIN_CODE.fullmatch(code))
    )


def _family(text: str) -> str:
    """Keep the Python fallback identical to lib/regulatory/baoanMatch.js."""
    token = re.sub(r"[^a-z0-9 ]+", " ", fold(text))
    token = re.sub(r"\s+", " ", token).strip()
    if not token:
        return ""
    if "bao tan" in token or "enteric" in token:
        return "vien bao tan o ruot"
    if any(word in token for word in ("giai phong", "kiem soat", "retard")) or re.search(r"\b(?:xr|sr|mr)\b", token):
        return "vien giai phong co kiem soat"
    if any(word in token for word in ("hoa tan nhanh", "ra nhanh", "phan tan")):
        return "vien hoa tan nhanh"
    if "suoi" in token or "efferv" in token:
        return "vien sui"
    if "bao duong" in token:
        return "vien bao duong"
    if "nang" in token or "capsule" in token:
        return "vien nang"
    if "bao phim" in token:
        return "vien nen bao phim"
    if "nen" in token or "tablet" in token:
        return "vien nen"
    if "dung dich" in token and "tiem" in token:
        return "dung dich tiem"
    if "hon dich" in token and "tiem" in token:
        return "hon dich tiem"
    if "nhu tuong" in token and "tiem" in token:
        return "nhu tuong tiem"
    if "bot" in token and "tiem" in token:
        return "bot pha tiem"
    if "tiem" in token:
        return "thuoc tiem"
    if "bot" in token and "uong" in token:
        return "bot pha uong"
    if "com" in token and "uong" in token:
        return "com pha uong"
    if "hon dich" in token and "uong" in token:
        return "hon dich uong"
    if "dung dich" in token and "uong" in token:
        return "dung dich uong"
    if "thuoc mo" in token:
        return "thuoc mo"
    if "kem" in token and ("boi" in token or "da" in token):
        return "kem boi da"
    if "gel" in token and ("boi" in token or "da" in token):
        return "gel boi da"
    if "nhu tuong" in token and ("boi" in token or "da" in token):
        return "nhu tuong boi"
    if "dung ngoai" in token:
        return "thuoc dung ngoai"
    if "boi" in token and "da" in token:
        return "thuoc boi da"
    if "vien" in token:
        return "vien"
    return ""


def _route(text: str) -> str:
    token = re.sub(r"\s+", " ", fold(text)).strip()
    if not token:
        return ""
    if "tiem truyen" in token:
        return "tiem truyen"
    if "tiem" in token:
        return "tiem"
    if "uong" in token:
        return "uong"
    if "nho mat" in token:
        return "nho mat"
    if "dung ngoai" in token or "boi da" in token:
        return "dung ngoai"
    if "dat am dao" in token:
        return "dat am dao"
    if "dat truc trang" in token:
        return "dat truc trang"
    return token


_DOSAGE_FORM_RULES = {
    "vien": {"vien", "vien nen", "vien nen bao phim", "vien bao duong", "vien nang"},
    "vien nen": {"vien nen"},
    "vien nen bao phim": {"vien nen bao phim"},
    "vien bao duong": {"vien bao duong"},
    "vien nang": {"vien nang"},
    "thuoc tiem": {"thuoc tiem", "dung dich tiem", "hon dich tiem", "nhu tuong tiem", "bot pha tiem"},
    "dung dich uong": {"dung dich uong", "hon dich uong", "bot pha uong", "com pha uong"},
    "hon dich uong": {"dung dich uong", "hon dich uong", "bot pha uong", "com pha uong"},
    "thuoc dung ngoai": {"thuoc dung ngoai", "thuoc mo", "kem boi da", "gel boi da", "nhu tuong boi"},
    "thuoc boi da": {"thuoc dung ngoai", "thuoc mo", "kem boi da", "gel boi da", "nhu tuong boi"},
}
_SPECIAL_RELEASE_FORMS = {"vien bao tan o ruot", "vien giai phong co kiem soat", "vien hoa tan nhanh", "vien sui"}


def _form_eligible(target: str, candidate: str) -> tuple[bool | None, bool]:
    """Return eligibility and whether it relies on Appendix I compatibility."""
    if not target or not candidate:
        return None, False
    if target == candidate:
        return True, False
    if candidate in _DOSAGE_FORM_RULES.get(target, set()):
        return True, True
    if target in _SPECIAL_RELEASE_FORMS or candidate in _SPECIAL_RELEASE_FORMS:
        return None, True
    return False, False


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
            "route": _route(item.get("route") or ""),
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


def _lot_blob(lot: dict) -> tuple[str, str, str, set]:
    blob = fold(f"{lot.get('tenHoatChat') or ''} {lot.get('lotName') or ''} {lot.get('nongDo') or ''}")
    blob = re.sub(r"[^a-z0-9 ]+", " ", blob)
    blob = re.sub(r"\s+", " ", blob)
    blob = " ".join(_ALIASES.get(word, word) for word in blob.split())
    form = _family(lot.get("dangBaoChe") or "")
    route = _route(lot.get("duongDung") or lot.get("route") or "")
    strength = _strengths(f"{lot.get('nongDo') or ''} {lot.get('lotName') or ''}")
    return blob, form, route, strength


def classify_lot(lot: dict) -> tuple[str | None, list[dict]]:
    """Return exact/near/None and the Bảo An products behind that level."""
    blob, form, route, strength = _lot_blob(lot if isinstance(lot, dict) else {})
    tokens = set(_TOKEN.findall(blob))
    exact = []
    near = []
    for item in catalog():
        all_inns = all(_present(stem, blob, tokens) for stem in item["stems"])
        if not all_inns:
            continue
        form_ok, legal_form = _form_eligible(form, item["form"])
        item_route = item.get("route") or ""
        route_ok = route == item_route if route and item_route else None
        strength_ok = strength == item["strength"] if strength and item["strength"] else None
        group_ok = _group_ok(lot.get("groupMedicine") or lot.get("group") or "", item.get("group") or "")
        hard_conflict = route_ok is False or not group_ok
        soft_conflict = strength_ok is False or form_ok is False
        complete = strength_ok is not None and route_ok is not None and form_ok is not None
        if not hard_conflict and not soft_conflict and complete:
            exact.append(item["card"])
            continue
        # A declared route or tender group conflict is never offered as a
        # candidate.  Missing or different form/strength remains a yellow
        # HSMT review case, not a green eligibility result.
        if not hard_conflict:
            near.append((all_inns, strength_ok is True, form_ok is True, route_ok is True, group_ok, legal_form, item["card"]))
    if exact:
        return "exact", exact[:6]
    if near:
        near.sort(key=lambda row: row[:6], reverse=True)
        return "near", [row[6] for row in near[:4]]
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
        _blob, form, _route_value, _strength = _lot_blob(lot)
        form_compatible = any(
            _present(item["stems"][0], _blob, set(_TOKEN.findall(_blob)))
            and _form_eligible(form, item["form"])[1]
            for item in catalog()
        )
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
            "formCompatible": form_compatible,
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
