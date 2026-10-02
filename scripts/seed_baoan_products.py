# -*- coding: utf-8 -*-
"""Seed data/baoan_products.json from baoanpharma.com and the local DAV sqlite.

Registration numbers come from the site catalog (object keys) and are kept only
when DAV confirms the same soDangKy. The script does not invent SĐK values.
"""
from __future__ import annotations

import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from server.common import DAV_DB, fold  # noqa: E402
from server.dav import connect, flatten  # noqa: E402

OUT = ROOT / "data" / "baoan_products.json"
LIST_URL = "https://baoanpharma.com/products"
UA = {"User-Agent": "BaoAnSearcher-seed/1.0"}

# Pharmacological group, therapy bucket for BE rules, optional be_candidate.
# Groups follow the ingredient class. The site's category chip is usually a dosage form.
GROUPS = {
    "braforce": ("Thần kinh & sa sút trí tuệ", "neuro", False),
    "brasante": ("Thần kinh & sa sút trí tuệ", "neuro", False),
    "anbaserin": ("Thần kinh & sa sút trí tuệ", "neuro", False),
    "abanuro": ("Thần kinh & tuần hoàn não", "neuro", False),
    "anbaridol": ("Tâm thần", "psych", False),
    "sakiesmin": ("Mạch máu & trĩ, suy giãn tĩnh mạch", "vascular", False),
    "anbaescin": ("Mạch máu & trĩ, suy giãn tĩnh mạch", "vascular", False),
    "esinba": ("Mạch máu & trĩ, suy giãn tĩnh mạch", "vascular", False),
    "abagamax": ("Tuần hoàn & thị lực", "vascular", False),
    "ascorotix": ("Mạch máu & vi chất", "vascular", False),
    "rozymaxta": ("Tim mạch", "cardio", True),
    "adofebrat": ("Tim mạch", "cardio", False),
    "irsartan-ansba": ("Tim mạch", "cardio", False),
    "abarin-5": ("Tim mạch", "cardio", False),
    "abarin-10": ("Tim mạch", "cardio", False),
    "abivoltab": ("Tim mạch", "cardio", False),
    "anbagrel": ("Tim mạch", "cardio", False),
    "oraban": ("Tim mạch", "cardio", False),
    "guathimax": ("Tim mạch", "cardio", False),
    "batika": ("Tim mạch", "cardio", False),
    "anba-qe": ("Tim mạch", "cardio", False),
    "apizyltab": ("Tim mạch", "cardio", False),
    "gluratintab": ("Cơ xương khớp", "msk", False),
    "roitintab": ("Cơ xương khớp", "msk", False),
    "alphaba-s": ("Cơ xương khớp", "msk", False),
    "oflozylkab": ("Kháng sinh", "antibiotic", True),
    "mynoline": ("Kháng sinh", "antibiotic", False),
    "3bvit-ansba": ("Vitamin", "vitamin", False),
    "nurovitab": ("Vitamin", "vitamin", False),
    "b1b6b12-ansba": ("Vitamin", "vitamin", False),
    "bezynmax": ("Vitamin", "vitamin", False),
    "neuvitaba": ("Vitamin", "vitamin", False),
    "andomag-b6": ("Vitamin & khoáng chất", "vitamin", False),
    "sakicamax": ("Vitamin & khoáng chất", "vitamin", False),
    "andotazin": ("Hô hấp & dị ứng", "respiratory", False),
    "anbabrom": ("Hô hấp & dị ứng", "respiratory", False),
    "anbabrom-f": ("Hô hấp & dị ứng", "respiratory", False),
    "anbaburol": ("Hô hấp & dị ứng", "respiratory", False),
    "minomaxtyl": ("Dinh dưỡng lâm sàng", "metabolic", False),
    "anbaliv": ("Tiêu hóa & gan mật", "gi", False),
    "abamotic": ("Tiêu hóa & gan mật", "gi", False),
    "anbaluti": ("Chuyển hóa", "metabolic", False),
    "abanuti": ("Chuyển hóa", "metabolic", False),
    "ibupara-ansba": ("Giảm đau & kháng viêm", "pain", False),
    "dexifenmax": ("Giảm đau & kháng viêm", "pain", False),
}

STRATEGY = {
    "braforce": (
        "Thị trường thầu Memantin chủ yếu là viên nén 10mg. Dung dịch uống ống 5ml là ô kỹ thuật hiếm, "
        "giúp bệnh viện lập yêu cầu kỹ thuật riêng cho bệnh nhân cao tuổi khó nuốt tại khoa Thần kinh và Lão khoa."
    ),
    "irsartan-ansba": (
        "Viên ngậm phân tán ODT cho phép tách phân thầu kỹ thuật theo Điều 12 Thông tư 40/2025/TT-BYT, "
        "không đối đầu trực tiếp viên nén Nhóm 4."
    ),
    "sakiesmin": (
        "Ưu thế liều 1000mg 1 lần/ngày thay hàm lượng 500mg để chào thầu gói mua sắm tập trung của Sở Y tế."
    ),
    "rozymaxta": (
        "Đề xuất BE lên Nhóm 3; cảnh báo chuyển giao công nghệ sang cơ sở EU-GMP (Meracine) để lên Nhóm 2."
    ),
    "oflozylkab": (
        "Đề xuất BE lên Nhóm 3; cảnh báo chuyển giao công nghệ sang cơ sở EU-GMP (Meracine) để lên Nhóm 2."
    ),
    "3bvit-ansba": (
        "Trúng Danh mục 93, hưởng bảo hộ Điều 56 Luật Đấu thầu. Bệnh viện công lập bị cấm mời thầu thuốc nhập khẩu."
    ),
    "gluratintab": "Mật độ SĐK cao, kiểm soát giá, né thầu mở.",
}

