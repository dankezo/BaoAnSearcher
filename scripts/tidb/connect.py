# -*- coding: utf-8 -*-
"""TiDB connection from TIDB_DATABASE_URL or TIDB_HOST/USER/DATABASE. Never prints the password."""
from __future__ import annotations

import os
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parents[2]


def load_env() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    load_dotenv(ROOT / ".env")
    load_dotenv(ROOT / "web" / ".env.local")


def config_from_env() -> dict | None:
    url = (os.environ.get("TIDB_DATABASE_URL") or "").strip()
    if url:
        parsed = urlparse(url)
        if parsed.scheme not in ("mysql", "mysqls"):
            raise SystemExit("TIDB_DATABASE_URL phải bắt đầu bằng mysql://")
        database = parsed.path.lstrip("/").split("?")[0]
        if not parsed.hostname or not parsed.username or not database:
            raise SystemExit("TIDB_DATABASE_URL thiếu host, user hoặc tên database.")
        return {
            "host": parsed.hostname,
            "port": parsed.port or 4000,
            "user": unquote(parsed.username),
            "password": unquote(parsed.password or ""),
            "database": database,
        }
    host = (os.environ.get("TIDB_HOST") or "").strip()
    user = (os.environ.get("TIDB_USER") or "").strip()
    database = (os.environ.get("TIDB_DATABASE") or "").strip()
    if not (host and user and database):
        return None
    return {
        "host": host,
        "port": int(os.environ.get("TIDB_PORT") or "4000"),
        "user": user,
        "password": os.environ.get("TIDB_PASSWORD") or "",
        "database": database,
    }


def public_target(cfg: dict) -> str:
    return f"{cfg['user']}@{cfg['host']}:{cfg['port']}/{cfg['database']}"


def connect(cfg: dict):
    try:
        import pymysql
    except ImportError as exc:
        raise SystemExit("Thiếu pymysql. Cài bằng: pip install pymysql") from exc
    ssl_off = (os.environ.get("TIDB_SSL") or "").strip() in ("0", "false", "False")
    kwargs = dict(
        host=cfg["host"],
        port=int(cfg["port"]),
        user=cfg["user"],
        password=cfg["password"],
        database=cfg["database"],
        charset="utf8mb4",
        connect_timeout=8,
        read_timeout=180,
        write_timeout=180,
        autocommit=False,
    )
    if not ssl_off:
        kwargs["ssl"] = {"check_hostname": False}
    return pymysql.connect(**kwargs)


def require_config() -> dict:
    load_env()
    cfg = config_from_env()
    if cfg is None:
        print(
            "TiDB chưa cấu hình. Đặt TIDB_DATABASE_URL hoặc TIDB_HOST, TIDB_USER, TIDB_DATABASE.",
            file=sys.stderr,
        )
        raise SystemExit(2)
    return cfg
