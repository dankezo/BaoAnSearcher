# -*- coding: utf-8 -*-
"""Alias → update_vss_today (Excel export crawl)."""
from __future__ import annotations
import runpy
from pathlib import Path

if __name__ == "__main__":
    print("NOTE: dùng /kqdt/export (1 Excel/ngày), không còn HTML phân trang", flush=True)
    runpy.run_path(str(Path(__file__).with_name("update_vss_today.py")), run_name="__main__")
