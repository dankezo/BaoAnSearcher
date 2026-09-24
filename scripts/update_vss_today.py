# -*- coding: utf-8 -*-
"""Crawl VSS catch-up (default) then optional Excel import."""
from __future__ import annotations
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server import vss
from server.common import load_status

EXCEL = Path(r"c:\Users\AD\Desktop\MouseWithoutBorders\Danh mục thuốc trúng thầu BHYT-2024.xls")


def wait_idle(app="vss", timeout=7200):
    start = time.time()
    saw_running = False
    while time.time() - start < timeout:
        st = load_status().get(app, {})
        info = vss.meta_info()
        print(f"  state={st.get('state')} pct={st.get('progress')} msg={st.get('message')} count={info.get('count')}")
        if st.get("state") == "running":
            saw_running = True
        if saw_running and st.get("state") in ("idle", "error"):
            return st
        if (not saw_running) and time.time() - start > 30 and st.get("state") == "idle":
            return st
        time.sleep(8)
    return load_status().get(app, {})


def main():
    print("=== VSS catch-up (up to 90 days, stop on empty streak) ===")
    print(vss.crawl_vss(days=90, loai=1, max_pages=40, catchup=True))
    st = wait_idle()
    print("catch-up done:", st, vss.meta_info())

    print("=== VSS 2 days for loai 2,3 ===")
    for loai in (2, 3):
        print(vss.crawl_vss(days=2, loai=loai, max_pages=20, catchup=False))
        st = wait_idle()
        print("done:", st, vss.meta_info())

    if EXCEL.exists():
        print("Excel present — skip auto-import (dùng Quản trị → Import nếu cần):", EXCEL.name)
    print("FINAL VSS", vss.meta_info())


if __name__ == "__main__":
    main()
