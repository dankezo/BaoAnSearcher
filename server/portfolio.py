# -*- coding: utf-8 -*-
"""Bao An portfolio cockpit. Local SQLite by default, TiDB when configured."""
from __future__ import annotations

import re
import json
import threading
from datetime import datetime
from statistics import median

from .common import DATA_DIR, DAV_DB, MSC_DB, VSS_DB, VN, fold, normalize_ingredient_token, normalize_strength, parse_date
from .dav import TAG_VANG, TAG_XAM, TAG_XANH, match_dm93, split_ingredients
from .portfolio_store import backend_name, dav_by_registration, dav_cell_candidates, msc_candidates, vss_candidates

BE_COST = 1_200_000_000
CATALOG_PATH = DATA_DIR / "baoan_products.json"
_LOCK = threading.Lock()
_CACHE: dict = {"stamp": None, "payload": None}

_STOP = {
    "vitamin", "duoi", "dang", "hydroclorid", "hydrochloride", "hydrochlorid",
    "natri", "kali", "calci", "sulfat", "chloride", "citrat", "tuong", "duong",
    "nguyen", "acid", "acetat", "chua", "luong", "dang",
}


def load_catalog() -> list[dict]:
    if not CATALOG_PATH.exists():
        return []
    import json
    data = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    return data if isinstance(data, list) else []


def cycle_tag(months_left: float | None, live: bool) -> str:
    """Green when a live SĐK still has at least 18 months, including DM93 matches."""
    if not live:
        return TAG_XAM
    if months_left is not None and months_left >= 18:
        return TAG_XANH
    return TAG_VANG


def status_color(count: int) -> str:
    if count <= 2:
        return "GREEN"
    if count <= 4:
        return "YELLOW"
    return "RED"


def recommendation(row: dict) -> str:
    dm93 = bool(row.get("dm93"))
    color = row.get("statusColor") or status_color(int(row.get("competitorCount") or 0))
    count = int(row.get("competitorCount") or 0)
    if dm93 and color == "RED":
        return "Kiem soat gia, ne thau mo"
    if dm93:
        return "Huong bao ho DM93 (Dieu 56)"
    inn = fold(row.get("inn") or "")
    strength = fold(row.get("strength") or "")
    if count <= 2 and "diosmin" in inn and "1000" in strength:
        return "Thau So gom, uu the lieu"
    if count <= 2:
        return "Toa do Vang"
    therapy = row.get("therapyClass") or ""
    if 3 <= count <= 4 and (therapy in ("cardio", "antibiotic") or row.get("beCandidate")):
        return "Lap de an BE len Nhom 3"
    return "Theo doi thi truong"


def significant_tokens(text: str) -> list[str]:
    out = []
    for word in re.findall(r"[a-z]{5,}", fold(text)):
        if word in _STOP or word in out:
            continue
        out.append(word)
    return out[:4]


def parse_money(value) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(" ", "").replace("\u00a0", "")
    if not text:
        return None
    text = re.sub(r"[^0-9,.-]", "", text)
    if not text or text in {".", ",", "-", "-."}:
        return None
    if "," in text and "." in text:
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif "," in text:
        left, right = text.split(",", 1)
        if right.isdigit() and len(right) <= 2:
            text = left.replace(".", "") + "." + right
        else:
            text = text.replace(",", "")
    elif text.count(".") > 1:
        text = text.replace(".", "")
    try:
        return float(text)
    except ValueError:
        return None


def group_number(label) -> int | None:
    text = fold(label)
    if not text:
        return None
    match = re.search(r"n\s*([1-5])\b", text)
    if match:
        return int(match.group(1))
    match = re.search(r"\b([1-5])\b", text)
    if match:
        return int(match.group(1))
    return None


def _months_left(raw: str, fallback) -> float | None:
    if fallback is not None:
        try:
            return float(fallback)
        except (TypeError, ValueError):
            pass
    end = parse_date(raw)
    if not end:
        return None
    return (end - datetime.now(VN)).total_seconds() / (30.4375 * 24 * 3600)


