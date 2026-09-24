# -*- coding: utf-8 -*-
"""One-shot VSS catch-up crawl (up to 90 days, stop on empty streak)."""
from __future__ import annotations
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server import vss
from server.common import load_status


def main():
    print("meta before", vss.meta_info())
    print(vss.crawl_vss(days=90, loai=1, max_pages=40, catchup=True))
    saw_running = False
    start = time.time()
    while time.time() - start < 7200:
        st = load_status().get("vss") or {}
        print(f"  state={st.get('state')} pct={st.get('progress')} msg={st.get('message')} count={vss.meta_info().get('count')}")
        if st.get("state") == "running":
            saw_running = True
        if saw_running and st.get("state") in ("idle", "error"):
            break
        if (not saw_running) and time.time() - start > 45:
            print("never saw running — check if another crawl holds the lock")
            break
        time.sleep(8)
    print("FINAL", vss.meta_info(), load_status().get("vss"))


if __name__ == "__main__":
    main()
