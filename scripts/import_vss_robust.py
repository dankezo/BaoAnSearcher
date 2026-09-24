# -*- coding: utf-8 -*-
"""Robust VSS Excel SpreadsheetML importer + live crawl fixes."""
from __future__ import annotations
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server import vss
from server.common import update_status, now_iso

EXCEL = Path(r"c:\Users\AD\Desktop\MouseWithoutBorders\Danh mục thuốc trúng thầu BHYT-2024.xls")

# Invalid XML 1.0 char refs often appear in SpreadsheetML exports
INVALID_CHAR_REF = re.compile(r"&#x0*(?:[0-8bcefBCEF]|1[0-9a-fA-F]|7[fF]);|&#0*(?:[0-8]|1[0-9]|1[2-9]|2[0-9]|3[01]);")
ROW_RE = re.compile(r"<Row[^>]*>(.*?)</Row>", re.I | re.S)
CELL_RE = re.compile(
    r'<Cell([^>]*)>\s*(?:<Data[^>]*>(.*?)</Data>)?',
    re.I | re.S,
)
INDEX_RE = re.compile(r'ss:Index="(\d+)"', re.I)


def cell_text(raw: str) -> str:
    if not raw:
        return ""
    t = re.sub(r"<[^>]+>", "", raw)
    t = (
        t.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&apos;", "'")
    )
    return t.strip()


def parse_row_cells(row_inner: str) -> list[str]:
    cells = []
    idx = 1
    for m in CELL_RE.finditer(row_inner):
        attrs, data = m.group(1) or "", m.group(2) or ""
        im = INDEX_RE.search(attrs)
        if im:
            want = int(im.group(1))
            while idx < want:
                cells.append("")
                idx += 1
        cells.append(cell_text(data))
        idx += 1
    return cells


def import_excel_robust(path: Path, max_rows: int | None = None) -> dict:
    update_status("vss", state="running", progress=1, message=f"Import regex {path.name}…", updated=now_iso())
    headers = None
    batch = []
    inserted = 0
    seen = 0
    buf = ""
    size = path.stat().st_size
    read_bytes = 0

    with path.open("r", encoding="utf-8", errors="replace") as f:
        while True:
            chunk = f.read(1024 * 1024)  # 1MB
            if not chunk:
                break
            read_bytes += len(chunk.encode("utf-8", errors="replace"))
            chunk = INVALID_CHAR_REF.sub("", chunk)
            buf += chunk
            # keep incomplete trailing row in buf
            parts = list(ROW_RE.finditer(buf))
            if not parts:
                if len(buf) > 5_000_000:
                    buf = buf[-500_000:]
                continue
            # process all complete rows except maybe last if buffer cut mid-row
            last_end = 0
            for i, m in enumerate(parts):
                # If this is the last match and buffer doesn't end soon after, might be incomplete — still OK for </Row>
                last_end = m.end()
                cells = parse_row_cells(m.group(1))
                if not any(cells):
                    continue
                if headers is None:
                    lower = [c.strip().lower().replace(" ", "_") for c in cells]
                    if lower and (lower[0] in ("loai_thau", "stt") or "hoatchat" in lower):
                        headers = lower
                        continue
                    headers = list(vss.COLUMNS)
                d = {c: "" for c in vss.COLUMNS}
                for j, h in enumerate(headers):
                    if h == "stt":
                        continue
                    key = h if h in vss.COLUMNS else (vss.COLUMNS[j] if j < len(vss.COLUMNS) else None)
                    if key:
                        d[key] = cells[j] if j < len(cells) else ""
                batch.append(d)
                seen += 1
                if len(batch) >= 800:
                    inserted += vss.save_rows(batch)
                    batch = []
                    pct = min(95, int(100 * read_bytes / max(1, size)))
                    update_status(
                        "vss",
                        progress=pct,
                        message=f"Import {seen:,} dòng (+{inserted:,})…",
                        updated=now_iso(),
                    )
                    print(f"  read={seen:,} inserted={inserted:,} pct~{pct}")
                if max_rows and seen >= max_rows:
                    buf = ""
                    break
            buf = buf[last_end:]
            if max_rows and seen >= max_rows:
                break

    if batch:
        inserted += vss.save_rows(batch)
    info = vss.meta_info()
    update_status(
        "vss",
        state="idle",
        progress=100,
        message=f"Import xong +{inserted:,}",
        updated=now_iso(),
        count=info["count"],
    )
    return {"read": seen, "inserted": inserted, "count": info["count"]}


def crawl_and_debug():
    import urllib.request
    import urllib.parse
    from datetime import datetime, timedelta
    from server.vss import parse_chi_tiet_html, save_rows, VSS_BASE

    total = 0
    today = datetime.now()
    for i in range(45):
        ngay = (today - timedelta(days=i)).strftime("%d/%m/%Y")
        for loai in (1, 2, 3):
            empty_pages = 0
            for page in range(25):
                url = f"{VSS_BASE}/kqdt/chiTiet?ngaycongbo={urllib.parse.quote(ngay)}&loai={loai}&page={page}"
                try:
                    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                    with urllib.request.urlopen(req, timeout=60) as resp:
                        html = resp.read().decode("utf-8", errors="replace")
                except Exception as e:
                    print(f"ERR {ngay} L{loai} p{page}: {e}")
                    break
                rows = parse_chi_tiet_html(html)
                if not rows:
                    # debug first miss
                    if page == 0:
                        from server.vss import TableParser
                        p = TableParser()
                        p.feed(html)
                        print(f"MISS {ngay} L{loai}: html={len(html)} tr={len(p.rows)} sample={p.rows[:2]}")
                    empty_pages += 1
                    if empty_pages >= 1:
                        break
                    continue
                empty_pages = 0
                for r in rows:
                    r["congbo"] = ngay
                    r["loai"] = r.get("loai") or {1: "Tân dược", 2: "Đông dược", 3: "Vị thuốc"}.get(loai, "")
                n = save_rows(rows)
                total += n
                print(f"OK {ngay} L{loai} p{page}: rows={len(rows)} +{n} total+{total}")
    info = vss.meta_info()
    update_status("vss", state="idle", progress=100, message=f"Crawl +{total}", updated=now_iso(), count=info["count"])
    return total


if __name__ == "__main__":
    print("Excel exists", EXCEL.exists(), EXCEL)
    if EXCEL.exists():
        print(import_excel_robust(EXCEL, max_rows=None))
    print("Crawl…")
    try:
        print("crawl inserted", crawl_and_debug())
    except Exception as e:
        print("crawl failed", e)
    print("FINAL", vss.meta_info())