def _cell_key(hoat: str, ham: str, dang: str) -> tuple[str, str, str]:
    return (normalize_ingredient_token(hoat), normalize_strength(ham), fold(dang))


def _iso_day(raw) -> str:
    parsed = parse_date(raw)
    if not parsed:
        return ""
    return f"{parsed.year:04d}-{parsed.month:02d}-{parsed.day:02d}"


def _year_label(raw) -> str:
    parsed = parse_date(raw)
    if parsed:
        return str(parsed.year)
    match = re.search(r"(?<!\d)((?:19|20)\d{2})(?!\d)", str(raw or ""))
    return match.group(1) if match else ""


def _is_bao_an(*names: str) -> bool:
    return any("bao an" in fold(name or "") for name in names)


def _cell_text(row: dict, key: str) -> str:
    return str(row.get(key) or "").strip()


def _remember_cell_sdk(cells: dict, key: tuple, row: dict) -> None:
    """Keep one identity record per SĐK already seen in a technical cell."""
    sdk = row.get("so_dang_ky") or ""
    if not key[0] or not sdk:
        return
    slot = cells.setdefault(key, {})
    packed = {
        "regNumber": sdk,
        "name": _cell_text(row, "ten_thuoc"),
        "manufacturer": _cell_text(row, "cty_san_xuat"),
        "inn": _cell_text(row, "hoat_chat"),
        "strength": _cell_text(row, "ham_luong"),
        "dosageForm": _cell_text(row, "dang_bao_che"),
        "ctyDangKy": _cell_text(row, "cty_dang_ky"),
        "soQuyetDinh": _cell_text(row, "so_quyet_dinh"),
        "grantYear": _year_label(_cell_text(row, "ngay_cap")),
        "expDate": _iso_day(_cell_text(row, "ngay_het_han")),
    }
    current = slot.get(sdk)
    if current is None:
        slot[sdk] = packed
        return
    for field, value in packed.items():
        if field != "regNumber" and value and not current.get(field):
            current[field] = value


def _competitor_entries(cell_sdks: dict, own_reg: str, catalog_regs: set[str] | None = None) -> list[dict]:
    """Other companies in the same technical cell. Bảo An registrations are not rivals."""
    own = _sdk_key(own_reg)
    catalog = catalog_regs or set()
    entries = []
    for sdk, info in cell_sdks.items():
        key = _sdk_key(sdk)
        if (own and key == own) or key in catalog:
            continue
        if _is_bao_an(info.get("manufacturer") or "", info.get("ctyDangKy") or ""):
            continue
        entries.append({
            "regNumber": info["regNumber"],
            "name": info.get("name") or "",
            "manufacturer": info.get("manufacturer") or "",
            "inn": info.get("inn") or "",
            "strength": info.get("strength") or "",
            "dosageForm": info.get("dosageForm") or "",
            "ctyDangKy": info.get("ctyDangKy") or "",
            "soQuyetDinh": info.get("soQuyetDinh") or "",
            "grantYear": info.get("grantYear") or "",
            "expDate": info.get("expDate") or "",
        })
    entries.sort(key=lambda item: fold(item["regNumber"]))
    return entries


def _sdk_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", fold(value))


