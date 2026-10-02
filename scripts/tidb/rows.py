# -*- coding: utf-8 -*-
"""Row shapes for the TiDB upsert. Dirty money and dates stay NULL plus *_raw."""
from __future__ import annotations

import hashlib
import json
from decimal import Decimal, InvalidOperation

from server.common import fold, parse_date
from server.vss import parse_vn_number

BATCH = 1000

MONEY_MAX = Decimal("9999999999999.99")  # DECIMAL(15,2)
QTY_MAX = Decimal("999999999999999.999")  # DECIMAL(18,3)


def fold_key(value) -> str:
    """Stable indexed text: accent-folded, lower-case and single-spaced."""
    return " ".join(fold(value).split())

VSS_COLUMNS = (
    "fp_hash", "fingerprint", "search",
    "hoatchat", "sodk", "ten", "duongdung", "hamluong", "donvitinh",
    "soluong", "soluong_raw", "gia", "gia_raw", "thanhtien", "thanhtien_raw",
    "nhomthau", "nhasx", "nuocsx", "ma_tinh", "ma_cskcb",
    "tungay_hd", "tungay_hd_raw", "denngay_hd", "denngay_hd_raw",
    "ten_tinh", "ten_cskcb", "loai_thau", "loai", "nam",
    "congbo", "congbo_raw",
    "hoatchat_f", "ten_f", "ten_tinh_f",
)
DAV_COLUMNS = (
    "id", "search",
    "so_dang_ky", "so_dang_ky_cu", "ten_thuoc", "hoat_chat",
    "ngay_cap", "ngay_cap_raw", "ngay_gia_han", "ngay_gia_han_raw",
    "ngay_het_han", "ngay_het_han_raw",
    "ham_luong", "dang_bao_che", "dong_goi", "han_dung",
    "cty_san_xuat", "nuoc_san_xuat", "cty_dang_ky", "nuoc_dang_ky",
    "so_quyet_dinh", "tieu_chuan", "ky_cap_nam", "con_hieu_luc", "ingredient_count",
    "tag_id", "hoat_chat_f", "ten_thuoc_f",
)
MSC_PRICE_COLUMNS = (
    "source_id", "search",
    "name", "ingredient", "strength", "registration",
    "unit_price", "unit_price_raw", "quantity", "quantity_raw", "unit", "route", "dosage_form",
    "group_name", "medicine_type", "manufacturer", "country", "buyer", "province",
    "tender_no", "published", "published_raw", "winner", "source_url", "collected_at",
    "name_f", "ingredient_f", "province_f",
)
MSC_TENDER_COLUMNS = (
    "source_id", "search",
    "tender_no", "name", "buyer", "province",
    "published", "published_raw", "close_date", "close_date_raw",
    "status_label", "status_code", "bid_price", "bid_price_raw", "bid_form",
    "source_url", "collected_at", "name_f", "province_f",
)
ROLLUP_COLUMNS = ("loai", "nam", "ym", "ma_tinh", "nhomthau", "sum_thanhtien", "cnt")
SUGGEST_COLUMNS = ("section", "field", "value", "cnt")

PRIMARY_KEYS = {
    "vss_bids": ("fp_hash",),
    "dav_drugs": ("id",),
    "msc_prices": ("source_id",),
    "msc_tenders": ("source_id",),
    "agg_vss_monthly": ("loai", "nam", "ym", "ma_tinh", "nhomthau"),
    "suggest_values": ("section", "field", "value"),
}

