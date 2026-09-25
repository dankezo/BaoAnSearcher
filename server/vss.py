# -*- coding: utf-8 -*-
"""VSS BHYT winning-bid drugs: SQLite store, Excel import, export crawl."""
from __future__ import annotations
import json
import re
import sqlite3
import threading
import time
from datetime import datetime, timedelta
from html.parser import HTMLParser
from pathlib import Path
from xml.etree import ElementTree as ET

from .common import (
    VSS_DB, VSS_BASE, DATA_DIR, fold, now_iso, update_status, load_secrets,
)

# DNS for quanlythuocv1.vss.gov.vn intermittently fails on some Windows resolvers;
# HTTPS by IP + Host header still works.
VSS_HOST = "quanlythuocv1.vss.gov.vn"
VSS_IP_FALLBACK = "103.57.114.162"

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


def _year_in(text: str) -> int | None:
    m = re.search(r"(20\d{2})", str(text or ""))
    return int(m.group(1)) if m else None


def normalize_vss_date(val: str | None) -> str:
    """Normalize dd/MM/yyyy (crawl HTML) or Excel datetimes to ISO yyyy-mm-dd[ HH:MM:SS]."""
    s = str(val or "").strip()
    if not s:
        return ""
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(20\d{2})$", s)
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), m.group(3)
        return f"{y}-{mo:02d}-{d:02d}"
    m = re.match(r"^(20\d{2})-(\d{2})-(\d{2})", s)
    if m:
        return s
    return s


def derive_nam(d: dict) -> int | None:
    """Catalog / bid year = contract start (tungay_hd → congbo → tungay)."""
    for k in ("tungay_hd", "congbo", "tungay"):
        y = _year_in(d.get(k))
        if y:
            return y
    return None


def save_rows(rows: list[dict]) -> int:
    n = 0
    with connect() as con:
        for d in rows:
            for k in ("tungay_hd", "denngay_hd", "tungay", "denngay", "congbo"):
                if d.get(k):
                    d[k] = normalize_vss_date(d.get(k)) or d.get(k)
            fp = row_fingerprint(d)
            search = fold(" ".join(str(d.get(c) or "") for c in COLUMNS))
            nam = derive_nam(d)
            d["nam"] = nam
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
    # Map common Vietnamese headers to our keys (HTML chiTiet uses "Từ ngày HD", "Nhà SX", …)
    alias = {
        "ten_hoat_chat": "hoatchat", "hoat_chat": "hoatchat", "ten_thuoc": "ten", "ten": "ten",
        "so_dk": "sodk", "so_dang_ky": "sodk", "ham_luong": "hamluong",
        "duong_dung": "duongdung", "don_vi_tinh": "donvitinh", "dvt": "donvitinh",
        "so_luong": "soluong", "don_gia": "gia", "gia": "gia", "thanh_tien": "thanhtien",
        "nhom_thau": "nhomthau",
        "nha_san_xuat": "nhasx", "nha_sx": "nhasx", "nuoc_san_xuat": "nuocsx", "nuoc_sx": "nuocsx",
        "ma_tinh": "ma_tinh", "ma_cskcb": "ma_cskcb",
        "tu_ngay": "tungay_hd", "tu_ngay_hd": "tungay_hd",
        "den_ngay": "denngay_hd", "den_ngay_hd": "denngay_hd",
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


VSS_EXPORT_PATH = "/kqdt/export"
_vss_prefer_ip = False

# Vietnamese / alternate headers → internal COLUMNS keys
HEADER_ALIASES = {
    "ten_hoat_chat": "hoatchat", "hoat_chat": "hoatchat", "ten_thuoc": "ten",
    "so_dk": "sodk", "so_dang_ky": "sodk", "ham_luong": "hamluong",
    "duong_dung": "duongdung", "don_vi_tinh": "donvitinh", "dvt": "donvitinh",
    "so_luong": "soluong", "don_gia": "gia", "thanh_tien": "thanhtien",
    "nhom_thau": "nhomthau", "nha_san_xuat": "nhasx", "nha_sx": "nhasx",
    "nuoc_san_xuat": "nuocsx", "nuoc_sx": "nuocsx",
    "tu_ngay": "tungay_hd", "tu_ngay_hd": "tungay_hd",
    "den_ngay": "denngay_hd", "den_ngay_hd": "denngay_hd",
    "loai_thau": "loai_thau", "dang_bao_che": "dangbaoche",
    "ten_nha_thau": "tennhathau", "ma_tinh": "ma_tinh", "ma_cskcb": "ma_cskcb",
}


def _snake_header(text: str) -> str:
    raw = fold(str(text or "")).strip().replace(" ", "_").replace("-", "_")
    raw = re.sub(r"_+", "_", raw).strip("_")
    return HEADER_ALIASES.get(raw, raw if raw in COLUMNS else HEADER_ALIASES.get(raw, raw))


def _clean_cell(val) -> str:
    if val is None:
        return ""
    try:
        import math
        if isinstance(val, float) and math.isnan(val):
            return ""
    except Exception:
        pass
    s = str(val).strip()
    if s.lower() in ("nan", "none", "null", "nat"):
        return ""
    return s


def _browser_headers(cookie: str = "", host: str | None = None) -> dict:
    h = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
        ),
        "Accept": "application/vnd.ms-excel,application/octet-stream,*/*",
        "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
        "Referer": f"https://{VSS_HOST}/kqdt/chiTiet",
    }
    if host:
        h["Host"] = host
    if cookie:
        h["Cookie"] = cookie
    return h


