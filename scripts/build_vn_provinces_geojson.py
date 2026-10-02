# -*- coding: utf-8 -*-
"""Build a small public-domain province map from Natural Earth 10m admin-1."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "scripts" / "_ne10.geojson"
OUT = ROOT / "web" / "public" / "data" / "vn-provinces.geojson"

# Official pre-2025 province codes used by VSS ma_tinh.
PROVINCES = {
    "01": "Hà Nội",
    "02": "Hà Giang",
    "04": "Cao Bằng",
    "06": "Bắc Kạn",
    "08": "Tuyên Quang",
    "10": "Lào Cai",
    "11": "Điện Biên",
    "12": "Lai Châu",
    "14": "Sơn La",
    "15": "Yên Bái",
    "17": "Hòa Bình",
    "19": "Thái Nguyên",
    "20": "Lạng Sơn",
    "22": "Quảng Ninh",
    "24": "Bắc Giang",
    "25": "Phú Thọ",
    "26": "Vĩnh Phúc",
    "27": "Bắc Ninh",
    "30": "Hải Dương",
    "31": "Hải Phòng",
    "33": "Hưng Yên",
    "34": "Thái Bình",
    "35": "Hà Nam",
    "36": "Nam Định",
    "37": "Ninh Bình",
    "38": "Thanh Hóa",
    "40": "Nghệ An",
    "42": "Hà Tĩnh",
    "44": "Quảng Bình",
    "45": "Quảng Trị",
    "46": "Thừa Thiên Huế",
    "48": "Đà Nẵng",
    "49": "Quảng Nam",
    "51": "Quảng Ngãi",
    "52": "Bình Định",
    "54": "Phú Yên",
    "56": "Khánh Hòa",
    "58": "Ninh Thuận",
    "60": "Bình Thuận",
    "62": "Kon Tum",
    "64": "Gia Lai",
    "66": "Đắk Lắk",
    "67": "Đắk Nông",
    "68": "Lâm Đồng",
    "70": "Bình Phước",
    "72": "Tây Ninh",
    "74": "Bình Dương",
    "75": "Đồng Nai",
    "77": "Bà Rịa - Vũng Tàu",
    "79": "Hồ Chí Minh",
    "80": "Long An",
    "82": "Tiền Giang",
    "83": "Bến Tre",
    "84": "Trà Vinh",
    "86": "Vĩnh Long",
    "87": "Đồng Tháp",
    "89": "An Giang",
    "91": "Kiên Giang",
    "92": "Cần Thơ",
    "93": "Hậu Giang",
    "94": "Sóc Trăng",
    "95": "Bạc Liêu",
    "96": "Cà Mau",
}

ALIASES = {
    "ha noi": "01",
    "ho chi minh": "79",
    "thanh pho ho chi minh": "79",
    "ho chi minh city": "79",
    "can tho": "92",
    "hai phong": "31",
    "da nang": "48",
    "thua thien hue": "46",
    "thua thien - hue": "46",
    "ba ria - vung tau": "77",
    "ba ria vung tau": "77",
    "dong thap": "87",
    "quang nam": "49",
    "quang nam ": "49",
    "dak lak": "66",
    "dak nong": "67",
    "hoa binh": "17",
}


def fold(text: str) -> str:
    import unicodedata
    s = str(text or "").lower().replace("đ", "d").replace("ð", "d")
    s = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")
    return " ".join(s.replace("-", " ").replace("–", " ").split())


BY_NAME = {fold(name): code for code, name in PROVINCES.items()}
BY_NAME.update(ALIASES)


def match_code(prop: dict) -> str | None:
    for key in ("name_vi", "name"):
        token = fold(prop.get(key) or "")
        token = token.removeprefix("tinh ").removeprefix("thanh pho ").removeprefix("tp ")
        if token in BY_NAME:
            return BY_NAME[token]
    return None


def simplify_ring(ring, epsilon=0.045):
    if len(ring) <= 6:
        return [[round(pt[0], 3), round(pt[1], 3)] for pt in ring]
    kept = [ring[0]]
    for pt in ring[1:]:
        prev = kept[-1]
        if abs(pt[0] - prev[0]) + abs(pt[1] - prev[1]) >= epsilon:
            kept.append(pt)
    if kept[-1] != ring[-1]:
        kept.append(ring[-1])
    if len(kept) < 4:
        kept = ring[:: max(1, len(ring) // 6)] or ring[:4]
    return [[round(pt[0], 3), round(pt[1], 3)] for pt in kept]


def simplify_geometry(geom):
    gtype = geom.get("type")
    coords = geom.get("coordinates") or []
    if gtype == "Polygon":
        return {"type": "Polygon", "coordinates": [simplify_ring(ring) for ring in coords if len(ring) >= 4]}
    if gtype == "MultiPolygon":
        polygons = []
        for poly in coords:
            rings = [simplify_ring(ring) for ring in poly if len(ring) >= 4]
            if rings:
                polygons.append(rings)
        return {"type": "MultiPolygon", "coordinates": polygons}
    return geom


def main():
    data = json.loads(SRC.read_text(encoding="utf-8"))
    features = []
    skipped = []
    for feature in data["features"]:
        prop = feature.get("properties") or {}
        if prop.get("admin") != "Vietnam":
            continue
        code = match_code(prop)
        if not code:
            skipped.append(prop.get("name"))
            continue
        features.append({
            "type": "Feature",
            "properties": {"ma": code, "name": PROVINCES[code]},
            "geometry": simplify_geometry(feature.get("geometry") or {}),
        })
    features.sort(key=lambda item: item["properties"]["ma"])
    payload = {
        "type": "FeatureCollection",
        "name": "Vietnam provinces (Natural Earth 10m, simplified)",
        "features": features,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    present = {f["properties"]["ma"] for f in features}
    missing = [f"{code} {name}" for code, name in PROVINCES.items() if code not in present]
    print(f"wrote {OUT} features={len(features)} bytes={OUT.stat().st_size}")
    print("skipped", skipped)
    print("missing", missing)


if __name__ == "__main__":
    main()
