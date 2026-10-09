"""Local brief shares cloud auth/RLS; other operations use the production bridge."""
import json
import os
from pathlib import Path
import subprocess
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import Response
import requests
from starlette.concurrency import run_in_threadpool

router = APIRouter()
ROOT = Path(__file__).resolve().parents[1]


def _local_brief(authorization: str):
    env = os.environ.copy()
    env.pop('SUPABASE_SERVICE_ROLE_KEY', None)
    try:
        result = subprocess.run(
            ['node', str(ROOT / 'scripts' / 'regulatory_local.mjs')],
            input=json.dumps({'authorization': authorization}), capture_output=True,
            text=True, encoding='utf-8', errors='replace', timeout=30, cwd=ROOT, env=env,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
        )
        payload = json.loads(result.stdout)
        status = int(payload['status'])
        if not 100 <= status <= 599 or not isinstance(payload['body'], dict):
            raise ValueError('Invalid local response')
    except (OSError, subprocess.TimeoutExpired, ValueError, KeyError, TypeError) as exc:
        raise HTTPException(502, 'Chưa tải được bản tin trên máy local.') from exc
    return Response(json.dumps(payload['body'], ensure_ascii=False), status_code=status,
                    media_type='application/json', headers={'Cache-Control': 'private, no-store'})

@router.api_route('/api/regulatory', methods=['GET', 'POST'])
async def regulatory(request: Request):
    authorization = request.headers.get('authorization', '')
    if not authorization.startswith('Bearer '):
        raise HTTPException(401, 'Cần đăng nhập tài khoản Bảo An.')
    if request.method == 'GET' and request.query_params.get('view') == 'brief':
        return await run_in_threadpool(_local_brief, authorization)
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 24000:
            raise HTTPException(413, 'Nội dung quá lớn.')
    try:
        result = await run_in_threadpool(
            requests.request, request.method, 'https://app.baoanpharma.com/api/regulatory',
            params=list(request.query_params.multi_items()), data=bytes(body),
            headers={'Authorization': authorization, 'Content-Type': 'application/json'},
            timeout=30, allow_redirects=False,
        )
    except requests.RequestException:
        raise HTTPException(502, 'Chưa kết nối được kho pháp luật.')
    return Response(result.content, status_code=result.status_code,
                    media_type='application/json', headers={'Cache-Control': 'private, no-store'})
