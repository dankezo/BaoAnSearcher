# -*- coding: utf-8 -*-
"""On-demand Gemini for the home dashboard.

Local app calls the same prompts as the Vercel routes. If this machine has no
GEMINI_API_KEY, the signed-in request is forwarded to production.
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import requests
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

ROOT = Path(__file__).resolve().parents[1]
router = APIRouter()


def _load_env() -> None:
    if os.environ.get("GEMINI_API_KEY"):
        return
    try:
        from dotenv import load_dotenv
        load_dotenv(ROOT / ".env")
    except Exception:
        return


def _local(kind: str, body: dict) -> dict:
    _load_env()
    if not os.environ.get("GEMINI_API_KEY"):
        raise HTTPException(503, "Chưa có GEMINI_API_KEY trong .env của máy local.")
    try:
        proc = subprocess.run(
            ["node", str(ROOT / "scripts" / "gemini_ondemand.mjs")],
            input=json.dumps({"kind": kind, "body": body}, ensure_ascii=False),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=40,
            cwd=ROOT,
            env=os.environ.copy(),
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise HTTPException(502, "Không chạy được phân tích AI trên máy local.") from exc
    try:
        payload = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(502, "Phân tích AI trả về không đọc được.") from exc
    if payload.get("error"):
        raise HTTPException(int(payload.get("status") or 502), str(payload["error"]))
    return payload


def _proxy(path: str, authorization: str, body: bytes) -> JSONResponse:
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Cần đăng nhập tài khoản Bảo An để phân tích trên cloud.")
    try:
        result = requests.post(
            f"https://app.baoanpharma.com{path}",
            data=body,
            headers={"Authorization": authorization, "Content-Type": "application/json"},
            timeout=60,
            allow_redirects=False,
        )
    except requests.RequestException as exc:
        raise HTTPException(502, "Chưa kết nối được phân tích AI trên cloud.") from exc
    return JSONResponse(content=result.json() if result.content else {}, status_code=result.status_code)


async def _handle(kind: str, path: str, request: Request):
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > 12000:
            raise HTTPException(413, "Nội dung quá lớn.")
    try:
        body = json.loads(bytes(raw) or b"{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(400, "JSON không hợp lệ.") from exc
    _load_env()
    # News has a shared staff cache on cloud, even when this machine has an AI key.
    if kind != "news" and os.environ.get("GEMINI_API_KEY"):
        payload = await run_in_threadpool(_local, kind, body if isinstance(body, dict) else {})
        return JSONResponse(payload)
    return await run_in_threadpool(_proxy, path, request.headers.get("authorization", ""), bytes(raw))


@router.post("/api/gemini/analyze-news")
async def analyze_news(request: Request):
    return await _handle("news", "/api/gemini/analyze-news", request)


@router.post("/api/gemini/analyze-legal")
async def analyze_legal(request: Request):
    return await _handle("legal", "/api/gemini/analyze-legal", request)