DOSAGE_LABELS = {"vien nen", "vien nang", "dang long", "com / bot", "khac", "thuoc com"}


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as res:
        return res.read().decode("utf-8", "replace")


def js_string(text: str, start_quote: int) -> str:
    chars = []
    i = start_quote + 1
    while i < len(text):
        c = text[i]
        if c == "\\":
            n = text[i + 1]
            if n == "u":
                chars.append(chr(int(text[i + 2:i + 6], 16)))
                i += 6
                continue
            if n == "x":
                chars.append(chr(int(text[i + 2:i + 4], 16)))
                i += 4
                continue
            chars.append({"n": "\n", "r": "\r", "t": "\t", "'": "'", '"': '"', "\\": "\\"}.get(n, n))
            i += 2
            continue
        if c == "'":
            break
        chars.append(c)
        i += 1
    return "".join(chars)


def listing_order(html: str) -> list[tuple[str, str]]:
    order = []
    seen = set()
    for slug in re.findall(r'href="/products/([a-z0-9-]+)"', html):
        if slug not in seen:
            seen.add(slug)
            order.append(slug)
    names = {}
    for slug, name in re.findall(r'href="/products/([a-z0-9-]+)"><h3[^>]*>([^<]+)</h3>', html):
        names[slug] = re.sub(r"\s+", " ", name).strip()
    return [(slug, names.get(slug) or slug) for slug in order]


def load_site_catalog(html: str) -> dict:
    srcs = re.findall(r'src="(/_next/static/chunks/[^"]+\.js)"', html)
    catalog = None
    for src in srcs:
        body = fetch("https://baoanpharma.com" + src)
        idx = body.find("JSON.parse(")
        if idx < 0 or '"slug"' not in body[idx:idx + 400]:
            continue
        quote = body.find("'", idx)
        data = json.loads(js_string(body, quote))
        bucket = data.get("Z") if isinstance(data, dict) else None
        if isinstance(bucket, dict) and bucket:
            catalog = bucket
            break
    if not catalog:
        raise SystemExit("Không thấy catalog sản phẩm trong JS của baoanpharma.com/products")
    by_slug = {}
    for reg, rec in catalog.items():
        slug = rec.get("slug")
        if slug:
            by_slug[slug] = (str(reg).strip(), rec)
    return by_slug


def cycle_tag(flat: dict) -> str:
    """Cockpit cycle tag. A live SĐK with >= 18 months left stays green even if it matches DM93."""
    from server.dav import TAG_VANG, TAG_XAM, TAG_XANH

    dead = bool(flat.get("isDeleted") or flat.get("isDaRut") or flat.get("isHetHan") or flat.get("isActive") is False)
    months = flat.get("monthsLeft")
    if dead or (months is not None and float(months) < 0):
        return TAG_XAM
    if months is not None and float(months) >= 18:
        return TAG_XANH
    return TAG_VANG


def route_of(record: dict, dosage: str) -> str:
    tt = record.get("thongTinThuocCoBan") or {}
    route = str(tt.get("tenDuongDung") or "").strip()
    if route:
        return route
    d = fold(dosage)
    if "tiem" in d:
        return "Tiêm"
    if any(x in d for x in ("uong", "vien", "nen", "nang", "com", "bot", "nhai", "goi")):
        return "Uống"
    return ""


def strength_of(flat: dict, rec: dict) -> str:
    hl = str(flat.get("hamLuong") or "").strip()
    if hl:
        return re.sub(r"\s+", " ", hl)
    parts = []
    for item in rec.get("composition") or []:
        amount = str(item.get("amount") or "").strip()
        if amount:
            parts.append(amount)
    if parts:
        return "; ".join(parts)
    return ""


def packing_of(flat: dict, rec: dict) -> str:
    pack = str(flat.get("dongGoi") or "").strip()
    if pack:
        return re.sub(r"\s+", " ", pack)
    return re.sub(r"\s+", " ", str(rec.get("packSize") or "")).strip()


def inn_of(flat: dict, rec: dict) -> str:
    hc = str(flat.get("hoatChat") or "").strip()
    if hc:
        return re.sub(r"\s+", " ", hc)
    names = [str(c.get("name") or "").strip() for c in (rec.get("composition") or [])]
    return "; ".join(n for n in names if n)


