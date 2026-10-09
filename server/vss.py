# -*- coding: utf-8 -*-
"""VSS BHYT winning-bid drugs: SQLite store, Excel import, export crawl."""
from __future__ import annotations
import json
import base64
import math
import re
import sqlite3
import threading
import time
from datetime import datetime, timedelta
from html.parser import HTMLParser
from pathlib import Path
from xml.etree import ElementTree as ET

from .common import (
    VSS_DB, VSS_BASE, DATA_DIR, fold, now_iso, update_status, load_secrets, load_status, read_metadata,
    configure_sqlite,
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
_http_session = None
_session_lock = threading.Lock()


class CrawlStopped(Exception):
    pass


def crawl_alive() -> bool:
    return bool(_crawl_thread and _crawl_thread.is_alive())


def reconcile_status() -> None:
    """A dead worker must not leave the card on “Đang chạy / Đang dừng…”."""
    state = (load_status().get("vss") or {})
    if state.get("state") == "running" and not crawl_alive():
        update_status(
            "vss",
            state="idle",
            progress=100,
            message="Đã dừng. Phiên crawl trước không còn chạy.",
            updated=now_iso(),
        )


def _drop_session() -> None:
    global _http_session
    with _session_lock:
        session = _http_session
        _http_session = None
    if session is not None:
        try:
            session.close()
        except Exception:
            pass


def _borrow_session():
    global _http_session
    import requests
    with _session_lock:
        if _http_session is None:
            _http_session = requests.Session()
        return _http_session


def connect():
    VSS_DB.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(VSS_DB, timeout=60)
    con.row_factory = sqlite3.Row
    con.create_function("fold", 1, fold)
    configure_sqlite(con)
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
    con.execute("CREATE INDEX IF NOT EXISTS idx_bids_sodk ON bids(sodk)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_bids_ten ON bids(ten)")
    # Map queries always begin with the VSS effective-date window.  Keeping
    # the province beside it avoids a full scan of the archive on every map
    # load while leaving the existing import format untouched.
    con.execute("CREATE INDEX IF NOT EXISTS idx_bids_effective_province ON bids(tungay_hd, ma_tinh)")
    # The list is ordered by this exact null-safe expression.  A plain
    # ``tungay_hd`` index cannot serve ``ORDER BY coalesce(...)`` and caused
    # SQLite to sort the whole VSS archive before returning one page.
    con.execute("CREATE INDEX IF NOT EXISTS idx_bids_cursor ON bids(coalesce(tungay_hd,''), id)")
    return con


def meta_get(con, key, default=None):
    row = con.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return json.loads(row[0]) if row else default


def meta_put(con, key, val):
    con.execute("INSERT OR REPLACE INTO meta VALUES (?,?)", (key, json.dumps(val, ensure_ascii=False)))


# Identity fields compared after normalization. Empty vs filled is allowed;
# two non-empty values must match. soluong is separate (truncated qty can still match).
_TEXT_IDENTITY = (
    "loai_thau", "ten_don_vi", "ten_cskcb", "ten", "hoatchat", "duongdung",
    "maduongdung", "madd_gy", "dangbaoche", "hamluong", "donggoi", "nhasx",
    "nuocsx", "donvitinh", "tennhathau", "quyetdinh", "goithau", "tieuchuan",
    "nhomthau", "loai", "ht_thau", "ten_tinh",
)
_CODE_IDENTITY = ("sodk", "ma_tinh", "ma_cskcb", "ma", "ma_gy")
_DATE_IDENTITY = ("tungay", "denngay", "tungay_hd", "denngay_hd", "congbo", "hieuluc")
_MONEY_IDENTITY = ("gia", "thanhtien")
SIGNATURE_KEYS = _TEXT_IDENTITY + _CODE_IDENTITY + _DATE_IDENTITY + _MONEY_IDENTITY


def norm_vss_text(val) -> str:
    """Case, diacritics, and spacing-insensitive text."""
    s = fold(val).replace("\xa0", " ")
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"\s*([^\w\s])\s*", r"\1", s)
    return s