def download_kqdt_export(ngay: str, loai: int = 1, cookie: str = "", timeout: int = 60, retries: int = 3) -> bytes:
    """One request: export all bids for a announcement day as SpreadsheetML .xls."""
    global _vss_prefer_ip
    try:
        import requests
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    except ImportError as e:
        raise RuntimeError("Cần cài: pip install requests") from e

    params = {"loai": str(loai), "ngaycongbo": ngay}
    last_err: Exception | None = None

    for attempt in range(1, retries + 1):
        try:
            if _vss_prefer_ip:
                url = f"https://{VSS_IP_FALLBACK}{VSS_EXPORT_PATH}"
                headers = _browser_headers(cookie, host=VSS_HOST)
                verify = False
            else:
                url = f"https://{VSS_HOST}{VSS_EXPORT_PATH}"
                headers = _browser_headers(cookie)
                verify = True
            resp = requests.get(url, params=params, headers=headers, timeout=timeout, verify=verify)
            resp.raise_for_status()
            data = resp.content or b""
            if data.startswith(b"<") and b"Workbook" not in data[:500] and b"html" in data[:200].lower():
                raise RuntimeError(f"Export trả HTML lỗi (ngày {ngay})")
            if len(data) < 64:
                raise RuntimeError(f"Export rỗng / quá ngắn ({len(data)} bytes)")
            return data
        except Exception as e:
            last_err = e
            # DNS failure → switch to IP fallback next try
            err_s = str(e).lower()
            if "getaddrinfo" in err_s or "nameresolution" in err_s or "failed to resolve" in err_s:
                _vss_prefer_ip = True
            elif not _vss_prefer_ip and attempt == 1:
                # also try IP after first generic failure
                _vss_prefer_ip = True
            time.sleep(min(2 * attempt, 6))
    raise RuntimeError(f"Export thất bại sau {retries} lần ({ngay}): {last_err}")


def parse_spreadsheet_ml_bytes(data: bytes) -> list[dict]:
    """Parse VSS SpreadsheetML (.xls XML) from memory → list of COLUMNS dicts."""
    from io import BytesIO

    # Strip illegal XML 1.0 char refs (same as bulk Excel importer)
    text = data.decode("utf-8", errors="replace")
    text = re.sub(
        r"&#x0*(?:[0-8bcefBCEF]|1[0-9a-fA-F]|7[fF]);|&#0*(?:[0-8]|1[0-9]|1[2-9]|2[0-9]|3[01]);",
        "",
        text,
    )
    # Also strip raw control chars except tab/lf/cr
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)

    tag_row = "{urn:schemas-microsoft-com:office:spreadsheet}Row"
    tag_cell = "{urn:schemas-microsoft-com:office:spreadsheet}Cell"
    tag_data = "{urn:schemas-microsoft-com:office:spreadsheet}Data"
    headers = None
    out: list[dict] = []

    try:
        stream = BytesIO(text.encode("utf-8"))
        events = ET.iterparse(stream, events=("end",))
        for _event, elem in events:
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
                data_el = cell.find(tag_data)
                cell_text = "".join(data_el.itertext()).strip() if data_el is not None else ""
                cells.append(_clean_cell(cell_text))
                idx += 1
            elem.clear()
            if not any(cells):
                continue
            if headers is None:
                headers = [_snake_header(c) for c in cells]
                continue
            d = {c: "" for c in COLUMNS}
            for i, h in enumerate(headers):
                if h == "stt":
                    continue
                key = h if h in COLUMNS else HEADER_ALIASES.get(h)
                if key and key in COLUMNS and i < len(cells):
                    d[key] = cells[i]
            if d.get("ten") or d.get("sodk") or d.get("hoatchat"):
                out.append(d)
        return out
    except ET.ParseError:
        # Fallback: regex row scrape (robust for dirty VSS XML)
        return _parse_spreadsheet_ml_regex_text(text)


