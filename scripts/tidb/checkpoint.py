# -*- coding: utf-8 -*-
"""Resume cursor for an idempotent TiDB sync. The file lives under data/ and is gitignored."""
from __future__ import annotations

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STATE_PATH = ROOT / "data" / ".tidb_sync_state.json"


def load_state(path: Path = STATE_PATH) -> dict:
    if not path.exists():
        return {}
    try:
        text = path.read_text(encoding="utf-8")
        if not text.strip().startswith("{"):
            return {}
        data = json.loads(text)
    except (OSError, json.JSONDecodeError, UnicodeError):
        return {}
    return data if isinstance(data, dict) else {}


def save_state(state: dict, path: Path = STATE_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(state, ensure_ascii=False, indent=2)
    tmp = path.parent / (path.name + ".tmp")
    with tmp.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp, path)


def resume_cursor(state: dict, key: str, stamp: dict | None) -> dict:
    """Keep the cursor when the source stamp matches. A changed file starts over."""
    entry = state.get(key) if isinstance(state.get(key), dict) else {}
    if stamp is None:
        return dict(entry)
    if entry.get("stamp") != stamp:
        return {"stamp": stamp, "sent": 0}
    return dict(entry)
