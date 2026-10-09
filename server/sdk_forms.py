# -*- coding: utf-8 -*-
"""SĐK → dạng bào chế, read once from the DAV catalog."""
from __future__ import annotations

import re
import sqlite3
import threading
import os
from pathlib import Path

from .common import DAV_DB

_lock = threading.Lock()
_by_sdk: dict[str, str] | None = None
_stamp = None


def norm_sdk(value) -> str:
    return re.sub(r"\s+", "", str(value or "")).upper()


def _load() -> dict[str, str]:
    global _by_sdk, _stamp
    path = Path(os.environ['ANALYTICS_DB_DIR'])/'dav.sqlite3' if os.environ.get('ANALYTICS_DB_DIR') else DAV_DB
    stamp = (str(path), path.stat().st_mtime_ns if path.exists() else None)
    if _by_sdk is not None and _stamp == stamp:
        return _by_sdk
    with _lock:
        if _by_sdk is not None and _stamp == stamp:
            return _by_sdk
        found = {}
        if path.exists():
            con = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
            try:
                rows = con.execute(
                    """
                    SELECT json_extract(raw, '$.soDangKy'),
                           json_extract(raw, '$.soDangKyCu'),
                           coalesce(
                             json_extract(raw, '$.thongTinThuocCoBan.dangBaoChe'),
                             json_extract(raw, '$.dangBaoChe'),
                             ''
                           )
                    FROM drugs
                    """
                )
                for sdk, old, form in rows:
                    text = str(form or "").strip()
                    if not text:
                        continue
                    for raw in (sdk, old):
                        key = norm_sdk(raw)
                        if key:
                            found.setdefault(key, set()).add(text)
            finally:
                con.close()
        _by_sdk = {key:next(iter(values)) for key,values in found.items() if len(values)==1}
        _stamp = stamp
        return _by_sdk


def form_for(sdk) -> str:
    key = norm_sdk(sdk)
    if not key:
        return ""
    return _load().get(key, "")


def forms_for(sdks) -> dict[str, str]:
    table = _load()
    out = {}
    for sdk in sdks or []:
        key = norm_sdk(sdk)
        if key and key not in out:
            out[key] = table.get(key, "")
    return out
