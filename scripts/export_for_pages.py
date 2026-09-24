# -*- coding: utf-8 -*-
"""Export SQLite slices to web/public/data for GitHub Pages."""
from __future__ import annotations
import gzip
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server import dav, msc, vss
from server.common import WEB_PUBLIC


def write_gz(name: str, payload):
    WEB_PUBLIC.mkdir(parents=True, exist_ok=True)
    path = WEB_PUBLIC / f"{name}.json.gz"
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with gzip.open(path, "wb") as f:
        f.write(raw)
    # also plain sample head for debugging
    sample = WEB_PUBLIC / f"{name}.sample.json"
    if isinstance(payload, dict) and "items" in payload:
        sample.write_text(json.dumps({**payload, "items": payload["items"][:20]}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {path} ({path.stat().st_size/1e6:.2f} MB)")


def main():
    # DAV: export flattened compact list (may be large — cap optional via argv)
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
    print("Export DAV…")
    try:
        res = dav.search_drugs({}, page=0, size=limit)
        # Also dump more pages if needed
        items = list(res["items"])
        page = 1
        while len(items) < min(limit, res["total"]) and page < 200:
            more = dav.search_drugs({}, page=page, size=min(200, limit - len(items)))
            if not more["items"]:
                break
            items.extend(more["items"])
            page += 1
        write_gz("dav", {"total": res["total"], "exported": len(items), "items": items})
    except Exception as e:
        print("DAV skip:", e)

    print("Export MSC prices…")
    try:
        prices = msc.search("prices", {}, page=0, size=min(limit, 3000))
        write_gz("msc_prices", prices)
        tenders = msc.search("tenders", {}, page=0, size=min(limit, 2000))
        write_gz("msc_tenders", tenders)
    except Exception as e:
        print("MSC skip:", e)

    print("Export VSS…")
    try:
        bids = vss.search_bids({}, page=0, size=min(limit, 5000))
        write_gz("vss", bids)
    except Exception as e:
        print("VSS skip:", e)

    print("Done. Commit web/public/data/*.json.gz and push for Pages.")


if __name__ == "__main__":
    main()