def _parse_spreadsheet_ml_regex_text(text: str) -> list[dict]:
    row_re = re.compile(r"<Row[^>]*>(.*?)</Row>", re.I | re.S)
    cell_re = re.compile(r'<Cell([^>]*)>\s*(?:<Data[^>]*>(.*?)</Data>)?', re.I | re.S)
    index_re = re.compile(r'ss:Index="(\d+)"', re.I)

    def cell_text(raw: str) -> str:
        if not raw:
            return ""
        t = re.sub(r"<[^>]+>", "", raw)
        return _clean_cell(
            t.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
            .replace("&quot;", '"').replace("&apos;", "'")
        )

    headers = None
    out: list[dict] = []
    for m in row_re.finditer(text):
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
            headers = [_snake_header(c) for c in cells]
            continue
        d = {c: "" for c in COLUMNS}
        for i, h in enumerate(headers):
            if h == "stt":
                continue
            key = h if h in COLUMNS else HEADER_ALIASES.get(h)
            if key and key in COLUMNS and i < len(cells):
                d[key] = cells[i]
        if d.get("ten") or d.get("sodk") or d.get("hoatchat"):
            out.append(d)
    return out


def rows_from_export_bytes(data: bytes) -> list[dict]:
    """Prefer SpreadsheetML parser; fall back to pandas for real .xlsx/.xls."""
    head = data[:80].lstrip()
    if head.startswith(b"<?xml") or b"Workbook" in data[:400]:
        return parse_spreadsheet_ml_bytes(data)
    try:
        import pandas as pd
        from io import BytesIO
        df = pd.read_excel(BytesIO(data), dtype=str)
        df = df.where(df.notna(), "")
        rows = []
        for rec in df.to_dict(orient="records"):
            d = {c: "" for c in COLUMNS}
            for k, v in rec.items():
                key = _snake_header(k)
                if key in COLUMNS:
                    d[key] = _clean_cell(v)
            if d.get("ten") or d.get("sodk") or d.get("hoatchat"):
                rows.append(d)
        return rows
    except Exception:
        return parse_spreadsheet_ml_bytes(data)