CLIP = {
    "fp_hash": 64, "id": 64, "source_id": 128,
    "hoatchat": 512, "hoatchat_f": 512, "ten": 512, "ten_f": 512,
    "sodk": 128, "duongdung": 255, "hamluong": 255, "donvitinh": 64,
    "soluong_raw": 64, "gia_raw": 64, "thanhtien_raw": 64,
    "nhomthau": 64, "nhasx": 512, "nuocsx": 128, "ma_tinh": 32, "ma_cskcb": 64,
    "tungay_hd_raw": 32, "denngay_hd_raw": 32, "ten_tinh": 255, "ten_tinh_f": 255,
    "ten_cskcb": 512, "loai_thau": 128, "loai": 128, "congbo_raw": 64,
    "so_dang_ky": 128, "so_dang_ky_cu": 128, "ten_thuoc": 512, "ten_thuoc_f": 512,
    "hoat_chat": 512, "hoat_chat_f": 512, "ham_luong": 255, "ngay_cap_raw": 32, "ngay_gia_han_raw": 32,
    "ngay_het_han_raw": 32, "dang_bao_che": 255, "dong_goi": 255, "han_dung": 128,
    "cty_san_xuat": 512, "nuoc_san_xuat": 128, "cty_dang_ky": 512, "nuoc_dang_ky": 128,
    "so_quyet_dinh": 128, "tieu_chuan": 128, "ky_cap_nam": 32, "tag_id": 64,
    "name": 512, "name_f": 512, "ingredient": 512, "ingredient_f": 512,
    "strength": 255, "registration": 128, "unit_price_raw": 64, "quantity_raw": 64,
    "unit": 64, "route": 255, "dosage_form": 255, "group_name": 128, "medicine_type": 128, "manufacturer": 512,
    "country": 128, "buyer": 512, "province": 128, "province_f": 128,
    "tender_no": 128, "published_raw": 32, "winner": 512, "collected_at": 64,
    "close_date_raw": 32, "status_label": 128, "status_code": 64, "bid_price_raw": 64,
    "bid_form": 128, "section": 32, "field": 64, "value": 512, "ym": 7,
}


def clip(column: str, value):
    if value is None:
        return None
    text = str(value)
    limit = CLIP.get(column)
    if limit is not None and len(text) > limit:
        return text[:limit]
    return text


def _raw_text(value):
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def split_money(value):
    raw = _raw_text(value)
    number = parse_vn_number(value)
    if number is None:
        return None, raw
    try:
        quantized = Decimal(str(number)).quantize(Decimal("0.01"))
    except InvalidOperation:
        return None, raw
    if quantized.copy_abs() > MONEY_MAX:
        return None, raw
    return format(quantized, "f"), raw


def split_qty(value):
    raw = _raw_text(value)
    number = parse_vn_number(value)
    if number is None:
        return None, raw
    try:
        quantized = Decimal(str(number)).quantize(Decimal("0.001"))
    except InvalidOperation:
        return None, raw
    if quantized.copy_abs() > QTY_MAX:
        return None, raw
    return format(quantized, "f"), raw


def split_date(value):
    raw = _raw_text(value)
    parsed = parse_date(value) if raw else None
    if parsed is None:
        return None, raw
    return parsed.date().isoformat(), raw


def split_year(value):
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        year = value
    elif isinstance(value, float):
        if not value.is_integer():
            return None
        year = int(value)
    else:
        try:
            year = int(str(value).strip())
        except (TypeError, ValueError):
            return None
    if year < -32768 or year > 32767:
        return None
    return year


def _payload(item: dict) -> dict:
    raw = item.get("raw")
    if isinstance(raw, str) and raw.strip():
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            data = {}
    elif isinstance(raw, dict):
        data = raw
    else:
        data = {}
    if not data:
        data = {k: v for k, v in item.items() if k != "raw"}
    return data


def _text(data: dict, *keys):
    for key in keys:
        value = data.get(key)
        if value is None or value == "":
            continue
        if isinstance(value, (dict, list)):
            continue
        return value
    return None


