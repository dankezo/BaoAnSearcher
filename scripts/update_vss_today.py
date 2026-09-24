# -*- coding: utf-8 -*-
"""Crawl VSS via Excel export (1 request/day), not HTML pagination."""
from __future__ import annotations
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server import vss
from server.common import load_status


def wait_idle(timeout=7200):
    start = time.time()
    saw = False
    while time.time() - start < timeout:
        st = load_status().get("vss") or {}
        print(f"  state={st.get('state')} pct={st.get('progress')} msg={st.get('message')} count={vss.meta_info().get('count')}", flush=True)
        if st.get("state") == "running":
            saw = True
        if saw and st.get("state") in ("idle", "error"):
            return st
        if (not saw) and time.time() - start > 45:
            return st
        time.sleep(5)
    return load_status().get("vss", {})


def main():
    print("=== VSS export catch-up (90 ngày) ===", flush=True)
    print(vss.crawl_vss(days=90, loai=1, catchup=True, save_json=False), flush=True)
    print("done:", wait_idle(), vss.meta_info(), flush=True)


if __name__ == "__main__":
    main()
