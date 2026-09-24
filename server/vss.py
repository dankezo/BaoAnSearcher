# -*- coding: utf-8 -*-
"""VSS BHYT winning-bid drugs: SQLite store, Excel import, HTML crawl."""
from __future__ import annotations
import json
import re
import sqlite3
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from html.parser import HTMLParser
from pathlib import Path
from xml.etree import ElementTree as ET

from .common import (
    VSS_DB, VSS_BASE, DATA_DIR, fold, now_iso, update_status, load_secrets,
)

COLUMNS = [
    "loai_thau", "ma_tinh", "ten_tinh", "ten_don_vi", "ma_cskcb", "ten_cskcb",
    "ma", "ma_gy", "ten", "hoatchat", "duongdung", "maduongdung", "madd_gy",
    "dangbaoche", "hamluong", "donggoi", "sodk", "nhasx", "nuocsx", "donvitinh",
    "soluong", "gia", "thanhtien", "tennhathau", "quyetdinh", "tungay", "denngay",
    "goithau", "tieuchuan", "nhomthau", "loai", "sttpheduyet", "hieuluc", "congbo",
    "ht_thau", "tungay_hd", "denngay_hd", "created_date",
]

DEFAULT_VIEW = [
    "stt", "hoatchat", "sodk", "ten", "duongdung", "hamluong", "donvitinh",
    "soluong", "gia", "thanhtien", "nhomthau", "nhasx", "nuocsx", "ma_tinh",
    "ma_cskcb", "tungay_hd", "denngay_hd",
]

_crawl_stop = threading.Event()
_crawl_thread = None


def connect():
    VSS_DB.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(VSS_DB, timeout=60)
    con.row_factory = sqlite3.Row
    con.create_function("fold", 1, fold)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("""
    CREATE TABLE IF NOT EXISTS bids (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fingerprint TEXT UNIQUE,
      raw TEXT NOT NULL,
      search TEXT NOT NULL,
      sodk TEXT, hoatchat TEXT, ten TEXT, loai TEXT, nhomthau TEXT,
      loai_thau TEXT, ma_tinh TEXT, nuocsx TEXT, duongdung TEXT,
      tungay_hd TEXT, denngay_hd TEXT, nam INTEGER
    )""")
    con.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_bids_search ON bids(search)")
    return con


def meta_get(con, key, default=None):
    row = con.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return json.loads(row[0]) if row else default


def meta_put(con, key, val):
    con.execute("INSERT OR REPLACE INTO meta VALUES (?,?)", (key, json.dumps(val, ensure_ascii=False)))


def row_fingerprint(d: dict) -> str:
    keys = ("sodk", "ten", "hamluong", "ma_cskcb", "tungay_hd", "denngay_hd", "gia", "soluong", "nhomthau")
    return "|".join(str(d.get(k) or "") for k in keys)