def build_vss_row(item: dict):
    data = _payload(item)
    full = str(item.get("fingerprint") or data.get("fingerprint") or "").strip()
    if not full:
        return None
    if len(full) > 12000:
        full = full[:12000]
    digest = hashlib.sha256(full.encode("utf-8")).hexdigest()
    soluong, soluong_raw = split_qty(_text(data, "soluong"))
    gia, gia_raw = split_money(_text(data, "gia"))
    thanhtien, thanhtien_raw = split_money(_text(data, "thanhtien"))
    tungay, tungay_raw = split_date(_text(data, "tungay_hd") or item.get("tungay_hd"))
    denngay, denngay_raw = split_date(_text(data, "denngay_hd") or item.get("denngay_hd"))
    congbo, congbo_raw = split_date(_text(data, "congbo"))
    hoatchat = _text(data, "hoatchat")
    ten = _text(data, "ten")
    ten_tinh = _text(data, "ten_tinh")
    parts = [
        hoatchat, _text(data, "sodk"), ten, _text(data, "tennhathau"),
        _text(data, "nhasx"), ten_tinh, _text(data, "ten_cskcb"),
        _text(data, "hamluong"), _text(data, "duongdung"), _text(data, "dangbaoche"),
        _text(data, "nhomthau"), _text(data, "loai_thau"), _text(data, "loai"),
    ]
    search = fold(" ".join(str(part) for part in parts if part)) or _raw_text(item.get("search")) or ""
    row = {
        "fp_hash": digest,
        "fingerprint": full,
        "search": search[:60000],
        "hoatchat": clip("hoatchat", hoatchat),
        "sodk": clip("sodk", _text(data, "sodk")),
        "ten": clip("ten", ten),
        "duongdung": clip("duongdung", _text(data, "duongdung")),
        "hamluong": clip("hamluong", _text(data, "hamluong")),
        "donvitinh": clip("donvitinh", _text(data, "donvitinh")),
        "soluong": soluong,
        "soluong_raw": clip("soluong_raw", soluong_raw),
        "gia": gia,
        "gia_raw": clip("gia_raw", gia_raw),
        "thanhtien": thanhtien,
        "thanhtien_raw": clip("thanhtien_raw", thanhtien_raw),
        "nhomthau": clip("nhomthau", _text(data, "nhomthau")),
        "nhasx": clip("nhasx", _text(data, "nhasx")),
        "nuocsx": clip("nuocsx", _text(data, "nuocsx")),
        "ma_tinh": clip("ma_tinh", _text(data, "ma_tinh")),
        "ma_cskcb": clip("ma_cskcb", _text(data, "ma_cskcb")),
        "tungay_hd": tungay,
        "tungay_hd_raw": clip("tungay_hd_raw", tungay_raw),
        "denngay_hd": denngay,
        "denngay_hd_raw": clip("denngay_hd_raw", denngay_raw),
        "ten_tinh": clip("ten_tinh", ten_tinh),
        "ten_cskcb": clip("ten_cskcb", _text(data, "ten_cskcb")),
        "loai_thau": clip("loai_thau", _text(data, "loai_thau")),
        "loai": clip("loai", _text(data, "loai")),
        "nam": split_year(_text(data, "nam") if _text(data, "nam") is not None else item.get("nam")),
        "congbo": congbo,
        "congbo_raw": clip("congbo_raw", congbo_raw),
        "hoatchat_f": clip("hoatchat_f", fold(hoatchat) if hoatchat else None),
        "ten_f": clip("ten_f", fold(ten) if ten else None),
        "ten_tinh_f": clip("ten_tinh_f", fold(ten_tinh) if ten_tinh else None),
    }
    return row


def build_dav_row(flat: dict):
    pk = clip("id", flat.get("id") or flat.get("soDangKy"))
    if not pk:
        return None
    ngay_cap, ngay_cap_raw = split_date(flat.get("ngayCap"))
    ngay_gh, ngay_gh_raw = split_date(flat.get("ngayGiaHan"))
    ngay_hh, ngay_hh_raw = split_date(flat.get("ngayHetHan"))
    ten = flat.get("tenThuoc") or ""
    hoat = flat.get("hoatChat") or ""
    tag = flat.get("tagId")
    if isinstance(tag, list):
        tag = ",".join(str(part) for part in tag if part)
    flag = flat.get("conHieuLuc")
    if flag is None:
        con_hl = None
    else:
        con_hl = 1 if flag else 0
    search = fold(" ".join(str(flat.get(key) or "") for key in (
        "tenThuoc", "soDangKy", "hoatChat", "hamLuong", "dangBaoChe",
        "ctySanXuat", "ctyDangKy", "nuocSanXuat",
    )))
    return {
        "id": pk,
        "search": search[:60000],
        "so_dang_ky": clip("so_dang_ky", flat.get("soDangKy")),
        "so_dang_ky_cu": clip("so_dang_ky_cu", flat.get("soDangKyCu")),
        "ten_thuoc": clip("ten_thuoc", ten) or "",
        "hoat_chat": clip("hoat_chat", hoat) or "",
        "ngay_cap": ngay_cap,
        "ngay_cap_raw": clip("ngay_cap_raw", ngay_cap_raw),
        "ngay_gia_han": ngay_gh,
        "ngay_gia_han_raw": clip("ngay_gia_han_raw", ngay_gh_raw),
        "ngay_het_han": ngay_hh,
        "ngay_het_han_raw": clip("ngay_het_han_raw", ngay_hh_raw),
        "ham_luong": clip("ham_luong", flat.get("hamLuong")),
        "dang_bao_che": clip("dang_bao_che", flat.get("dangBaoChe")),
        "dong_goi": clip("dong_goi", flat.get("dongGoi")),
        "han_dung": clip("han_dung", flat.get("hanDung")),
        "cty_san_xuat": clip("cty_san_xuat", flat.get("ctySanXuat")),
        "nuoc_san_xuat": clip("nuoc_san_xuat", flat.get("nuocSanXuat")),
        "cty_dang_ky": clip("cty_dang_ky", flat.get("ctyDangKy")),
        "nuoc_dang_ky": clip("nuoc_dang_ky", flat.get("nuocDangKy")),
        "so_quyet_dinh": clip("so_quyet_dinh", flat.get("soQuyetDinh")),
        "tieu_chuan": clip("tieu_chuan", flat.get("tieuChuan")),
        "ky_cap_nam": clip("ky_cap_nam", flat.get("kyCapNam")),
        "con_hieu_luc": con_hl,
        "ingredient_count": flat.get("ingredientCount") if isinstance(flat.get("ingredientCount"), int) else None,
        "tag_id": clip("tag_id", tag),
        "hoat_chat_f": clip("hoat_chat_f", fold(hoat) if hoat else None),
        "ten_thuoc_f": clip("ten_thuoc_f", fold(ten) if ten else None),
    }