def _plant_key(name: str) -> str:
    text = fold(name).replace("–", " ").replace("—", " ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text or "chua ro xuong"


def compute_kpis(rows: list[dict]) -> dict:
    total = len(rows)
    categories = {row["category"] for row in rows if row.get("category")}
    live = sum(1 for row in rows if row.get("liveSdk"))
    green = sum(1 for row in rows if row.get("cycleGreen"))
    years = []
    for row in rows:
        match = re.match(r"(\d{4})", str(row.get("expDate") or ""))
        if match:
            years.append(int(match.group(1)))
    ready = sum(1 for row in rows if (row.get("monthsLeft") or 0) >= 36)
    golden = sum(1 for row in rows if (row.get("competitorCount") or 0) <= 2)
    won = sum(1 for row in rows if row.get("wonBid"))
    plants: dict[str, dict] = {}
    for row in rows:
        key = _plant_key(row.get("manufacturer") or "")
        slot = plants.setdefault(key, {"name": row.get("manufacturer") or "Chưa rõ xưởng", "count": 0})
        slot["count"] += 1
        current = row.get("manufacturer") or ""
        if len(current) > len(slot["name"]):
            slot["name"] = current
    ranked = sorted(plants.values(), key=lambda item: (-item["count"], item["name"]))
    top = ranked[0] if ranked else {"name": "Chưa rõ xưởng", "count": 0}
    return {
        "scale": {
            "sku": total,
            "categories": len(categories),
            "liveSdk": live,
            "liveSdkPct": (live / total) if total else 0,
        },
        "cycle": {
            "green": green,
            "greenPct": (green / total) if total else 0,
            "expiryFrom": min(years) if years else None,
            "expiryTo": max(years) if years else None,
            "ready36": ready,
        },
        "golden": {"count": golden},
        "bids": {"won": won, "total": total, "waiting": total - won},
        "cmo": {
            "top": top["name"],
            "topCount": top["count"],
            "topPct": (top["count"] / total) if total else 0,
            "shares": [
                {"name": item["name"], "count": item["count"], "pct": (item["count"] / total) if total else 0}
                for item in ranked
            ],
        },
    }


def _be_math(vss_rows: list[dict], manufacturer: str) -> dict:
    g3, g4, units = [], [], 0.0
    for row in vss_rows:
        price = parse_money(row.get("gia"))
        total = parse_money(row.get("thanhtien"))
        if price and total and price > 0 and total > 0:
            units += total / price
        number = group_number(row.get("nhomthau"))
        if price and price > 0 and number == 3:
            g3.append(price)
        elif price and price > 0 and number == 4:
            g4.append(price)
    med3 = float(median(g3)) if g3 else None
    med4 = float(median(g4)) if g4 else None
    delta = None
    recommend = False
    if med3 is not None and med4 is not None and units > 0:
        delta = (med3 - med4) * units
        recommend = delta > BE_COST
    meracine = "meracine" in fold(manufacturer)
    note = ""
    if not meracine:
        note = "Cân nhắc chuyển giao công nghệ sang cơ sở EU-GMP (Meracine) để lên Nhóm 2."
    return {
        "cost": BE_COST,
        "medianGroup3": med3,
        "medianGroup4": med4,
        "units": round(units, 2) if units else 0,
        "delta": delta,
        "recommend": recommend,
        "meracine": meracine,
        "note": note,
    }


def _msc_price(product: dict, rows: list[dict]) -> tuple[float | None, str, str]:
    sdk = _sdk_key(product.get("reg_number") or "")
    tokens = significant_tokens(product.get("inn") or "")
    ranked = []
    for row in rows:
        reg = _sdk_key(str(row.get("registration") or ""))
        ingredient = fold(row.get("ingredient") or "")
        same_sdk = bool(sdk) and reg == sdk
        same_inn = bool(tokens) and all(token in ingredient for token in tokens)
        if not same_sdk and not same_inn:
            continue
        price = parse_money(row.get("unit_price"))
        if price is None:
            continue
        group = group_number(row.get("group_name"))
        ranked.append((0 if group == 4 else 1, 0 if same_sdk else 1, price, str(row.get("unit") or ""), str(row.get("group_name") or "")))
    if not ranked:
        return None, "", ""
    ranked.sort(key=lambda item: (item[0], item[1], item[2]))
    _sdk_rank, _group_rank, price, unit, group_name = ranked[0]
    return price, unit, group_name


def _heatmap(rows: list[dict]) -> tuple[list[dict], list[dict]]:
    provinces: dict[str, dict] = {}
    facilities: dict[str, dict] = {}
    for row in rows:
        amount = parse_money(row.get("thanhtien")) or 0
        if amount <= 0:
            continue
        code = str(row.get("ma_tinh") or "").strip()
        name = str(row.get("ten_tinh") or "").strip()
        if code or name:
            key = code or fold(name)
            slot = provinces.setdefault(key, {"maTinh": code, "tenTinh": name, "value": 0.0})
            slot["value"] += amount
            if name and not slot["tenTinh"]:
                slot["tenTinh"] = name
        hospital = str(row.get("ten_cskcb") or "").strip()
        if hospital:
            fkey = fold(hospital) + "|" + fold(name)
            facility = facilities.setdefault(fkey, {"name": hospital, "province": name, "value": 0.0})
            facility["value"] += amount
    province_rows = sorted(provinces.values(), key=lambda item: -item["value"])
    facility_rows = sorted(facilities.values(), key=lambda item: -item["value"])[:12]
    for item in province_rows:
        item["value"] = round(item["value"], 2)
    for item in facility_rows:
        item["value"] = round(item["value"], 2)
    return province_rows, facility_rows


def _prepare_vss(rows: list[dict]) -> dict:
    prepared = []
    buckets: dict[str, list] = {}
    by_sdk: dict[str, list] = {}
    for bid in rows:
        try:
            year = int(bid.get("nam") or 0)
        except (TypeError, ValueError):
            year = 0
        packed = {
            "sdk": _sdk_key(str(bid.get("sodk") or "")),
            "name": fold(bid.get("ten") or ""),
            "hc": fold(bid.get("hoatchat") or ""),
            "year": year,
            "gia": bid.get("gia"),
            "thanhtien": bid.get("thanhtien"),
            "nhomthau": bid.get("nhomthau"),
            "ma_tinh": str(bid.get("ma_tinh") or "").strip(),
            "ten_tinh": str(bid.get("ten_tinh") or "").strip(),
            "ten_cskcb": str(bid.get("ten_cskcb") or "").strip(),
        }
        prepared.append(packed)
        if packed["sdk"]:
            by_sdk.setdefault(packed["sdk"], []).append(packed)
        for token in significant_tokens(packed["hc"])[:3]:
            buckets.setdefault(token, []).append(packed)
    return {"rows": prepared, "buckets": buckets, "by_sdk": by_sdk}


def _market_rows(index: dict, tokens: list[str]) -> list[dict]:
    if not tokens:
        return []
    pool = index["buckets"].get(tokens[0], [])
    if len(tokens) == 1:
        return [row for row in pool if row["year"] >= 2025]
    return [row for row in pool if row["year"] >= 2025 and all(token in row["hc"] for token in tokens[1:])]


def _won_ids(catalog: list[dict], index: dict) -> set:
    won = set()
    brands = []
    sdk_to_ids: dict[str, list] = {}
    for item in catalog:
        sdk = _sdk_key(item.get("reg_number") or "")
        if sdk:
            sdk_to_ids.setdefault(sdk, []).append(item.get("id"))
        brand = fold(item.get("brand_name") or "")
        if len(brand) >= 5:
            brands.append((item.get("id"), brand))
    for sdk, ids in sdk_to_ids.items():
        if index["by_sdk"].get(sdk):
            won.update(ids)
    for packed in index["rows"]:
        name = packed["name"]
        if not name:
            continue
        for pid, brand in brands:
            if pid not in won and brand in name:
                won.add(pid)
    return won


def _assemble() -> tuple[list[dict], dict]:
    catalog = load_catalog()
    catalog_regs = {_sdk_key(str(item.get("reg_number") or "")) for item in catalog}
    catalog_regs.discard("")
    registrations = [str(item.get("reg_number") or "") for item in catalog if item.get("reg_number")]
    dav_rows = dav_by_registration(registrations)
    by_sdk = {_sdk_key(row.get("so_dang_ky") or ""): row for row in dav_rows}
    from .portfolio_bids import registration_keys
    for record in dav_rows:
        for old in registration_keys(record.get('so_dang_ky_cu')):
            by_sdk.setdefault(old, record)
    tokens = []
    for item in catalog:
        found = significant_tokens(item.get("inn") or "")
        if found and found[0] not in tokens:
            tokens.append(found[0])
    cell_rows = dav_cell_candidates(tokens)
    cells: dict[tuple, dict] = {}
    for row in cell_rows:
        key = _cell_key(row.get("hoat_chat") or "", row.get("ham_luong") or "", row.get("dang_bao_che") or "")
        _remember_cell_sdk(cells, key, row)
    brands = [str(item.get("brand_name") or "") for item in catalog if len(fold(item.get("brand_name") or "")) >= 5]
    raw_vss = vss_candidates(tokens, registrations, brands)
    vss_rows = _prepare_vss(raw_vss)
    msc_rows = msc_candidates(tokens, registrations)
    from .portfolio_bids import index_awards, enrich, _line_key
    awards = index_awards(msc_rows, raw_vss, cell_rows + dav_rows)
    company_awards = {}
    for entries in awards.values():
        for entry in entries:
            if entry['manufacturer'] and entry['ingredient']:
                key = (_plant_key(entry['manufacturer']), normalize_ingredient_token(entry['ingredient']))
                company_awards.setdefault(key, []).append(entry)
    won_ids = _won_ids(catalog, vss_rows)
    built = []
    heatmaps = {}
    for item in catalog:
        dav = by_sdk.get(_sdk_key(item.get("reg_number") or ""))
        inn = (dav or {}).get("hoat_chat") or item.get("inn") or ""
        strength = (dav or {}).get("ham_luong") or item.get("strength") or ""
        dosage = (dav or {}).get("dang_bao_che") or item.get("dosage_form") or ""
        manufacturer = (dav or {}).get("cty_san_xuat") or item.get("manufacturer") or ""
        raw_exp = (dav or {}).get("ngay_het_han") or item.get("exp_date") or ""
        exp = _iso_day(str(raw_exp))
        months = _months_left(str(raw_exp), (dav or {}).get("_months_left"))
        active = bool((dav or {}).get("_active_record"))
        tag = cycle_tag(months, active)
        tokens_inn = significant_tokens(inn)
        if dav:
            cell = _cell_key(dav.get("hoat_chat") or "", dav.get("ham_luong") or "", dav.get("dang_bao_che") or "")
            if dav.get("con_hieu_luc") and dav.get("so_dang_ky"):
                _remember_cell_sdk(cells, cell, dav)
        else:
            cell = _cell_key(inn, item.get("strength") or "", item.get("dosage_form") or "")
        cell_sdks = cells.get(cell, {})
        own_reg = (dav or {}).get("so_dang_ky") or item.get("reg_number") or ""
        competitors = _competitor_entries(cell_sdks, own_reg, catalog_regs)
        competitor_count = len(competitors)
        market = _market_rows(vss_rows, tokens_inn)
        volume = 0.0
        for bid in market:
            amount = parse_money(bid.get("thanhtien"))
            if amount:
                volume += amount
        price, unit, group_name = _msc_price(
            {"reg_number": item.get("reg_number") or "", "inn": inn},
            msc_rows,
        )
        dm_flat = {"hoatChat": inn, "hamLuong": strength, "dangBaoChe": dosage, "ingredients": split_ingredients(inn)}
        dm_status = match_dm93(dm_flat) if inn and strength else "uncertain"
        row = {
            "id": item.get("id"),
            "brandName": item.get("brand_name") or "",
            "regNumber": (dav or {}).get("so_dang_ky") or item.get("reg_number") or "",
            "inn": inn,
            "strength": strength,
            "dosageForm": dosage,
            "route": item.get("route") or "",
            "packing": (dav or {}).get("dong_goi") or item.get("packing") or "",
            "category": item.get("category") or "",
            "therapyClass": item.get("therapy_class") or "",
            "beCandidate": bool(item.get("be_candidate")),
            "manufacturer": manufacturer,
            "expDate": exp,
            "grantYear": _year_label((dav or {}).get("ngay_cap") or ""),
            "soQuyetDinh": _cell_text(dav or {}, "so_quyet_dinh"),
            "ctyDangKy": _cell_text(dav or {}, "cty_dang_ky"),
            "tag": tag,
            "webUrl": item.get("web_url") or "",
            "strategyNote": item.get("strategy_note") or "",
            "competitorCount": competitor_count,
            "competitors": competitors,
            "statusColor": status_color(competitor_count),
            "vssVolume": round(volume, 2),
            "wonBid": item.get("id") in won_ids,
            "mscPrice": price,
            "mscUnit": unit,
            "mscGroup": group_name,
            "dm93": dm_status == "match",
            "dm93Status": dm_status,
            "isNicheGold": competitor_count <= 2,
            "cycleGreen": tag == TAG_XANH,
            "monthsLeft": round(months, 1) if months is not None else None,
            "liveSdk": bool(dav.get("con_hieu_luc")) if dav else False,
        }
        row["recommendation"] = recommendation(row)
        row["be"] = _be_math(market, manufacturer)
        enrich(row, awards)
        built.append(row)
        provinces, facilities = _heatmap(market)
        histories = {}
        for identity in [row] + row['competitors']:
            key = (_plant_key(identity['manufacturer']), normalize_ingredient_token(row['inn']))
            related = company_awards.get(key, [])
            exact = awards.get(_sdk_key(identity['regNumber']), [])
            unique = {_line_key(h): h for h in exact + related}
            histories[identity['regNumber']] = sorted(unique.values(), key=lambda h: str(h['date']), reverse=True)
        heatmaps[row["id"]] = {"provinces": provinces, "facilities": facilities,
                               "histories": histories}
    return built, heatmaps


def _file_sig(path) -> tuple:
    """Size and mtime of a real file. WAL sidecars are ignored so a reader touch does not rebuild."""
    if not path.exists():
        return (0, 0)
    st = path.stat()
    return (st.st_mtime_ns, st.st_size)


def _stamp() -> tuple:
    databases = tuple(_file_sig(path) for path in (DAV_DB, MSC_DB, VSS_DB))
    return (_file_sig(CATALOG_PATH), backend_name(), databases)


def build_portfolio(product_id: int | None = None, registration: str | None = None) -> dict:
    stamp = _stamp()
    with _LOCK:
        if _CACHE["stamp"] != stamp or _CACHE["payload"] is None:
            rows, heatmaps = _assemble()
            _CACHE["stamp"] = stamp
            _CACHE["payload"] = {"rows": rows, "heatmaps": heatmaps}
        cached = _CACHE["payload"]
    rows = cached["rows"]
    payload = {
        "kpis": compute_kpis(rows),
        "rows": rows,
        "meta": {"backend": backend_name(), "preparedFor": "tidb"},
    }
    if product_id is None:
        payload["details"] = cached["heatmaps"]
        return payload
    selected = next((row for row in rows if row.get("id") == product_id), None)
    if selected is None:
        raise KeyError(product_id)
    detail = cached["heatmaps"].get(product_id) or {"provinces": [], "facilities": []}
    payload["selectedId"] = product_id
    payload["provinces"] = detail["provinces"]
    payload["facilities"] = detail["facilities"]
    if registration is not None:
        histories = detail.get('histories', {})
        if registration not in histories:
            raise KeyError(registration)
        payload = {'items': histories[registration], 'registration': registration, 'productId': product_id}
    return payload
