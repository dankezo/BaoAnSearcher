# -*- coding: utf-8 -*-
"""Refresh DAV crawl (continue/complete) and MSC prices for recent window."""
from __future__ import annotations
import time
from datetime import date, timedelta

from server import dav, msc
from server.common import load_status, update_status, now_iso


def wait(app, timeout=3600):
    t0 = time.time()
    while time.time() - t0 < timeout:
        st = load_status().get(app, {})
        print(f"[{app}] {st.get('state')} {st.get('progress')}% {st.get('message')}")
        if st.get("state") in ("idle", "error") and time.time() - t0 > 5:
            return st
        time.sleep(4)
    return load_status().get(app, {})


def main():
    print("DAV meta before:", dav.meta_info())
    # Restart scan to pick up today's updates
    print(dav.start_crawl(restart=True))
    wait("dav", timeout=7200)
    print("DAV after:", dav.meta_info())

    end = date.today()
    start = end - timedelta(days=14)
    print("MSC prices", start, "->", end)
    print(msc.start_price_sync(start.isoformat(), end.isoformat(), refresh=False))
    wait("msc", timeout=3600)
    print("MSC after:", msc.meta_info())


if __name__ == "__main__":
    main()
