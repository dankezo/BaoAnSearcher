"""Build local, historical group evidence for the Bao An catalog.

The output is an ignored research artifact. Observed groups are historical
source values only and must not be populated into catalog tender_group.
"""
from __future__ import annotations

import json
import re
import sqlite3
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "api-lib" / "baoan_products.json"
DAV_DB = ROOT / "test zone" / "data" / "thuoc.sqlite3"
VSS_DB = ROOT / "data" / "vss_bhyt.sqlite3"
MSC_DB = ROOT / "test zone" / "procurement" / "data" / "procurement.sqlite3"
OUTPUT = ROOT / "data" / "baoan_group_evidence.json"
SDK_RE = re.compile(r"\b(?:[A-Z]{1,5}[-\s]?\d{2,8}[-\s]\d{2,4}|\d{12})\b", re.I)


def sdk_key(value: object) -> str:
    return "".join(ch for ch in str(value or "").upper() if ch.isalnum())


def sdk_values(value: object) -> list[str]:
    values = {match.strip() for match in SDK_RE.findall(str(value or ""))}
    return sorted(v for v in values if sdk_key(v))


def load_dav_links(products: list[dict]) -> dict[str, dict]:
    wanted = {sdk_key(p.get("reg_number")): p["id"] for p in products}
    result = {p["id"]: {"current": p.get("reg_number") or "", "old": set(), "dav": None}
              for p in products}
    if not DAV_DB.exists():
        return result
    with sqlite3.connect(DAV_DB) as con:
        for (raw,) in con.execute("SELECT raw FROM drugs"):
            try:
                row = json.loads(raw)
            except (TypeError, json.JSONDecodeError):
                continue
            current = str(row.get("soDangKy") or "").strip()
            product_id = wanted.get(sdk_key(current))
            if not product_id:
                continue
            item = result[product_id]
            old = sdk_values(row.get("soDangKyCu"))
            current_key = sdk_key(current)
            item["old"].update(value for value in old if sdk_key(value) != current_key)
            item["dav"] = {
                "matched_current_registration": current,
                "registrant": (row.get("congTyDangKy") or {}).get("tenCongTyDangKy") or "",
                "active": row.get("isActive"),
                "expired": row.get("isHetHan"),
            }
    return result


def add_group(groups: dict, source: str, group: str, registration: str,
              registration_link: str, example: dict) -> None:
    key = (source, str(group or "").strip() or "(blank)", sdk_key(registration))
    entry = groups.setdefault(key, {
        "source": source, "group": key[1], "matched_registration": registration,
        "registration_link": registration_link, "row_count": 0, "years": set(), "examples": [],
    })
    entry["row_count"] += 1
    if example.get("year"):
        entry["years"].add(str(example["year"]))
    if len(entry["examples"]) < 2 and example not in entry["examples"]:
        entry["examples"].append(example)


