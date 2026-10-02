# -*- coding: utf-8 -*-
"""Search protection for the FastAPI app (not a Next.js route).

Equivalent of the 4-layer plan, mapped onto this process:
1. The React client debounces typeahead and skips a 1-character text search.
2. This module is the cache: in-process LRU, TTL 12h. The response also sets
   Cache-Control: public, max-age=60, s-maxage=7200, stale-while-revalidate=86400.
   POST bodies are not cached by a CDN; the in-process cache is the layer that
   skips SQL when the same filters are repeated.
3. List SQL stays on real columns (see vss/dav/msc). No SELECT *.
4. 40 searches per minute per client IP on the search routes only.
"""
from __future__ import annotations

import copy
import json
import logging
import threading
import time
from collections import OrderedDict, deque
from collections.abc import Callable

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

from .common import fold

log = logging.getLogger("uvicorn.error")

# Public so a future CDN can honor it. Local POST search is not CDN-cached.
SEARCH_CACHE_CONTROL = "public, max-age=60, s-maxage=7200, stale-while-revalidate=86400"
SEARCHES_PER_MINUTE = 40
CACHE_TTL_SEC = 12 * 60 * 60
CACHE_MAX = 500
RATE_MESSAGE = "Đã vượt 40 lượt tìm mỗi phút. Vui lòng chờ rồi thử lại."


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for") or ""
    hop = forwarded.split(",")[0].strip()
    if hop:
        return hop
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _norm(value):
    if isinstance(value, dict):
        out = {}
        for key in sorted(value):
            item = _norm(value[key])
            if item is None or item == "" or item == [] or item is False:
                continue
            out[str(key)] = item
        return out
    if isinstance(value, (list, tuple)):
        items = []
        for item in value:
            norm = _norm(item)
            if norm is None or norm == "" or norm is False:
                continue
            items.append(norm)
        return sorted(items, key=lambda item: json.dumps(item, ensure_ascii=False, sort_keys=True))
    if isinstance(value, str):
        return fold(value).strip()
    if isinstance(value, bool):
        return bool(value)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value
    if value is None:
        return None
    return str(value)


def cache_key(section: str, filters: dict, page: int, size: int) -> str:
    payload = {
        "section": section,
        "filters": _norm(filters or {}),
        "page": int(page),
        "size": int(size),
    }
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


class _TtlLru:
    def __init__(self, max_entries: int, ttl_sec: int):
        self.max_entries = max_entries
        self.ttl_sec = ttl_sec
        self._data: OrderedDict[str, tuple[float, dict]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: str):
        now = time.monotonic()
        with self._lock:
            item = self._data.get(key)
            if item is None:
                return None
            expires, value = item
            if expires <= now:
                self._data.pop(key, None)
                return None
            self._data.move_to_end(key)
            return copy.deepcopy(value)

    def put(self, key: str, value: dict) -> None:
        now = time.monotonic()
        with self._lock:
            self._data[key] = (now + self.ttl_sec, copy.deepcopy(value))
            self._data.move_to_end(key)
            while len(self._data) > self.max_entries:
                self._data.popitem(last=False)


class _IpRateLimit:
    def __init__(self, limit: int, window_sec: int):
        self.limit = limit
        self.window_sec = window_sec
        self._hits: dict[str, deque] = {}
        self._lock = threading.Lock()

    def allow(self, ip: str) -> bool:
        now = time.monotonic()
        with self._lock:
            bucket = self._hits.setdefault(ip, deque())
            while bucket and now - bucket[0] >= self.window_sec:
                bucket.popleft()
            if len(bucket) >= self.limit:
                return False
            bucket.append(now)
            return True


_cache = _TtlLru(CACHE_MAX, CACHE_TTL_SEC)
_limit = _IpRateLimit(SEARCHES_PER_MINUTE, 60)


def guarded_search(request: Request, section: str, filters: dict, page: int, size: int, loader: Callable[[], dict]):
    """Rate-limit, then serve a cached JSON body. SQL runs only on a miss."""
    if not _limit.allow(client_ip(request)):
        raise HTTPException(429, RATE_MESSAGE)
    key = cache_key(section, filters, page, size)
    cached = _cache.get(key)
    if cached is not None:
        log.info("search cache HIT section=%s", section)
        hit = "HIT"
        payload = cached
    else:
        payload = loader()
        _cache.put(key, payload)
        log.info("search cache MISS section=%s", section)
        hit = "MISS"
    return JSONResponse(
        payload,
        headers={
            "Cache-Control": SEARCH_CACHE_CONTROL,
            "X-Search-Cache": hit,
        },
    )