def norm_vss_code(val) -> str:
    """Codes and registration numbers: also drop internal whitespace/newlines."""
    return re.sub(r"\s+", "", norm_vss_text(val))


def norm_vss_day(val) -> str:
    """Calendar day. Date-with-time and date-only are the same day."""
    s = str(val or "").strip()
    if not s:
        return ""
    norm = normalize_vss_date(s) or s
    m = re.match(r"^(20\d{2}-\d{2}-\d{2})", norm)
    if m:
        return m.group(1)
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(20\d{2})", s)
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), m.group(3)
        return f"{y}-{mo:02d}-{d:02d}"
    return norm_vss_text(s)


def parse_vn_number(val):
    """Parse a VSS money/qty. Vietnamese 380.000 means 380000, not 380."""
    if isinstance(val, bool):
        return None
    if isinstance(val, (int, float)):
        n = float(val)
        return n if math.isfinite(n) else None
    s = str(val or "").strip().replace(" ", "").replace("\u00a0", "")
    if not s:
        return None
    if "." in s and "," in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        if re.fullmatch(r"-?\d{1,3}(,\d{3})+", s):
            s = s.replace(",", "")
        else:
            s = s.replace(",", ".")
    elif "." in s and re.fullmatch(r"-?\d{1,3}(\.\d{3})+", s):
        s = s.replace(".", "")
    try:
        n = float(s)
    except ValueError:
        return None
    return n if math.isfinite(n) else None


def format_vn_number(n) -> str:
    if n is None:
        return ""
    if abs(n - round(n)) < 1e-6:
        return str(int(round(n)))
    return f"{n:.6f}".rstrip("0").rstrip(".")


def numbers_close(a, b) -> bool:
    if a is None or b is None:
        return False
    scale = max(abs(a), abs(b), 1.0)
    return abs(a - b) <= max(1.0, scale * 1e-6)


def _qty_digits(n) -> str:
    if n is None or not math.isfinite(n):
        return ""
    if abs(n - round(n)) > 1e-4:
        return ""
    return str(int(round(abs(n))))


def is_truncated_qty(small, large) -> bool:
    """True when small is a chopped or thousand-scaled form of large (38 vs 380000)."""
    a, b = _qty_digits(small), _qty_digits(large)
    if not a or not b or len(b) <= len(a):
        return False
    if not b.startswith(a):
        return False
    try:
        ratio = int(b) / int(a)
    except ZeroDivisionError:
        return False
    if ratio < 10:
        return False
    log = math.log10(ratio)
    return abs(log - round(log)) < 1e-6


def qty_compatible(q1, q2) -> bool:
    """Same quantity, one side blank, or one side a truncated form of the other."""
    if q1 is None or q2 is None or numbers_close(q1, q2):
        return True
    small, large = (q1, q2) if abs(q1) < abs(q2) else (q2, q1)
    return is_truncated_qty(small, large)


def canonical_soluong(d: dict) -> str:
    """Use the quantity implied by thành tiền / giá when the stored qty was truncated."""
    qty = parse_vn_number(d.get("soluong"))
    gia = parse_vn_number(d.get("gia"))
    tt = parse_vn_number(d.get("thanhtien"))
    if qty is None:
        return ""
    if gia in (None, 0) or tt is None or numbers_close(qty * gia, tt):
        return format_vn_number(qty)
    implied = tt / gia
    if is_truncated_qty(qty, implied):
        return format_vn_number(implied)
    return format_vn_number(qty)


def lacks_province(d: dict) -> bool:
    """No tỉnh/TP: both province code and province name are blank."""
    return not norm_vss_code(d.get("ma_tinh")) and not norm_vss_text(d.get("ten_tinh"))


