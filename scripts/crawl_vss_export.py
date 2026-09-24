# -*- coding: utf-8 -*-
"""
CLI: crawl KQĐT VSS qua /kqdt/export (1 Excel / ngày) → SQLite + optional JSON.

Cài đặt:
  pip install requests pandas openpyxl

Ví dụ:
  python scripts/crawl_vss_export.py --days 2
  python scripts/crawl_vss_export.py --from 2026-09-01 --to 2026-09-22 --json
  python scripts/crawl_vss_export.py --dates 22/09/2026,21/09/2026 --loai 1
"""
from __future__ import annotations
import argparse
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server import vss
from server.common import load_status, load_secrets


def main():
    p = argparse.ArgumentParser(description="Crawl VSS KQĐT via Excel export endpoint")
    p.add_argument("--days", type=int, default=2, help="Số ngày gần nhất (mặc định 2)")
    p.add_argument("--from", dest="date_from", help="Từ ngày YYYY-MM-DD hoặc DD/MM/YYYY")
    p.add_argument("--to", dest="date_to", help="Đến ngày YYYY-MM-DD hoặc DD/MM/YYYY")
    p.add_argument("--dates", help="Danh sách ngày cách nhau bởi dấu phẩy")
    p.add_argument("--loai", type=int, default=1, help="1=Tân dược")
    p.add_argument("--json", action="store_true", help="Ghi kqdt_YYYYMMDD.json vào data/vss_exports/")
    p.add_argument("--sync", action="store_true", help="Chạy đồng bộ (không dùng thread API)")
    args = p.parse_args()

    dates = [x.strip() for x in args.dates.split(",")] if args.dates else None
    days_list = vss.iter_crawl_days(
        days=None if (args.date_from or args.date_to or dates) else args.days,
        from_date=args.date_from,
        to_date=args.date_to,
        dates=dates,
    )
    print(f"Sẽ crawl {len(days_list)} ngày · loai={args.loai}", flush=True)

    if not args.sync:
        dates = [x.strip() for x in args.dates.split(",")] if args.dates else None
        print(vss.crawl_vss(
            days=args.days,
            loai=args.loai,
            catchup=False,
            from_date=args.date_from,
            to_date=args.date_to,
            dates=dates,
            save_json=args.json,
        ), flush=True)
        while True:
            st = load_status().get("vss") or {}
            print(f"  {st.get('state')} {st.get('progress')}% {st.get('message')}", flush=True)
            if st.get("state") in ("idle", "error") and st.get("progress", 0) >= 100:
                break
            if st.get("state") == "error":
                break
            time.sleep(3)
        print("FINAL", vss.meta_info(), flush=True)
        return

    # Sync path — resilient to transient network drops (continue next day)
    cookie = (load_secrets().get("vss") or {}).get("cookie") or ""
    total = 0
    fails = 0
    for i, ngay in enumerate(days_list):
        try:
            blob = vss.download_kqdt_export(ngay, loai=args.loai, cookie=cookie, retries=4, timeout=90)
            rows = vss.rows_from_export_bytes(blob)
            for r in rows:
                r.setdefault("congbo", ngay)
                r.setdefault("loai", "Tân dược")
            n = vss.save_rows(rows)
            total += n
            note = ""
            if args.json and rows:
                path = vss.write_day_json(rows, ngay)
                note = f" → {path}"
            print(f"[{i+1}/{len(days_list)}] {ngay}: {len(blob)/1024:.1f} KB · {len(rows)} dòng · +{n}{note}", flush=True)
            fails = 0
        except Exception as e:
            fails += 1
            print(f"[{i+1}/{len(days_list)}] {ngay}: LỖI {e}", flush=True)
            time.sleep(min(15 + fails * 5, 60))
            continue
        if i < len(days_list) - 1:
            time.sleep(3 + (i % 3))
    print("DONE +", total, vss.meta_info(), flush=True)


if __name__ == "__main__":
    main()