def write_day_json(rows: list[dict], ngay_ddmmyyyy: str, out_dir: Path | None = None) -> Path:
    """Write kqdt_YYYYMMDD.json (pretty, UTF-8)."""
    out_dir = out_dir or (DATA_DIR / "vss_exports")
    out_dir.mkdir(parents=True, exist_ok=True)
    d, m, y = ngay_ddmmyyyy.split("/")
    path = out_dir / f"kqdt_{y}{m}{d}.json"
    payload = {
        "ngaycongbo": ngay_ddmmyyyy,
        "count": len(rows),
        "items": rows,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def _parse_day_arg(val: str | None) -> datetime | None:
    if not val:
        return None
    s = str(val).strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    raise ValueError(f"Ngày không hợp lệ: {val}")


def iter_crawl_days(
    days: int | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    dates: list[str] | None = None,
) -> list[str]:
    """Return list of DD/MM/YYYY newest-first."""
    if dates:
        out = []
        for d in dates:
            dt = _parse_day_arg(d)
            if dt:
                out.append(dt.strftime("%d/%m/%Y"))
        return out
    if from_date or to_date:
        start = _parse_day_arg(from_date) or _parse_day_arg(to_date)
        end = _parse_day_arg(to_date) or _parse_day_arg(from_date)
        if not start or not end:
            raise ValueError("Cần from_date và/hoặc to_date")
        if start > end:
            start, end = end, start
        cur = end
        out = []
        while cur >= start:
            out.append(cur.strftime("%d/%m/%Y"))
            cur -= timedelta(days=1)
        return out
    n = max(1, int(days or 2))
    today = datetime.now()
    return [(today - timedelta(days=i)).strftime("%d/%m/%Y") for i in range(n)]


def crawl_vss(
    days: int = 2,
    loai: int = 1,
    max_pages: int = 50,  # unused — kept for API compat
    catchup: bool = False,
    from_date: str | None = None,
    to_date: str | None = None,
    dates: list[str] | None = None,
    save_json: bool = False,
) -> dict:
    """Crawl via /kqdt/export (1 Excel request / day). No HTML pagination."""
    global _crawl_thread
    if _crawl_thread and _crawl_thread.is_alive():
        return {"ok": False, "message": "VSS đang chạy"}

    _crawl_stop.clear()
    if dates or from_date or to_date:
        days_list = iter_crawl_days(from_date=from_date, to_date=to_date, dates=dates)
    else:
        if catchup and not days:
            days = 90
        if catchup:
            days = max(int(days or 90), 30)
            days = min(days, 180)
        else:
            days = max(1, min(14, int(days or 2)))
        days_list = iter_crawl_days(days=days)
    empty_stop = 5 if catchup or len(days_list) > 14 else 3

    def work():
        secrets = load_secrets()
        cookie = (secrets.get("vss") or {}).get("cookie") or ""
        total_ins = 0
        empty_streak = 0
        mode = "bắt kịp export" if catchup else f"export {len(days_list)} ngày"
        update_status("vss", state="running", progress=1, message=f"Crawl VSS {mode}…", updated=now_iso())
        try:
            for day_i, ngay in enumerate(days_list):
                if _crawl_stop.is_set():
                    break
                try:
                    blob = download_kqdt_export(ngay, loai=loai, cookie=cookie)
                    rows = rows_from_export_bytes(blob)
                    for r in rows:
                        if not r.get("congbo"):
                            r["congbo"] = ngay
                        if not r.get("loai"):
                            r["loai"] = "Tân dược"
                    n = save_rows(rows) if rows else 0
                    total_ins += n
                    if save_json and rows:
                        path = write_day_json(rows, ngay)
                        json_note = f" → {path.name}"
                    else:
                        json_note = ""
                    kb = len(blob) / 1024
                    pct = min(99, int(100 * (day_i + 1) / max(1, len(days_list))))
                    update_status(
                        "vss", progress=pct,
                        message=f"{ngay}: {kb:.1f} KB · {len(rows)} dòng · +{n} mới (tổng +{total_ins}){json_note}",
                        updated=now_iso(),
                    )
                    if not rows:
                        empty_streak += 1
                        if empty_streak >= empty_stop:
                            update_status("vss", message=f"Dừng sớm: {empty_streak} ngày export trống")
                            break
                    else:
                        empty_streak = 0
                except Exception as e:
                    update_status("vss", message=f"Lỗi {ngay}: {e}")
                    empty_streak += 1
                    if empty_streak >= empty_stop:
                        break
                # throttle 3–5s between days
                if day_i < len(days_list) - 1 and not _crawl_stop.is_set():
                    time.sleep(3 + (day_i % 3))  # 3,4,5 cycling
            info = meta_info()
            update_status(
                "vss", state="idle", progress=100,
                message=f"Crawl export xong +{total_ins}", updated=now_iso(), count=info["count"],
            )
        except Exception as e:
            update_status("vss", state="error", message=str(e), updated=now_iso())

    _crawl_thread = threading.Thread(target=work, daemon=True, name="vss-export-crawl")
    _crawl_thread.start()
    return {"ok": True, "message": f"Đã bắt đầu crawl VSS export ({len(days_list)} ngày)"}


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
        raw = filters.get(field)
        if isinstance(raw, (list, tuple)):
            vals = [fold(str(x)) for x in raw if str(x).strip()]
        else:
            text = fold(raw or "")
            vals = [v for v in text.replace(";", "|").split("|") if v] if text else []
        if not vals:
            continue
        if len(vals) == 1:
            clauses.append(f"fold(coalesce({key},'')) LIKE ?")
            args.append(f"%{vals[0]}%")
        else:
            clauses.append("(" + " OR ".join(
                f"fold(coalesce({key},'')) LIKE ?" for _ in vals
            ) + ")")
            args.extend(f"%{v}%" for v in vals)
    raw_nam = filters.get("nam")
    nam_list = []
    if isinstance(raw_nam, (list, tuple)):
        for x in raw_nam:
            try:
                nam_list.append(int(str(x).strip()))
            except (TypeError, ValueError):
                pass
    elif raw_nam not in (None, ""):
        for part in str(raw_nam).replace(";", "|").split("|"):
            try:
                nam_list.append(int(part.strip()))
            except (TypeError, ValueError):
                pass
    if nam_list:
        year_clauses = []
        for year in nam_list:
            y = str(year)
            y_start, y_end = f"{y}-01-01", f"{y}-12-31"
            year_clauses.append(
                """(
                    nam = ?
                    OR coalesce(tungay_hd,'') LIKE ?
                    OR (
                        length(coalesce(tungay_hd,'')) >= 10
                        AND length(coalesce(denngay_hd,'')) >= 10
                        AND tungay_hd <= ? AND denngay_hd >= ?
                    )
                    OR coalesce(congbo,'') LIKE ?
                )"""
            )
            args.extend([year, f"{y}%", y_end, y_start, f"{y}%"])
        clauses.append("(" + " OR ".join(year_clauses) + ")")
    elif False:
        # placeholder removed — old single-year block replaced above
        pass
    if False and filters.get("nam"):
        try:
            year = int(str(filters["nam"]).strip())
        except (TypeError, ValueError):
            year = None
        if year:
            # Excel BHYT-YYYY has no "nam" column. Catalog year = tungay_hd (→ congbo → tungay).
            # Filter "Năm X" = HĐ hiệu lực trong năm X (giao [tungay_hd, denngay_hd]) hoặc công bố năm X.
            # Do NOT match created_date via raw LIKE — that falsely marks almost all rows as 2025.
            y = str(year)
            y_start, y_end = f"{y}-01-01", f"{y}-12-31"
            clauses.append(
                """(
                    nam = ?
                    OR coalesce(tungay_hd,'') LIKE ?
                    OR coalesce(denngay_hd,'') LIKE ?
                    OR coalesce(json_extract(raw,'$.congbo'),'') LIKE ?
                    OR coalesce(json_extract(raw,'$.tungay'),'') LIKE ?
                    OR (
                        length(coalesce(tungay_hd,'')) >= 4
                        AND length(coalesce(denngay_hd,'')) >= 4
                        AND substr(tungay_hd,1,10) <= ?
                        AND substr(denngay_hd,1,10) >= ?
                    )
                )"""
            )
            args.extend([year, f"{y}%", f"{y}%", f"{y}%", f"{y}%", y_end, y_start])
    if filters.get("tuNgay"):
        clauses.append("coalesce(tungay_hd,'') >= ?")
        args.append(filters["tuNgay"])
    if filters.get("denNgay"):
        clauses.append("coalesce(denngay_hd,'') <= ?")
        args.append(filters["denNgay"] + " 23:59:59" if len(filters["denNgay"]) == 10 else filters["denNgay"])

    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    page = max(0, int(page))
    size = max(1, min(5000, int(size)))
    with connect() as con:
        total = con.execute("SELECT count(*) FROM bids" + where, args).fetchone()[0]
        rows = con.execute(
            "SELECT raw, nam FROM bids" + where +
            " ORDER BY coalesce(tungay_hd,'') DESC, id DESC LIMIT ? OFFSET ?",
            args + [size, page * size],
        ).fetchall()
    items = []
    for i, (raw, nam_col) in enumerate(rows):
        d = json.loads(raw)
        d["stt"] = page * size + i + 1
        if d.get("nam") is None:
            d["nam"] = nam_col if nam_col is not None else derive_nam(d)
        items.append(d)
    return {"total": total, "page": page, "size": size, "items": items}