# Official pre-2025 codes, plus 97/98 (Bảo hiểm xã hội Bộ Quốc phòng).
_PROVINCE_CODES = {
    "01", "02", "04", "06", "08", "10", "11", "12", "14", "15", "17", "19", "20",
    "22", "24", "25", "26", "27", "30", "31", "33", "34", "35", "36", "37", "38",
    "40", "42", "44", "45", "46", "48", "49", "51", "52", "54", "56", "58", "60",
    "62", "64", "66", "67", "68", "70", "72", "74", "75", "77", "79", "80", "82",
    "83", "84", "86", "87", "89", "91", "92", "93", "94", "95", "96", "97", "98",
}
# Column-shifted exports: Han/Hangul/Thai in the drug identity, or template tokens.
_HAN_GARBAGE = re.compile(
    r"[\u0e00-\u0e7f\u0f00-\u0fff\u1100-\u11ff\u3040-\u30ff\u3400-\u9fff"
    r"\uac00-\ud7af\uf900-\ufaff\ufffd\ufffe\uffff]"
)
_GARBAGE_TOKEN = re.compile(
    r"(?:NHASX|ISDEL|CONGBO|TCCL|DAGIAMDINH)\d|TEN\d+_|"
    r"JEIS\.Core|xem th[eê]m|giamdinh\.|:p\d",
    re.I,
)


def province_code_key(val) -> str:
    key = norm_vss_code(val)
    return key.zfill(2) if key.isdigit() else key


# Vietnamese, Latin, or numbers on a real bid. A Han character here means the
# export columns slid. Manufacturer and unit are left alone so one dirty cell
# on an otherwise real product is kept.
_SHIFT_FIELDS = ("ten", "sodk", "hoatchat", "dangbaoche", "hamluong", "donggoi", "nhomthau")


def is_garbled_bid(d: dict) -> bool:
    """Shifted VSS export row: fake province code, or identity fields full of junk.

    A real bid that only has one dirty side cell and a valid province code is kept.
    A row with no province plus junk in the dosage columns is the shifted export.
    """
    code = province_code_key(d.get("ma_tinh"))
    if code and code not in _PROVINCE_CODES:
        return True
    identity = "\n".join(str(d.get(k) or "") for k in ("ten", "sodk", "hoatchat"))
    if _HAN_GARBAGE.search(identity) or _GARBAGE_TOKEN.search(identity):
        return True
    if norm_vss_text(d.get("ten")) == "ten" and norm_vss_text(d.get("sodk")) == "sodk":
        return True
    if code:
        return False
    shifted = "\n".join(str(d.get(k) or "") for k in _SHIFT_FIELDS)
    if _HAN_GARBAGE.search(shifted) or _GARBAGE_TOKEN.search(shifted):
        return True
    return norm_vss_text(d.get("nhomthau")) == ":p"


def _field_norm(d: dict, key: str) -> str:
    if key in _CODE_IDENTITY or key == "sodk":
        return norm_vss_code(d.get(key))
    if key in _DATE_IDENTITY:
        return norm_vss_day(d.get(key))
    if key in _MONEY_IDENTITY:
        return format_vn_number(parse_vn_number(d.get(key)))
    if key == "soluong":
        return canonical_soluong(d)
    return norm_vss_text(d.get(key))


def _filled_fields_compatible(a: dict, b: dict) -> bool:
    keys = _TEXT_IDENTITY + _CODE_IDENTITY + _DATE_IDENTITY + _MONEY_IDENTITY
    for key in keys:
        va, vb = _field_norm(a, key), _field_norm(b, key)
        if va and vb and va != vb:
            return False
    return True


