"""Bounded remote YCBG source backed by the existing Cloudflare crawl Worker.

Detail calls are batched (up to eight IDs) to amortize Browser Run actions and
respect the Worker-wide daily budget. The crawler should persist successful
details from each returned batch before scheduling the next one.
"""
from __future__ import annotations

import re

from scripts.cloud_browser import cloud_worker_post

DETAIL_BATCH_SIZE = 8
_ID = re.compile(r"^[A-Za-z0-9-]{1,64}$")


def search_page(page: int, fresh: bool = False) -> dict:
    """Return the page shape consumed by ``server.ycbg.crawl``."""
    if isinstance(page, bool) or not isinstance(page, int) or not 0 <= page <= 999:
        raise ValueError("Invalid YCBG page number.")
    data = cloud_worker_post("/ycbg/search", {"page": page, "fresh": bool(fresh)})
    result = data.get("page")
    if not isinstance(result, dict) or not isinstance(result.get("content"), list):
        raise ValueError("Crawl Worker returned no YCBG source page.")
    return result


def fetch_details(ids: list[str], fresh: bool = False) -> dict[str, dict]:
    """Fetch one bounded batch; values contain either ``detail`` or ``error``."""
    if not isinstance(ids, list) or not 1 <= len(ids) <= DETAIL_BATCH_SIZE:
        raise ValueError(f"YCBG detail batches must contain 1–{DETAIL_BATCH_SIZE} IDs.")
    if any(not isinstance(ident, str) or not _ID.fullmatch(ident) for ident in ids) or len(set(ids)) != len(ids):
        raise ValueError("Invalid or duplicate YCBG detail ID.")
    data = cloud_worker_post("/ycbg/details", {"ids": ids, "fresh": bool(fresh)}, timeout=(10, 150))
    rows = data.get("results")
    if not isinstance(rows, list):
        raise ValueError("Crawl Worker returned no YCBG detail results.")
    by_id = {}
    for row in rows:
        if not isinstance(row, dict) or row.get("id") not in ids or row["id"] in by_id:
            raise ValueError("Crawl Worker returned an invalid YCBG detail result.")
        ident = row["id"]
        detail = row.get("detail")
        if isinstance(detail, dict) and str((detail.get("bidoRequestQuote") or {}).get("id") or "") == ident:
            by_id[ident] = {"detail": detail}
        else:
            by_id[ident] = {"error": str(row.get("error") or "detail_fetch_failed")}
    if set(by_id) != set(ids):
        raise ValueError("Crawl Worker returned an incomplete YCBG detail batch.")
    return by_id


def batches(ids: list[str], size: int = DETAIL_BATCH_SIZE):
    """Yield bounded chunks suitable for ``fetch_details``."""
    if not 1 <= size <= DETAIL_BATCH_SIZE:
        raise ValueError(f"Batch size must be between 1 and {DETAIL_BATCH_SIZE}.")
    for start in range(0, len(ids), size):
        yield ids[start:start + size]