def exp_date(flat: dict) -> str:
    raw = str(flat.get("ngayHetHan") or "")
    m = re.match(r"(\d{4}-\d{2}-\d{2})", raw)
    return m.group(1) if m else ""


def find_by_sdk(con, sdk: str):
    row = con.execute("SELECT raw FROM drugs WHERE search LIKE ? LIMIT 1", (f"%{fold(sdk)}%",)).fetchone()
    if not row:
        return None
    record = json.loads(row[0])
    flat = flatten(record)
    if fold(flat.get("soDangKy")) != fold(sdk) and fold(sdk) not in fold(flat.get("soDangKyCu") or ""):
        return None
    return record, flat


def alt_active(con, brand: str, primary: str) -> list[str]:
    token = fold(brand)
    if len(token) < 4:
        return []
    rows = con.execute("SELECT raw FROM drugs WHERE search LIKE ? LIMIT 40", (f"%{token}%",)).fetchall()
    found = []
    for (raw,) in rows:
        record = json.loads(raw)
        flat = flatten(record)
        name = fold(flat.get("tenThuoc") or "")
        if token not in name:
            continue
        sdk = str(flat.get("soDangKy") or "")
        if not sdk or fold(sdk) == fold(primary):
            continue
        if flat.get("conHieuLuc") and sdk not in found:
            found.append(sdk)
    return found


def pharma_category(slug: str, rec: dict) -> tuple[str, str, bool]:
    if slug in GROUPS:
        return GROUPS[slug]
    labels = rec.get("categoryLabels") or []
    for label in labels:
        if fold(label) not in DOSAGE_LABELS and "vien" not in fold(label) and "dung dich" not in fold(label):
            return label, "other", False
    return "Khác", "other", False


def main() -> None:
    if not DAV_DB.exists():
        raise SystemExit(f"Thiếu DAV sqlite: {DAV_DB}")
    html = fetch(LIST_URL)
    listed = listing_order(html)
    by_slug = load_site_catalog(html)
    if len(by_slug) != 45:
        print(f"Cảnh báo: catalog JS có {len(by_slug)} sản phẩm, trang liệt kê {len(listed)} slug")
    con = connect()
    products = []
    matched = 0
    try:
        ordered = listed or [(slug, slug) for slug in by_slug]
        # Keep site slugs that the listing omitted, then drop listing slugs missing from the catalog.
        seen = {slug for slug, _ in ordered}
        for slug in by_slug:
            if slug not in seen:
                ordered.append((slug, slug))
        seq = 0
        for slug, list_name in ordered:
            if slug not in by_slug:
                continue
            seq += 1
            site_reg, rec = by_slug[slug]
            brand = list_name if list_name != slug else slug
            hit = find_by_sdk(con, site_reg)
            category, therapy, be_candidate = pharma_category(slug, rec)
            item = {
                "id": seq,
                "brand_name": brand,
                "reg_number": "",
                "inn": "",
                "strength": "",
                "dosage_form": "",
                "route": "",
                "packing": re.sub(r"\s+", " ", str(rec.get("packSize") or "")).strip(),
                "category": category,
                "therapy_class": therapy,
                "be_candidate": be_candidate,
                "manufacturer": "",
                "exp_date": "",
                "tag": "",
                "is_niche_gold": None,
                "web_url": f"https://baoanpharma.com/products/{slug}",
                "slug": slug,
                "dav_matched": False,
            }
            note = STRATEGY.get(slug)
            if note:
                item["strategy_note"] = note
            if hit:
                record, flat = hit
                matched += 1
                item["dav_matched"] = True
                item["reg_number"] = flat.get("soDangKy") or ""
                item["inn"] = inn_of(flat, rec)
                item["strength"] = strength_of(flat, rec)
                item["dosage_form"] = re.sub(r"\s+", " ", str(flat.get("dangBaoChe") or "")).strip()
                item["route"] = route_of(record, item["dosage_form"])
                item["packing"] = packing_of(flat, rec) or item["packing"]
                item["manufacturer"] = re.sub(r"\s+", " ", str(flat.get("ctySanXuat") or "")).strip()
                item["exp_date"] = exp_date(flat)
                item["tag"] = cycle_tag(flat)
                item["con_hieu_luc"] = bool(flat.get("conHieuLuc"))
                alts = alt_active(con, brand, item["reg_number"])
                if alts:
                    item["alt_reg_numbers"] = alts
                    item["sdk_note"] = "Có thêm SĐK còn hiệu lực: " + ", ".join(alts)
            else:
                item["inn"] = inn_of({"hoatChat": ""}, rec)
                item["strength"] = strength_of({"hamLuong": ""}, rec)
                forms = rec.get("dosageFormsAndStrengths") or ""
                item["dosage_form"] = str(forms).split(".")[0].strip()
            products.append(item)
    finally:
        con.close()

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(products, ensure_ascii=False, indent=2), encoding="utf-8")
    cats = sorted({p["category"] for p in products})
    print(f"wrote {OUT} products={len(products)} dav_matched={matched} categories={len(cats)}")
    for c in cats:
        print(" -", c)


if __name__ == "__main__":
    main()