def place_conflict(a: dict, b: dict) -> bool:
    """True when both rows name a different province, facility unit, or bidder place."""
    for key, norm in (
        ("ma_tinh", norm_vss_code),
        ("ten_tinh", norm_vss_text),
        ("ten_don_vi", norm_vss_text),
        ("ma_cskcb", norm_vss_code),
        ("ten_cskcb", norm_vss_text),
    ):
        va, vb = norm(a.get(key)), norm(b.get(key))
        if va and vb and va != vb:
            return True
    for src, dst in ((a, b), (b, a)):
        unit = norm_vss_text(src.get("ten_don_vi"))
        tinh = norm_vss_text(dst.get("ten_tinh"))
        other_unit = norm_vss_text(dst.get("ten_don_vi"))
        if unit and tinh and unit != tinh and unit != other_unit:
            return True
    return False


def same_province(a: dict, b: dict) -> bool:
    """Same tỉnh/TP. A blank side does not count as a different province."""
    ma1, ma2 = norm_vss_code(a.get("ma_tinh")), norm_vss_code(b.get("ma_tinh"))
    t1, t2 = norm_vss_text(a.get("ten_tinh")), norm_vss_text(b.get("ten_tinh"))
    if ma1 and ma2 and ma1 != ma2:
        return False
    if t1 and t2 and t1 != t2:
        return False
    if not ((ma1 or t1) and (ma2 or t2)):
        return False
    if (ma1 and ma2 and ma1 == ma2) or (t1 and t2 and t1 == t2):
        return True
    return False


def is_same_bid(a: dict, b: dict) -> bool:
    """Same winning bid after normalization. Truncated soluong still matches when money matches."""
    if place_conflict(a, b):
        return False
    if not _filled_fields_compatible(a, b):
        return False
    if not qty_compatible(parse_vn_number(a.get("soluong")), parse_vn_number(b.get("soluong"))):
        return False
    ten_a, ten_b = norm_vss_text(a.get("ten")), norm_vss_text(b.get("ten"))
    sdk_a, sdk_b = norm_vss_code(a.get("sodk")), norm_vss_code(b.get("sodk"))
    gia_a = format_vn_number(parse_vn_number(a.get("gia")))
    gia_b = format_vn_number(parse_vn_number(b.get("gia")))
    tt_a = format_vn_number(parse_vn_number(a.get("thanhtien")))
    tt_b = format_vn_number(parse_vn_number(b.get("thanhtien")))
    if not (gia_a and gia_a == gia_b and tt_a and tt_a == tt_b):
        return False
    if not ((ten_a and ten_a == ten_b) or (sdk_a and sdk_a == sdk_b)):
        return False
    return True


def row_fingerprint(d: dict) -> str:
    """Normalized identity, including tỉnh/TP so two provinces stay distinct.

    soluong is the quantity implied by thành tiền / giá when the stored number
    was truncated (38 vs 380000, or 380.000 read as 380).
    """
    parts = [_field_norm(d, key) for key in SIGNATURE_KEYS]
    parts.append(canonical_soluong(d))
    return "|".join(parts)


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


def _candidate_bid_rows(con, d: dict):
    """Rows that might be the same registration (or the same name if SĐK is blank)."""
    sodk = str(d.get("sodk") or "").strip()
    code = norm_vss_code(sodk)
    if code:
        rows = con.execute("SELECT id, raw FROM bids WHERE sodk = ?", (sodk,)).fetchall()
        if not rows and re.search(r"\s", sodk):
            rows = con.execute(
                """SELECT id, raw FROM bids
                   WHERE replace(replace(replace(coalesce(sodk,''), char(10), ''), char(13), ''), ' ', '') = ?""",
                (code,),
            ).fetchall()
        return rows
    ten = str(d.get("ten") or "").strip()
    if not ten:
        return []
    return con.execute("SELECT id, raw FROM bids WHERE ten = ?", (ten,)).fetchall()