def main() -> None:
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply',action='store_true',help='Add historical evidence to local and cloud catalogs; never set tender_group')
    args=parser.parse_args()
    products = json.loads(CATALOG.read_text(encoding="utf-8"))
    links = load_dav_links(products)
    groups_by_product = {p["id"]: {} for p in products}
    reg_links = defaultdict(list)
    for product in products:
        link = links[product["id"]]
        registrations = {sdk_key(link["current"]): (link["current"], "current")}
        for old in link["old"]:
            if old not in registrations:
                registrations[old] = (old, "old")
        for reg, relation in registrations.values():
            reg_links[sdk_key(reg)].append((product, relation, reg))

    source_summaries = {"VSS": 0, "MSC": 0}
    all_regs = sorted({reg for matches in reg_links.values() for _, _, reg in matches})
    if VSS_DB.exists() and all_regs:
        with sqlite3.connect(VSS_DB) as con:
            slots = ",".join("?" for _ in all_regs)
            rows = con.execute(
                "SELECT sodk, ten, hoatchat, json_extract(raw, '$.hamluong'), nhomthau, nam, loai_thau, "
                "json_extract(raw, '$.ten_tinh'), json_extract(raw, '$.ten_cskcb'), "
                f"tungay_hd, denngay_hd FROM bids WHERE sodk IN ({slots})", all_regs,
            )
            for row in rows:
                (sodk, name, ingredient, strength, group, year, tender_type,
                 province, buyer, start, end) = row
                for product, relation, _ in reg_links.get(sdk_key(sodk), ()):
                    source_summaries["VSS"] += 1
                    add_group(groups_by_product[product["id"]], "VSS", group, sodk, relation, {
                        "year": year, "tender_type": tender_type or "", "product": name or "",
                        "ingredient": ingredient or "", "strength": strength or "",
                        "province": province or "", "buyer": buyer or "",
                        "contract_start": start or "", "contract_end": end or "",
                    })

    if MSC_DB.exists() and all_regs:
        with sqlite3.connect(MSC_DB) as con:
            slots = ",".join("?" for _ in all_regs)
            rows = con.execute(
                "SELECT normalized FROM records WHERE kind='prices' AND "
                f"json_extract(normalized, '$.registration') IN ({slots})", all_regs,
            )
            for (raw,) in rows:
                row = json.loads(raw)
                reg = str(row.get("registration") or "")
                for product, relation, _ in reg_links.get(sdk_key(reg), ()):
                    source_summaries["MSC"] += 1
                    add_group(groups_by_product[product["id"]], "MSC", row.get("group_name"), reg,
                              relation, {
                                  "year": str(row.get("published") or row.get("published_raw") or "")[:4],
                                  "tender_no": row.get("tender_no") or "",
                                  "product": row.get("name") or "",
                                  "ingredient": row.get("ingredient") or "",
                                  "strength": row.get("strength") or "",
                                  "province": row.get("province") or "",
                                  "buyer": row.get("buyer") or "",
                                  "source_url": row.get("source_url") or "",
                              })

    report_products = []
    for product in products:
        link = links[product["id"]]
        groups = groups_by_product[product["id"]]

        evidence = []
        for entry in groups.values():
            entry["years"] = sorted(entry["years"])
            evidence.append(entry)
        evidence.sort(key=lambda e: (e["source"], e["group"], e["matched_registration"]))
        observed = sorted({(e["source"], e["group"]) for e in evidence})
        counts = {
            "dav_current_registration_matches": int(link["dav"] is not None),
            "dav_old_registration_aliases": len(link["old"]),
            "vss_award_rows": sum(e["row_count"] for e in evidence if e["source"] == "VSS"),
            "msc_price_rows": sum(e["row_count"] for e in evidence if e["source"] == "MSC"),
        }
        report_products.append({
            "product_id": product.get("id"), "brand": product.get("brand_name") or "",
            "current_registration": link["current"],
            "old_registrations": sorted(link["old"]),
            "dav_record": link["dav"], "source_counts": counts,
            "observed_tender_groups": [
                {"source": source, "group": group} for source, group in observed
            ],
            "group_evidence": evidence,
        })

    output = {
        "generated_from_local_sources": True,
        "interpretation": "Historical observed groups only; not eligibility, recommendation, or tender_group.",
        "sources": {
            "DAV": "test zone/data/thuoc.sqlite3: current and old SDK links, registrant and status.",
            "VSS": "data/vss_bhyt.sqlite3: awarded bid rows and nhomthau.",
            "MSC": "test zone/procurement/data/procurement.sqlite3: price rows and group_name.",
        },
        "catalog_product_count": len(products),
        "products_with_dav_current_match": sum(bool(links[p["id"]]["dav"]) for p in products),
        "matched_vss_rows": source_summaries["VSS"],
        "matched_msc_price_rows": source_summaries["MSC"],
        "products": report_products,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.apply:
        by_id={p['product_id']:p for p in report_products}
        for path in (ROOT/'data'/'baoan_products.json',CATALOG):
            if not path.exists():
                continue
            catalog=json.loads(path.read_text(encoding='utf-8'))
            for item in catalog:
                evidence=by_id.get(item['id'],{})
                for key in ('group_evidence','observed_tender_groups','old_registrations'):
                    item[key]=evidence.get(key,[])
                item['tender_group_status']='Đã xác minh' if item.get('tender_group') else 'Cần rà soát'
            path.write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k: output[k] for k in (
        "catalog_product_count", "products_with_dav_current_match",
        "matched_vss_rows", "matched_msc_price_rows")}, ensure_ascii=False))
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    main()
