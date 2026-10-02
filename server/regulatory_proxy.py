"""Local same-origin bridge; production enforces the user's JWT and database RLS."""
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import Response
import requests
from starlette.concurrency import run_in_threadpool

router = APIRouter()

@router.api_route('/api/regulatory', methods=['GET', 'POST'])
async def regulatory(request: Request):
    authorization = request.headers.get('authorization', '')
    if not authorization.startswith('Bearer '):
        raise HTTPException(401, 'Cần đăng nhập tài khoản Bảo An.')
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