def _msc_search(item: dict, search_text: str | None) -> str:
    if search_text:
        return str(search_text)[:60000]
    return fold(json.dumps(item, ensure_ascii=False))[:60000]


def build_msc_price_row(item: dict, source_id: str, search_text: str | None, collected_at):
    sid = clip("source_id", source_id)
    if not sid:
        return None
    unit_price, unit_price_raw = split_money(item.get("unit_price"))
    quantity, quantity_raw = split_qty(item.get("quantity"))
    published, published_raw = split_date(item.get("published"))
    name = item.get("name")
    ingredient = item.get("ingredient")
    province = item.get("province")
    return {
        "source_id": sid,
        "search": _msc_search(item, search_text),
        "name": clip("name", name),
        "ingredient": clip("ingredient", ingredient),
        "strength": clip("strength", item.get("strength")),
        "registration": clip("registration", item.get("registration")),
        "unit_price": unit_price,
        "unit_price_raw": clip("unit_price_raw", unit_price_raw),
        "quantity": quantity,
        "quantity_raw": clip("quantity_raw", quantity_raw),
        "unit": clip("unit", item.get("unit")),
        "route": clip("route", item.get("route")),
        "dosage_form": clip("dosage_form", item.get("dosage_form")),
        "group_name": clip("group_name", item.get("group_name")),
        "medicine_type": clip("medicine_type", item.get("medicine_type")),
        "manufacturer": clip("manufacturer", item.get("manufacturer")),
        "country": clip("country", item.get("country")),
        "buyer": clip("buyer", item.get("buyer")),
        "province": clip("province", province),
        "tender_no": clip("tender_no", item.get("tender_no")),
        "published": published,
        "published_raw": clip("published_raw", published_raw),
        "winner": clip("winner", item.get("winner")),
        "source_url": item.get("source_url"),
        "collected_at": clip("collected_at", collected_at),
        "name_f": clip("name_f", fold_key(name) if name else None),
        "ingredient_f": clip("ingredient_f", fold_key(ingredient) if ingredient else None),
        "province_f": clip("province_f", fold_key(province) if province else None),
    }


def build_msc_tender_row(item: dict, source_id: str, search_text: str | None, collected_at):
    sid = clip("source_id", source_id)
    if not sid:
        return None
    published, published_raw = split_date(item.get("published"))
    close_date, close_raw = split_date(item.get("close_date"))
    bid_price, bid_raw = split_money(item.get("bid_price"))
    name = item.get("name")
    province = item.get("province")
    return {
        "source_id": sid,
        "search": _msc_search(item, search_text),
        "tender_no": clip("tender_no", item.get("tender_no")),
        "name": clip("name", name),
        "buyer": clip("buyer", item.get("buyer")),
        "province": clip("province", province),
        "published": published,
        "published_raw": clip("published_raw", published_raw),
        "close_date": close_date,
        "close_date_raw": clip("close_date_raw", close_raw),
        "status_label": clip("status_label", item.get("status_label")),
        "status_code": clip("status_code", item.get("status_code")),
        "bid_price": bid_price,
        "bid_price_raw": clip("bid_price_raw", bid_raw),
        "bid_form": clip("bid_form", item.get("bid_form")),
        "source_url": item.get("source_url"),
        "collected_at": clip("collected_at", collected_at),
        "name_f": clip("name_f", fold(name) if name else None),
        "province_f": clip("province_f", fold(province) if province else None),
    }


