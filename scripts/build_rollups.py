# -*- coding: utf-8 -*-
"""Build VSS monthly rollup and suggest dictionary from local SQLite.

Writes data/rollups/agg_vss_monthly.jsonl and data/rollups/suggest_values.jsonl.
Does not open TiDB unless --yes-remote is passed and TIDB_* is set.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server.common import DAV_DB, MSC_DB, VSS_DB, configure_sqlite
from server.vss import parse_vn_number

OUT_DIR = ROOT / "data" / "rollups"


def blank(value) -> str:
    if value is None:
        return ""
    return str(value).strip()


def ym_of(*candidates) -> str:
    for raw in candidates:
        text = blank(raw)
        if len(text) >= 7 and text[4] == "-" and text[:4].isdigit() and text[5:7].isdigit():
            return text[:7]
    return ""


def year_of(nam, ym: str) -> int:
    try:
        parsed = int(nam)
    except (TypeError, ValueError):
        parsed = 0
    if parsed > 0:
        return parsed
    if len(ym) >= 4 and ym[:4].isdigit():
        return int(ym[:4])
    return 0


def line_amount(thanhtien, gia, soluong):
    total = parse_vn_number(thanhtien)
    if total is not None:
        return total
    price = parse_vn_number(gia)
    qty = parse_vn_number(soluong)
    if price is None or qty is None:
        return 0.0
    return price * qty


def connect_ro(path: Path):
    uri = path.resolve().as_posix()
    con = sqlite3.connect(f"file:{uri}?mode=ro", uri=True)
    configure_sqlite(con)
    return con


def build_vss(path: Path):
    groups = defaultdict(lambda: [0.0, 0])
    suggest = defaultdict(int)
    con = connect_ro(path)
    try:
        cur = con.execute(
            """
            SELECT COALESCE(loai, ''), nam, tungay_hd, COALESCE(ma_tinh, ''), COALESCE(nhomthau, ''),
                   json_extract(raw, '$.thanhtien'), json_extract(raw, '$.gia'),
                   json_extract(raw, '$.soluong'), json_extract(raw, '$.congbo'),
                   hoatchat, sodk, duongdung, nuocsx, loai_thau, ten,
                   json_extract(raw, '$.tennhathau'), json_extract(raw, '$.nhasx'),
                   json_extract(raw, '$.ten_cskcb'), json_extract(raw, '$.ten_tinh')
            FROM bids
            """
        )
        for loai, nam, tungay, ma_tinh, nhom, thanhtien, gia, soluong, congbo, hoatchat, sodk, duongdung, nuocsx, loai_thau, ten, tennhathau, nhasx, ten_cskcb, ten_tinh in cur:
            ym = ym_of(tungay, congbo)
            key = (blank(loai), year_of(nam, ym), ym, blank(ma_tinh), blank(nhom))
            bucket = groups[key]
            bucket[0] += line_amount(thanhtien, gia, soluong)
            bucket[1] += 1
            for field, value in (
                ("hoatchat", hoatchat),
                ("sodk", sodk),
                ("duongdung", duongdung),
                ("nuocsx", nuocsx),
                ("loai_thau", loai_thau),
                ("ten", ten),
                ("tennhathau", tennhathau),
                ("nhasx", nhasx),
                ("ten_cskcb", ten_cskcb),
                ("ten_tinh", ten_tinh),
            ):
                text = blank(value)
                if text:
                    suggest[("vss", field, text[:512])] += 1
    finally:
        con.close()
    rows = [
        {
            "loai": key[0],
            "nam": key[1],
            "ym": key[2],
            "ma_tinh": key[3],
            "nhomthau": key[4],
            "sum_thanhtien": f"{bucket[0]:.2f}",
            "cnt": bucket[1],
        }
        for key, bucket in groups.items()
    ]
    suggestions = [
        {"section": key[0], "field": key[1], "value": key[2], "cnt": cnt}
        for key, cnt in suggest.items()
    ]
    return rows, suggestions


def column_names(con, table: str) -> set[str]:
    return {row[1] for row in con.execute(f"PRAGMA table_info({table})")}


def add_suggest(con, suggestions, section, table, fields):
    names = column_names(con, table)
    for field, column in fields:
        if column not in names:
            continue
        for value, cnt in con.execute(
            f"SELECT {column}, COUNT(*) FROM {table} "
            f"WHERE {column} IS NOT NULL AND TRIM({column}) != '' GROUP BY {column}"
        ):
            text = blank(value)[:512]
            if text:
                suggestions.append({"section": section, "field": field, "value": text, "cnt": int(cnt)})


def add_json_suggest(con, suggestions, section, table, fields):
    if "raw" not in column_names(con, table):
        return
    for field, paths in fields:
        values = [f"json_extract(raw, '$.{path}')" for path in paths]
        expr = values[0] if len(values) == 1 else "COALESCE(" + ", ".join(values) + ")"
        for value, cnt in con.execute(
            f"SELECT {expr}, COUNT(*) FROM {table} WHERE {expr} IS NOT NULL "
            f"AND TRIM(CAST({expr} AS TEXT)) != '' GROUP BY 1"
        ):
            text = blank(value)[:512]
            if text:
                suggestions.append({"section": section, "field": field, "value": text, "cnt": int(cnt)})


def build_other_suggest(suggestions):
    if DAV_DB.exists():
        con = connect_ro(DAV_DB)
        try:
            tables = {row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            table = "drugs" if "drugs" in tables else None
            if table:
                add_json_suggest(con, suggestions, "dav", table, [
                    ("ten_thuoc", ("tenThuoc",)),
                    ("so_dang_ky", ("soDangKy",)),
                    ("hoat_chat", ("thongTinThuocCoBan.hoatChatChinh", "hoatChatChinh", "hoatChat")),
                    ("dang_bao_che", ("thongTinThuocCoBan.dangBaoChe", "dangBaoChe")),
                    ("cty_san_xuat", ("congTySanXuat.tenCongTySanXuat", "tenCongTySanXuat", "ctySanXuat")),
                    ("cty_dang_ky", ("congTyDangKy.tenCongTyDangKy", "tenCongTyDangKy", "ctyDangKy")),
                ])
        finally:
            con.close()
    if MSC_DB.exists():
        con = connect_ro(MSC_DB)
        try:
            tables = {row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if "records" not in tables:
                return
            for kind, section, fields in (
                ("prices", "msc_prices", ("name", "ingredient", "registration", "winner", "manufacturer", "buyer", "province")),
                ("tenders", "msc_tenders", ("name", "buyer", "province", "tender_no")),
            ):
                for field in fields:
                    try:
                        found = con.execute(
                            "SELECT json_extract(normalized, ?), COUNT(*) FROM records "
                            "WHERE kind = ? AND json_extract(normalized, ?) IS NOT NULL AND "
                            "(kind <> 'prices' OR NOT EXISTS (SELECT 1 FROM excel_matches m WHERE m.excel_id=records.source_id)) GROUP BY 1",
                            (f"$.{field}", kind, f"$.{field}"),
                        )
                    except sqlite3.Error as exc:
                        print(f"skip msc {field}: {exc}")
                        return
                    for value, cnt in found:
                        text = blank(value)[:512]
                        if text:
                            suggestions.append({
                                "section": section,
                                "field": field,
                                "value": text,
                                "cnt": int(cnt),
                            })
        finally:
            con.close()


def write_jsonl(path: Path, rows) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build local rollup files. TiDB load is opt-in.")
    parser.add_argument("--yes-remote", action="store_true", help="Insert the files into TiDB when TIDB_* is set.")
    args = parser.parse_args()
    if not VSS_DB.exists():
        print(f"skip missing {VSS_DB}")
        return
    print("rollup VSS…", flush=True)
    rows, suggestions = build_vss(VSS_DB)
    print("suggest DAV/MSC…", flush=True)
    build_other_suggest(suggestions)
    agg_path = OUT_DIR / "agg_vss_monthly.jsonl"
    sug_path = OUT_DIR / "suggest_values.jsonl"
    write_jsonl(agg_path, rows)
    write_jsonl(sug_path, suggestions)
    print(f"wrote {len(rows):,} rollup rows -> {agg_path}")
    print(f"wrote {len(suggestions):,} suggest rows -> {sug_path}")
    if args.yes_remote:
        print("File jsonl đã ghi. Nạp lên cluster bằng python scripts/tidb/sync_to_tidb.py --yes-remote sau khi schema 002 đã chạy.")
    else:
        print("TiDB unchanged. Pass --yes-remote only after the cluster and schema exist.")


if __name__ == "__main__":
    main()
