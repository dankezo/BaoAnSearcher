# -*- coding: utf-8 -*-
"""SĐK → dạng bào chế, read once from the DAV catalog."""
from __future__ import annotations

import re
import sqlite3
import threading

from .common import DAV_DB

_lock = threading.Lock()
_by_sdk: dict[str, str] | None = None


def norm_sdk(value) -> str:
    return re.sub(r"\s+", "", str(value or "")).upper()


def _load() -> dict[str, str]:
    global _by_sdk
    if _by_sdk is not None:
        return _by_sdk
    with _lock:
        if _by_sdk is not None:
            return _by_sdk
        found: dict[str, str] = {}
        if DAV_DB.exists():
            con = sqlite3.connect(f"file:{DAV_DB}?mode=ro", uri=True)
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
                        if key and key not in found:
                            found[key] = text
            finally:
                con.close()
        _by_sdk = found
        return found


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
