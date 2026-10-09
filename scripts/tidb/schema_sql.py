# -*- coding: utf-8 -*-
"""Split tidb/001 and tidb/002 into single statements. Does not open a connection."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_FILES = (
    ROOT / "tidb" / "001_search_schema.sql",
    ROOT / "tidb" / "002_perf_schema.sql",
    ROOT / "tidb" / "003_msc_fast_lookup.sql",
    ROOT / "tidb" / "004_data_registry_meta.sql",
    ROOT / "tidb" / "005_msc_price_metric_rollup.sql",
    ROOT / "tidb" / "006_dav_groups_and_msc_identity.sql",
    ROOT / "tidb" / "007_msc_price_daily_units.sql",
    ROOT / "tidb" / "008_msc_open_date.sql",
)


def strip_comments(text: str) -> str:
    kept = []
    for line in text.splitlines():
        buf = []
        in_quote = False
        index = 0
        while index < len(line):
            char = line[index]
            if char == "'":
                in_quote = not in_quote
                buf.append(char)
                index += 1
                continue
            if not in_quote and char == "-" and index + 1 < len(line) and line[index + 1] == "-":
                break
            buf.append(char)
            index += 1
        kept.append("".join(buf))
    return "\n".join(kept)


def split_sql(text: str) -> list[str]:
    text = strip_comments(text)
    statements = []
    buf = []
    in_quote = False
    for char in text:
        if char == "'":
            in_quote = not in_quote
            buf.append(char)
            continue
        if char == ";" and not in_quote:
            statement = "".join(buf).strip()
            buf = []
            if _meaningful(statement):
                statements.append(statement)
            continue
        buf.append(char)
    tail = "".join(buf).strip()
    if _meaningful(tail):
        statements.append(tail)
    return statements


def _meaningful(statement: str) -> bool:
    for line in statement.splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("--"):
            return True
    return False


def load_statements() -> list[tuple[str, str]]:
    loaded = []
    for path in SCHEMA_FILES:
        text = path.read_text(encoding="utf-8")
        for statement in split_sql(text):
            loaded.append((path.name, statement))
    return loaded