def save_rows(rows: list[dict]) -> int:
    n = 0
    with connect() as con:
        for d in rows:
            fp = row_fingerprint(d)
            search = fold(" ".join(str(d.get(c) or "") for c in COLUMNS))
            nam = None
            for k in ("tungay_hd", "congbo", "tungay"):
                v = str(d.get(k) or "")
                m = re.search(r"(20\d{2})", v)
                if m:
                    nam = int(m.group(1))
                    break
            try:
                con.execute(
                    """INSERT OR IGNORE INTO bids
                    (fingerprint, raw, search, sodk, hoatchat, ten, loai, nhomthau, loai_thau,
                     ma_tinh, nuocsx, duongdung, tungay_hd, denngay_hd, nam)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        fp, json.dumps(d, ensure_ascii=False), search,
                        d.get("sodk"), d.get("hoatchat"), d.get("ten"), d.get("loai"),
                        d.get("nhomthau"), d.get("loai_thau"), d.get("ma_tinh"),
                        d.get("nuocsx"), d.get("duongdung"), d.get("tungay_hd"),
                        d.get("denngay_hd"), nam,
                    ),
                )
                if con.total_changes:
                    n += 1
            except sqlite3.IntegrityError:
                pass
        meta_put(con, "updated", now_iso())
        con.commit()
    return n


def import_spreadsheet_ml(path: str | Path, max_rows: int | None = None, progress_cb=None) -> dict:
    """Stream-parse SpreadsheetML (.xls XML). Falls back to regex sanitizer on bad chars."""
    path = Path(path)
    try:
        return _import_spreadsheet_ml_et(path, max_rows=max_rows, progress_cb=progress_cb)
    except Exception as e:
        update_status("vss", message=f"ET fail ({e}); dùng parser regex…", updated=now_iso())
        return _import_spreadsheet_ml_regex(path, max_rows=max_rows)


def _import_spreadsheet_ml_et(path: Path, max_rows: int | None = None, progress_cb=None) -> dict:
    """Stream-parse SpreadsheetML (.xls XML) from VSS export."""
    update_status("vss", state="running", progress=1, message=f"Đang đọc {path.name}…", updated=now_iso())
    headers = None
    batch = []
    inserted = 0
    seen_rows = 0
    tag_row = "{urn:schemas-microsoft-com:office:spreadsheet}Row"
    tag_cell = "{urn:schemas-microsoft-com:office:spreadsheet}Cell"
    tag_data = "{urn:schemas-microsoft-com:office:spreadsheet}Data"

    context = ET.iterparse(path, events=("end",))
    for event, elem in context:
        if elem.tag != tag_row:
            continue
        cells = []
        idx = 1
        for cell in elem.findall(tag_cell):
            index_attr = cell.get("{urn:schemas-microsoft-com:office:spreadsheet}Index")
            if index_attr:
                index = int(index_attr)
                while idx < index:
                    cells.append("")
                    idx += 1
            data = cell.find(tag_data)
            text = "".join(data.itertext()).strip() if data is not None else ""
            cells.append(text)
            idx += 1
        elem.clear()
        if not any(cells):
            continue
        if headers is None:
            if cells and cells[0] in ("loai_thau", "STT", "stt") or "hoatchat" in [c.lower() for c in cells]:
                headers = [c.strip().lower().replace(" ", "_") for c in cells]
                continue
            headers = list(COLUMNS)
        d = {}
        for i, h in enumerate(headers):
            if h == "stt":
                continue
            key = h if h in COLUMNS else (COLUMNS[i] if i < len(COLUMNS) else h)
            d[key] = cells[i] if i < len(cells) else ""
        for c in COLUMNS:
            d.setdefault(c, "")
        batch.append(d)
        seen_rows += 1
        if len(batch) >= 500:
            inserted += save_rows(batch)
            batch = []
            if progress_cb:
                progress_cb(min(95, seen_rows // 1000), f"Đã đọc {seen_rows:,} dòng…")
            update_status("vss", progress=min(95, 5 + seen_rows // 5000), message=f"Import {seen_rows:,} dòng…", updated=now_iso())
        if max_rows and seen_rows >= max_rows:
            break
    if batch:
        inserted += save_rows(batch)
    info = meta_info()
    update_status("vss", state="idle", progress=100, message=f"Import xong +{inserted:,}", updated=now_iso(), count=info["count"])
    return {"read": seen_rows, "inserted": inserted, "count": info["count"]}


def _import_spreadsheet_ml_regex(path: Path, max_rows: int | None = None) -> dict:
    invalid = re.compile(r"&#x0*(?:[0-8bcefBCEF]|1[0-9a-fA-F]|7[fF]);|&#0*(?:[0-8]|1[0-9]|1[2-9]|2[0-9]|3[01]);")
    row_re = re.compile(r"<Row[^>]*>(.*?)</Row>", re.I | re.S)
    cell_re = re.compile(r'<Cell([^>]*)>\s*(?:<Data[^>]*>(.*?)</Data>)?', re.I | re.S)
    index_re = re.compile(r'ss:Index="(\d+)"', re.I)
    update_status("vss", state="running", progress=1, message=f"Import regex {path.name}…", updated=now_iso())
    headers = None
    batch, inserted, seen = [], 0, 0
    buf = ""
    size = max(1, path.stat().st_size)
    read_bytes = 0

    def cell_text(raw: str) -> str:
        if not raw:
            return ""
        t = re.sub(r"<[^>]+>", "", raw)
        return (
            t.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
            .replace("&quot;", '"').replace("&apos;", "'").strip()
        )

    with path.open("r", encoding="utf-8", errors="replace") as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            read_bytes += len(chunk)
            buf += invalid.sub("", chunk)
            parts = list(row_re.finditer(buf))
            if not parts:
                if len(buf) > 5_000_000:
                    buf = buf[-500_000:]
                continue
            last_end = 0
            for m in parts:
                last_end = m.end()
                cells, idx = [], 1
                for cm in cell_re.finditer(m.group(1)):
                    attrs, data = cm.group(1) or "", cm.group(2) or ""
                    im = index_re.search(attrs)
                    if im:
                        want = int(im.group(1))
                        while idx < want:
                            cells.append("")
                            idx += 1
                    cells.append(cell_text(data))
                    idx += 1
                if not any(cells):
                    continue
                if headers is None:
                    lower = [c.strip().lower().replace(" ", "_") for c in cells]
                    if lower and (lower[0] in ("loai_thau", "stt") or "hoatchat" in lower):
                        headers = lower
                        continue
                    headers = list(COLUMNS)
                d = {c: "" for c in COLUMNS}
                for j, h in enumerate(headers):
                    if h == "stt":
                        continue
                    key = h if h in COLUMNS else (COLUMNS[j] if j < len(COLUMNS) else None)
                    if key:
                        d[key] = cells[j] if j < len(cells) else ""
                batch.append(d)
                seen += 1
                if len(batch) >= 800:
                    inserted += save_rows(batch)
                    batch = []
                    update_status("vss", progress=min(95, int(100 * read_bytes / size)), message=f"Import {seen:,}…", updated=now_iso())
                if max_rows and seen >= max_rows:
                    buf = ""
                    break
            buf = buf[last_end:]
            if max_rows and seen >= max_rows:
                break
    if batch:
        inserted += save_rows(batch)
    info = meta_info()
    update_status("vss", state="idle", progress=100, message=f"Import xong +{inserted:,}", updated=now_iso(), count=info["count"])
    return {"read": seen, "inserted": inserted, "count": info["count"]}


class TableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_td = False
        self.in_tr = False
        self.rows = []
        self.current = []
        self.buf = ""

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.in_tr = True
            self.current = []
        elif tag in ("td", "th") and self.in_tr:
            self.in_td = True
            self.buf = ""

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.in_td:
            self.current.append(self.buf.strip())
            self.in_td = False
        elif tag == "tr" and self.in_tr:
            if self.current:
                self.rows.append(self.current)
            self.in_tr = False

    def handle_data(self, data):
        if self.in_td:
            self.buf += data


def parse_chi_tiet_html(html: str) -> list[dict]:
    p = TableParser()
    p.feed(html)
    if not p.rows:
        return []
    # Heuristic: find header row containing sodk / hoat chat
    header_idx = 0
    for i, row in enumerate(p.rows[:5]):
        joined = fold(" ".join(row))
        if "hoat chat" in joined or "so dk" in joined or "sodk" in joined or "ten thuoc" in joined:
            header_idx = i
            break
    headers = [fold(h).replace(" ", "_") for h in p.rows[header_idx]]
    # Map common Vietnamese headers to our keys
    alias = {
        "ten_hoat_chat": "hoatchat", "hoat_chat": "hoatchat", "ten_thuoc": "ten",
        "so_dk": "sodk", "so_dang_ky": "sodk", "ham_luong": "hamluong",
        "duong_dung": "duongdung", "don_vi_tinh": "donvitinh", "so_luong": "soluong",
        "don_gia": "gia", "thanh_tien": "thanhtien", "nhom_thau": "nhomthau",
        "nha_san_xuat": "nhasx", "nuoc_san_xuat": "nuocsx", "ma_tinh": "ma_tinh",
        "ma_cskcb": "ma_cskcb", "tu_ngay": "tungay_hd", "den_ngay": "denngay_hd",
        "loai_thau": "loai_thau", "loai": "loai", "dang_bao_che": "dangbaoche",
    }
    mapped = []
    for h in headers:
        mapped.append(alias.get(h, h if h in COLUMNS else h))
    out = []
    for row in p.rows[header_idx + 1:]:
        d = {c: "" for c in COLUMNS}
        for i, val in enumerate(row):
            key = mapped[i] if i < len(mapped) else None
            if key and key in COLUMNS:
                d[key] = val
        if d.get("ten") or d.get("sodk") or d.get("hoatchat"):
            out.append(d)
    return out


def crawl_vss(days: int = 7, loai: int = 1, max_pages: int = 50) -> dict:
    """Crawl recent announcement days from quanlythuocv1.vss.gov.vn."""
    global _crawl_thread
    if _crawl_thread and _crawl_thread.is_alive():
        return {"ok": False, "message": "VSS đang chạy"}

    _crawl_stop.clear()

    def work():
        secrets = load_secrets()
        # Cookie optional
        cookie = (secrets.get("vss") or {}).get("cookie") or ""
        total_ins = 0
        today = datetime.now()
        days_list = [(today - timedelta(days=i)).strftime("%d/%m/%Y") for i in range(max(1, days))]
        steps = max(1, len(days_list) * max_pages)
        step = 0
        update_status("vss", state="running", progress=1, message="Bắt đầu crawl VSS…", updated=now_iso())
        try:
            for ngay in days_list:
                if _crawl_stop.is_set():
                    break
                for page in range(max_pages):
                    if _crawl_stop.is_set():
                        break
                    step += 1
                    url = f"{VSS_BASE}/kqdt/chiTiet?ngaycongbo={urllib.parse.quote(ngay)}&loai={loai}&page={page}"
                    req = urllib.request.Request(url, headers={
                        "User-Agent": "Mozilla/5.0",
                        "Accept": "text/html",
                        **({"Cookie": cookie} if cookie else {}),
                    })
                    try:
                        with urllib.request.urlopen(req, timeout=45) as resp:
                            html = resp.read().decode("utf-8", errors="replace")
                    except Exception as e:
                        update_status("vss", message=f"Lỗi {ngay} p{page}: {e}")
                        break
                    rows = parse_chi_tiet_html(html)
                    if not rows:
                        break
                    for r in rows:
                        r["congbo"] = ngay
                    n = save_rows(rows)
                    total_ins += n
                    pct = min(99, int(100 * step / steps))
                    update_status("vss", progress=pct, message=f"{ngay} trang {page}: +{n} (tổng +{total_ins})", updated=now_iso())
                    time.sleep(0.4)
            info = meta_info()
            update_status("vss", state="idle", progress=100, message=f"Crawl xong +{total_ins}", updated=now_iso(), count=info["count"])
        except Exception as e:
            update_status("vss", state="error", message=str(e), updated=now_iso())

    _crawl_thread = threading.Thread(target=work, daemon=True)
    _crawl_thread.start()
    return {"ok": True, "message": "Đã bắt đầu crawl VSS"}


def stop_crawl():
    _crawl_stop.set()
    update_status("vss", message="Đang dừng…")
    return {"ok": True}


def meta_info() -> dict:
    info = {"count": 0, "updated": None}
    if not VSS_DB.exists():
        return info
    with connect() as con:
        info["count"] = con.execute("SELECT count(*) FROM bids").fetchone()[0]
        info["updated"] = meta_get(con, "updated")
    return info


def search_bids(filters: dict, page: int = 0, size: int = 50) -> dict:
    clauses, args = [], []
    q = fold(filters.get("q") or "")
    if q:
        for w in q.split():
            clauses.append("search LIKE ?")
            args.append(f"%{w}%")
    for field, key in [
        ("hoatchat", "hoatchat"), ("sodk", "sodk"), ("loai", "loai"),
        ("nhomthau", "nhomthau"), ("loai_thau", "loai_thau"),
        ("duongdung", "duongdung"), ("ma_tinh", "ma_tinh"), ("nuocsx", "nuocsx"),
    ]:
        val = fold(filters.get(field) or "")
        if val:
            clauses.append(f"fold(coalesce({key},'')) LIKE ?")
            args.append(f"%{val}%")
    if filters.get("nam"):
        clauses.append("nam = ?")
        args.append(int(filters["nam"]))
    if filters.get("tuNgay"):
        clauses.append("coalesce(tungay_hd,'') >= ?")
        args.append(filters["tuNgay"])
    if filters.get("denNgay"):
        clauses.append("coalesce(denngay_hd,'') <= ?")
        args.append(filters["denNgay"] + " 23:59:59" if len(filters["denNgay"]) == 10 else filters["denNgay"])

    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    page = max(0, int(page))
    size = max(1, min(200, int(size)))
    with connect() as con:
        total = con.execute("SELECT count(*) FROM bids" + where, args).fetchone()[0]
        rows = con.execute(
            "SELECT raw FROM bids" + where + " ORDER BY id DESC LIMIT ? OFFSET ?",
            args + [size, page * size],
        ).fetchall()
    items = []
    for i, (raw,) in enumerate(rows):
        d = json.loads(raw)
        d["stt"] = page * size + i + 1
        items.append(d)
    return {"total": total, "page": page, "size": size, "items": items}
