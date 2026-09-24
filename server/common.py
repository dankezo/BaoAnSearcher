# -*- coding: utf-8 -*-
"""Shared paths and helpers for BaoAn Searcher."""
from __future__ import annotations
import json
import re
import unicodedata
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER_DIR = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
WEB_PUBLIC = ROOT / "web" / "public" / "data"
SECRETS = SERVER_DIR / "secrets.local.json"

DAV_DB = ROOT / "test zone" / "data" / "thuoc.sqlite3"
MSC_DB = ROOT / "test zone" / "procurement" / "data" / "procurement.sqlite3"
VSS_DB = DATA_DIR / "vss_bhyt.sqlite3"
DM93_PATH = WEB_PUBLIC / "dm93.json"
STATUS_PATH = DATA_DIR / "crawl_status.json"

VN = timezone(timedelta(hours=7))
DAV_SEARCH_URL = "https://dichvucong.dav.gov.vn/congbothuoc/index"
DAV_API = "https://dichvucong.dav.gov.vn/api/services/app/soDangKy/GetAllPublicServerPaging"
VSS_BASE = "https://quanlythuocv1.vss.gov.vn"


def fold(text: str) -> str:
    s = str(text or "").lower().replace("đ", "d").replace("Đ", "d")
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def now_iso() -> str:
    return datetime.now(VN).isoformat(timespec="seconds")


def load_secrets() -> dict:
    if SECRETS.exists():
        return json.loads(SECRETS.read_text(encoding="utf-8"))
    return {}


def save_secrets(data: dict) -> None:
    SECRETS.parent.mkdir(parents=True, exist_ok=True)
    SECRETS.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def load_status() -> dict:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    default = {
        "dav": {"state": "idle", "progress": 0, "message": "", "updated": None, "count": 0},
        "msc": {"state": "idle", "progress": 0, "message": "", "updated": None, "count": 0},
        "vss": {"state": "idle", "progress": 0, "message": "", "updated": None, "count": 0},
    }
    if not STATUS_PATH.exists():
        return default
    try:
        raw = STATUS_PATH.read_text(encoding="utf-8").strip()
        if not raw:
            return default
        data = json.loads(raw)
        if not isinstance(data, dict):
            return default
        for key in default:
            data.setdefault(key, dict(default[key]))
        return data
    except (json.JSONDecodeError, OSError):
        return default


def save_status(status: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATUS_PATH.with_suffix(".json.tmp")
    payload = json.dumps(status, ensure_ascii=False, indent=2)
    tmp.write_text(payload, encoding="utf-8")
    tmp.replace(STATUS_PATH)


def update_status(app: str, **kwargs) -> dict:
    status = load_status()
    status.setdefault(app, {})
    status[app].update(kwargs)
    save_status(status)
    return status


# Synonyms for DM93 matching (TT 03/2024 notes)
SYNONYMS = {
    "aciclovir": "acyclovir",
    "acetaminophen": "paracetamol",
    "cefuroxim": "cefuroxime",
    "hydroclorid": "hydrochloride",
    "hydrocloride": "hydrochloride",
    "natri": "sodium",
    "mirtazapine": "mirtazapin",
    "olanzapine": "olanzapin",
    "venlafaxine": "venlafaxin",
    "perindopril tert butylamine": "perindopril tert-butylamine",
    "pcrindopril tert-butylamine": "perindopril tert-butylamine",
}


def normalize_ingredient_token(text: str) -> str:
    t = fold(text)
    t = re.sub(r"[;/|+]+", ";", t)
    t = re.sub(r"\s+", " ", t).strip()
    for a, b in SYNONYMS.items():
        t = re.sub(rf"\b{re.escape(a)}\b", b, t)
    return t


def normalize_strength(text: str) -> str:
    t = fold(text)
    t = t.replace(",", ".")
    t = re.sub(r"\s+", "", t)
    t = t.replace("microgam", "mcg").replace("µg", "mcg").replace("μg", "mcg")
    return t


def normalize_dosage_form(text: str) -> str:
    t = fold(text)
    # Map conventional forms to DM93 buckets
    if any(x in t for x in ("tiem", "inject", "dung dich tiem", "hon dich tiem", "nhu tuong")):
        if any(x in t for x in ("dong kho", "liposome", "nano", "keo dai", "nhan cau")):
            return t  # special — uncertain
        return "thuoc tiem"
    if any(x in t for x in ("bao tan o ruot", "bao tan ruot", "enteric")):
        return "vien bao tan o ruot"
    if any(x in t for x in ("giai phong", "kiem soat", "retard", "xr", "sr", "mr")):
        return "vien giai phong co kiem soat"
    if "nang" in t:
        return "vien nang" if "vien nang" in "vien nang" else "vien nang"
    if any(x in t for x in ("vien", "nen", "nang", "tablet", "capsule")):
        # conventional tablet/capsule → "vien" for DM93 unless special
        if "bao tan" in t:
            return "vien bao tan o ruot"
        if "giai phong" in t or "kiem soat" in t:
            return "vien giai phong co kiem soat"
        if "nang" in t and "fluconazole" not in t:
            # Fluconazole DM93 is specifically "Viên nang"
            return "vien"  # conventional
        return "vien"
    return t


def split_ingredients(text: str) -> list[str]:
    raw = str(text or "")
    parts = re.split(r"\s*[;/|+]\s*|\s+va\s+|\s+and\s+|\s*\+\s*", raw, flags=re.I)
    return [normalize_ingredient_token(p) for p in parts if p and p.strip()]


def parse_date(value) -> datetime | None:
    if not value:
        return None
    s = str(value).strip()
    if not s:
        return None
    # ISO or date-only
    for fmt in (
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
        "%d/%m/%Y",
        "%d-%m-%Y",
    ):
        try:
            if fmt.endswith("%z") and s.endswith("Z"):
                s2 = s[:-1] + "+0000"
            else:
                s2 = s
            # truncate fractional / fix +07:00
            if "+07:00" in s2:
                s2 = s2.replace("+07:00", "+0700")
            if "." in s2 and "T" in s2:
                # drop ms
                head, rest = s2.split(".", 1)
                tz = ""
                for sep in ("+", "-"):
                    if sep in rest[1:] if rest[0].isdigit() else rest:
                        idx = rest.find(sep, 1) if rest[0].isdigit() else rest.find(sep)
                        # simpler:
                        break
                m = re.match(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})", s)
                if m:
                    base = m.group(1)
                    zm = re.search(r"([+-]\d{2}):?(\d{2})$", s)
                    if zm:
                        try:
                            return datetime.strptime(base + zm.group(1) + zm.group(2), "%Y-%m-%dT%H:%M:%S%z")
                        except ValueError:
                            pass
                    try:
                        return datetime.strptime(base, "%Y-%m-%dT%H:%M:%S").replace(tzinfo=VN)
                    except ValueError:
                        pass
            return datetime.strptime(s2[: len(fmt) + 8], fmt)
        except ValueError:
            continue
    # fallback: first 10 chars date
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").replace(tzinfo=VN)
    except ValueError:
        return None


def years_between(start: datetime, end: datetime) -> float:
    if start.tzinfo is None:
        start = start.replace(tzinfo=VN)
    if end.tzinfo is None:
        end = end.replace(tzinfo=VN)
    return (end - start).total_seconds() / (365.25 * 24 * 3600)