def build_rollup_row(item: dict):
    loai = "" if item.get("loai") is None else str(item.get("loai"))
    ym = "" if item.get("ym") is None else str(item.get("ym"))[:7]
    ma_tinh = "" if item.get("ma_tinh") is None else str(item.get("ma_tinh"))
    nhom = "" if item.get("nhomthau") is None else str(item.get("nhomthau"))
    year = split_year(item.get("nam"))
    if year is None:
        year = 0
    amount = item.get("sum_thanhtien")
    try:
        quantized = Decimal(str(amount if amount is not None else "0")).quantize(Decimal("0.01"))
    except InvalidOperation:
        quantized = Decimal("0.00")
    try:
        cnt = int(item.get("cnt") or 0)
    except (TypeError, ValueError):
        cnt = 0
    return {
        "loai": clip("loai", loai) or "",
        "nam": year,
        "ym": ym,
        "ma_tinh": clip("ma_tinh", ma_tinh) or "",
        "nhomthau": clip("nhomthau", nhom) or "",
        "sum_thanhtien": format(quantized, "f"),
        "cnt": cnt,
    }


def build_suggest_row(item: dict):
    section = clip("section", item.get("section"))
    field = clip("field", item.get("field"))
    value = clip("value", item.get("value"))
    if not section or not field or value is None or value == "":
        return None
    try:
        cnt = int(item.get("cnt") or 0)
    except (TypeError, ValueError):
        cnt = 0
    return {"section": section, "field": field, "value": value, "cnt": cnt}


def upsert_sql(table: str, columns: tuple[str, ...], nrows: int) -> str:
    if table not in PRIMARY_KEYS:
        raise KeyError(table)
    if nrows < 1:
        raise ValueError("nrows")
    keys = set(PRIMARY_KEYS[table])
    col_sql = ", ".join(columns)
    one = "(" + ", ".join(["%s"] * len(columns)) + ")"
    values = ", ".join([one] * nrows)
    updates = ", ".join(f"{column}=VALUES({column})" for column in columns if column not in keys)
    return (
        f"INSERT INTO {table} ({col_sql}) VALUES {values} "
        f"ON DUPLICATE KEY UPDATE {updates}"
    )


def row_args(row: dict, columns: tuple[str, ...]) -> list:
    return [row.get(column) for column in columns]


def self_check() -> list[str]:
    """Local fixtures. Empty list means the dirty-value contract holds."""
    failures = []
    row = build_vss_row({
        "fingerprint": "fp1",
        "raw": {
            "gia": "380.000",
            "thanhtien": "không rõ",
            "soluong": "1,5",
            "tungay_hd": "2024-01-02",
            "denngay_hd": "32/13/2024",
            "hoatchat": "Amoxicillin",
            "ten": "Hà Nội",
            "ten_tinh": "Đà Nẵng",
            "nam": "2026",
        },
    })
    expect = {
        "gia": "380000.00",
        "gia_raw": "380.000",
        "thanhtien": None,
        "thanhtien_raw": "không rõ",
        "tungay_hd": "2024-01-02",
        "denngay_hd": None,
        "denngay_hd_raw": "32/13/2024",
        "hoatchat_f": "amoxicillin",
        "ten_f": "ha noi",
        "ten_tinh_f": "da nang",
        "nam": 2026,
    }
    for key, value in expect.items():
        if row.get(key) != value:
            failures.append(f"{key}={row.get(key)!r} expected {value!r}")
    if row.get("soluong") in (None, ""):
        failures.append("soluong parsed empty")
    sql = upsert_sql("vss_bids", VSS_COLUMNS, 2)
    if "ON DUPLICATE KEY UPDATE" not in sql or "fp_hash=VALUES(fp_hash)" in sql:
        failures.append("upsert sql")
    if "fingerprint=VALUES(fingerprint)" not in sql:
        failures.append("fingerprint not updated")
    if sql.count("%s") != 2 * len(VSS_COLUMNS):
        failures.append("placeholder count")
    folded = fold("Cefuroxim")
    if folded != "cefuroxim":
        failures.append(f"fold {folded}")
    return failures