def bid_completeness(d: dict) -> tuple:
    """Prefer a row that has tỉnh/TP, then one whose quantity matches the line total."""
    qty = parse_vn_number(d.get("soluong"))
    gia = parse_vn_number(d.get("gia"))
    tt = parse_vn_number(d.get("thanhtien"))
    money = int(
        qty is not None and gia not in (None, 0) and tt not in (None, 0) and numbers_close(qty * gia, tt)
    )
    filled = sum(1 for key in SIGNATURE_KEYS if _field_norm(d, key))
    return (int(not lacks_province(d)), money, filled, str(d.get("created_date") or ""))


def confident_money(d: dict) -> bool:
    gia = parse_vn_number(d.get("gia"))
    tt = parse_vn_number(d.get("thanhtien"))
    return gia not in (None, 0) and tt not in (None, 0)


def _same_bid_rows(con, d: dict) -> list[tuple[int, dict]]:
    found = []
    for row in _candidate_bid_rows(con, d):
        other = json.loads(row["raw"])
        if is_same_bid(d, other):
            found.append((int(row["id"]), other))
    return found


def save_rows(rows: list[dict], stop_check=None) -> int:
    n = 0
    with connect() as con:
        for index, d in enumerate(rows):
            if stop_check and index % 200 == 0 and stop_check():
                break
            if is_garbled_bid(d):
                continue
            for k in ("tungay_hd", "denngay_hd", "tungay", "denngay", "congbo"):
                if d.get(k):
                    d[k] = normalize_vss_date(d.get(k)) or d.get(k)
            # A second copy of a bid we already stored — including a province-less
            # or half-filled twin, and a truncated quantity — is not inserted.
            # Ambiguous matches (several different facilities) are left to the fingerprint.
            if confident_money(d):
                matches = _same_bid_rows(con, d)
                if len(matches) == 1:
                    existing_id, other = matches[0]
                    if bid_completeness(d) <= bid_completeness(other):
                        continue
                    con.execute("DELETE FROM bids WHERE id = ?", (existing_id,))
            fp = row_fingerprint(d)
            search = fold(" ".join(str(d.get(c) or "") for c in COLUMNS))
            nam = derive_nam(d)
            d["nam"] = nam
            try:
                cur = con.execute(
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
                if cur.rowcount:
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

    session = _borrow_session()
    for attempt in range(1, retries + 1):
        if _crawl_stop.is_set():
            raise CrawlStopped()
        try:
            if _vss_prefer_ip:
                url = f"https://{VSS_IP_FALLBACK}{VSS_EXPORT_PATH}"
                headers = _browser_headers(cookie, host=VSS_HOST)
                verify = False
            else:
                url = f"https://{VSS_HOST}{VSS_EXPORT_PATH}"
                headers = _browser_headers(cookie)
                verify = True
            resp = session.get(url, params=params, headers=headers, timeout=timeout, verify=verify)
            resp.raise_for_status()
            data = resp.content or b""
            if data.startswith(b"<") and b"Workbook" not in data[:500] and b"html" in data[:200].lower():
                raise RuntimeError(f"Export trả HTML lỗi (ngày {ngay})")
            if len(data) < 64:
                raise RuntimeError(f"Export rỗng / quá ngắn ({len(data)} bytes)")
            return data
        except CrawlStopped:
            raise
        except Exception as e:
            if _crawl_stop.is_set():
                raise CrawlStopped() from e
            last_err = e
            # DNS failure → switch to IP fallback next try
            err_s = str(e).lower()
            if "getaddrinfo" in err_s or "nameresolution" in err_s or "failed to resolve" in err_s:
                _vss_prefer_ip = True
            elif not _vss_prefer_ip and attempt == 1:
                # also try IP after first generic failure
                _vss_prefer_ip = True
            if _crawl_stop.wait(min(2 * attempt, 6)):
                raise CrawlStopped()
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
        failed_days = []
        completed_days = 0
        stopped = False
        mode = "bắt kịp export" if catchup else f"export {len(days_list)} ngày"
        update_status("vss", state="running", progress=1, message=f"Crawl VSS {mode}…", updated=now_iso())
        try:
            for day_i, ngay in enumerate(days_list):
                if _crawl_stop.is_set():
                    stopped = True
                    break
                try:
                    blob = download_kqdt_export(ngay, loai=loai, cookie=cookie)
                    rows = rows_from_export_bytes(blob)
                    for r in rows:
                        if not r.get("congbo"):
                            r["congbo"] = ngay
                        if not r.get("loai"):
                            r["loai"] = "Tân dược"
                    n = save_rows(rows, stop_check=_crawl_stop.is_set) if rows else 0
                    completed_days += 1
                    total_ins += n
                    if _crawl_stop.is_set():
                        stopped = True
                        break
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
                        # Holidays and quiet periods are not evidence that older
                        # announcement days contain no data. Scan the full range.
                    else:
                        empty_streak = 0
                except CrawlStopped:
                    stopped = True
                    break
                except Exception as e:
                    if _crawl_stop.is_set():
                        stopped = True
                        break
                    update_status("vss", message=f"Lỗi {ngay}: {e}")
                    failed_days.append({"day": ngay, "error": str(e)})
                    empty_streak += 1
                    if empty_streak >= empty_stop:
                        break
                # throttle 3–5s between days; stop wakes this wait immediately
                if day_i < len(days_list) - 1 and _crawl_stop.wait(3 + (day_i % 3)):
                    stopped = True
                    break
            info = meta_info()
            if stopped:
                update_status(
                    "vss", state="idle", progress=100,
                    message=f"Đã dừng · đã lưu +{total_ins}", updated=now_iso(), count=info["count"], added=total_ins,
                )
            elif failed_days:
                update_status(
                    "vss", state="error", progress=int(100 * completed_days / max(1, len(days_list))),
                    message=f"Chưa tải đủ: {completed_days}/{len(days_list)} ngày, {len(failed_days)} ngày lỗi · đã lưu +{total_ins}",
                    failed_days=failed_days, updated=now_iso(), count=info["count"], added=total_ins,
                )
            else:
                update_status(
                    "vss", state="idle", progress=100,
                    message=f"Crawl export xong +{total_ins}", failed_days=[], updated=now_iso(), count=info["count"], added=total_ins,
                )
        except Exception as e:
            if _crawl_stop.is_set():
                info = meta_info()
                update_status(
                    "vss", state="idle", progress=100,
                    message=f"Đã dừng · đã lưu +{total_ins}", updated=now_iso(), count=info["count"], added=total_ins,
                )
            else:
                update_status("vss", state="error", message=str(e), updated=now_iso())
        finally:
            _drop_session()

    _crawl_thread = threading.Thread(target=work, daemon=True, name="vss-export-crawl")
    _crawl_thread.start()
    return {"ok": True, "message": f"Đã bắt đầu crawl VSS export ({len(days_list)} ngày)"}


def stop_crawl():
    _crawl_stop.set()
    _drop_session()
    if crawl_alive():
        update_status("vss", message="Đang dừng…", updated=now_iso())
    else:
        update_status("vss", state="idle", progress=100, message="Đã dừng", updated=now_iso())
    return {"ok": True}



def meta_info() -> dict:
    info = {"count": 0, "updated": None}
    if not VSS_DB.exists():
        return info
    with connect() as con:
        stored = read_metadata(con, "vss_total")
        info["count"] = stored if stored is not None else 0
        info["updated"] = meta_get(con, "updated")
    return info


# Real bids columns used by the list. Money, province name, and a few dates
# live only inside raw JSON — project those keys, do not SELECT *.
_VSS_SQL_COLS = (
    "sodk", "hoatchat", "ten", "loai", "nhomthau", "loai_thau",
    "duongdung", "ma_tinh", "nuocsx", "tungay_hd", "denngay_hd", "nam",
)
_VSS_JSON_COLS = (
    "hamluong", "donvitinh", "soluong", "gia", "thanhtien", "nhasx",
    "ten_tinh", "ma_cskcb", "ten_cskcb", "congbo", "tennhathau", "tungay",
    "created_date",
)
_VSS_LIST_SQL = (
    "SELECT id AS _cursor_id, "
    + ", ".join(_VSS_SQL_COLS)
    + ", "
    + ", ".join(f"json_extract(raw, '$.{key}') AS {key}" for key in _VSS_JSON_COLS)
    + " FROM bids"
)


def _decode_cursor(value) -> tuple[str, int] | None:
    if not value:
        return None
    try:
        raw = base64.urlsafe_b64decode(str(value) + "===").decode("utf-8")
        data = json.loads(raw)
        return str(data["d"]), int(data["id"])
    except (ValueError, TypeError, KeyError, json.JSONDecodeError, UnicodeDecodeError):
        return None


def _encode_cursor(date_value, row_id) -> str:
    raw = json.dumps({"d": str(date_value or ""), "id": int(row_id)}, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def search_bids(filters: dict, page: int = 0, size: int = 50, cursor: str | None = None) -> dict:
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
        # Expand N3 / 3 / nhom 3 so multi-select does not false-match via bare digits
        if field == "nhomthau":
            expanded = []
            for v in vals:
                expanded.append(v)
                m = re.match(r"^(?:n|nhom|nhóm)\s*([1-5])$", v, re.I) or re.match(r"^([1-5])$", v)
                if m:
                    n = m.group(1)
                    expanded.extend([f"n{n}", n, f"nhom {n}", f"nhóm {n}"])
            vals = list(dict.fromkeys(expanded))
            parts = []
            for v in vals:
                # bare digit: exact only (LIKE '3%' would false-match N30 etc.)
                if re.match(r"^[1-5]$", v):
                    parts.append(f"(fold(coalesce({key},'')) = ?)")
                    args.append(v)
                else:
                    parts.append(f"(fold(coalesce({key},'')) = ? OR fold(coalesce({key},'')) LIKE ?)")
                    args.extend([v, f"{v}%"])
            clauses.append("(" + " OR ".join(parts) + ")")
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
                    OR coalesce(json_extract(raw, '$.congbo'), '') LIKE ?
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
        clauses.append("coalesce(tungay_hd,'') <= ?")
        args.append(filters["denNgay"] + " 23:59:59" if len(filters["denNgay"]) == 10 else filters["denNgay"])

    cursor_value = _decode_cursor(cursor)
    if cursor_value:
        clauses.append("(coalesce(tungay_hd,'') < ? OR (coalesce(tungay_hd,'') = ? AND id < ?))")
        args.extend([cursor_value[0], cursor_value[0], cursor_value[1]])
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    page = max(0, int(page))
    size = max(1, min(5000, int(size)))
    with connect() as con:
        rows = con.execute(
            _VSS_LIST_SQL + where +
            " ORDER BY coalesce(tungay_hd,'') DESC, id DESC LIMIT ?",
            args + [size + 1],
        ).fetchall()
    items = []
    for i, row in enumerate(rows):
        d = {}
        for key in (*_VSS_SQL_COLS, *_VSS_JSON_COLS):
            value = row[key]
            d[key] = "" if value is None else value
        d["stt"] = page * size + i + 1
        if d.get("nam") in (None, ""):
            d["nam"] = derive_nam(d)
        items.append(d)
    has_more = len(items) > size
    if has_more:
        items = items[:size]
    from .sdk_forms import form_for
    for item in items:
        item["dangbaoche"] = item.get("dangbaoche") or form_for(item.get("sodk"))
    next_cursor = None
    if has_more and rows:
        last = rows[size - 1]
        next_cursor = _encode_cursor(last["tungay_hd"], last["_cursor_id"])
    return {"total": None, "page": page, "size": size, "hasMore": has_more, "nextCursor": next_cursor, "items": items}
