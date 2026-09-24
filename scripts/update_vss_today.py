# -*- coding: utf-8 -*-
"""Crawl VSS then import more Excel rows."""
from __future__ import annotations
import time
from pathlib import Path

from server import vss
from server.common import load_status

EXCEL = Path(r"c:\Users\AD\Desktop\MouseWithoutBorders\Danh mục thuốc trúng thầu BHYT-2024.xls")


def wait_idle(app="vss", timeout=900):
    start = time.time()
    while time.time() - start < timeout:
        st = load_status().get(app, {})
        info = vss.meta_info()
        print(f"  state={st.get('state')} pct={st.get('progress')} msg={st.get('message')} count={info.get('count')}")
        if st.get("state") in ("idle", "error") and st.get("progress", 0) >= 0:
            # allow first tick
            if time.time() - start > 8:
                return st
        time.sleep(5)
    return load_status().get(app, {})


def main():
    print("=== VSS crawl 30 days ===")
    print(vss.crawl_vss(days=30, loai=1, max_pages=20))
    st = wait_idle()
    print("crawl done:", st, vss.meta_info())

    # Also try loai=2,3 if useful
    for loai in (2, 3):
        print(f"=== VSS crawl loai={loai} 14 days ===")
        print(vss.crawl_vss(days=14, loai=loai, max_pages=15))
        st = wait_idle()
        print("done:", st, vss.meta_info())

    if EXCEL.exists():
        print("=== Import Excel (up to 80k rows) ===")
        r = vss.import_spreadsheet_ml(EXCEL, max_rows=80000)
        print(r)
    else:
        print("Excel missing:", EXCEL)

    print("FINAL VSS", vss.meta_info())


if __name__ == "__main__":
    main()
