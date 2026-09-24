# BaoAn Searcher

Web thống nhất: **tra cứu thuốc DAV**, **lọc thầu MSC**, **thuốc trúng thầu BHYT (VSS)** + **quản trị crawl**.

## Chạy trên máy (đầy đủ)

```bash
# API
pip install -r server/requirements.txt
python -m uvicorn server.main:app --host 127.0.0.1 --port 8787 --reload

# UI (terminal khác)
cd web
npm install
npm run dev
```

Mở http://127.0.0.1:5173 — Vite proxy `/api` → `8787`.

Hoặc build rồi để API phục vụ luôn:

```bash
cd web && npm run build
python -m uvicorn server.main:app --host 127.0.0.1 --port 8787
```

Mở http://127.0.0.1:8787

### Dữ liệu local (không commit)

| Miniapp | Đường dẫn |
|--------|-----------|
| DAV | `test zone/data/thuoc.sqlite3` |
| MSC | `test zone/procurement/data/procurement.sqlite3` |
| VSS | `data/vss_bhyt.sqlite3` |
| Secrets | `server/secrets.local.json` |

Import Excel BHYT: đặt file hoặc dùng nút **Import Excel mặc định** (đường dẫn Desktop HAR folder).

## GitHub Pages + Supabase (đủ data, không lag)

Pages **không** nhúng JSON.gz lớn. Search gọi Postgres qua Supabase (VSS đủ từ 2024→nay).

1. Tạo project Supabase → chạy SQL [`supabase/migrations/001_init.sql`](supabase/migrations/001_init.sql) (xem [`supabase/README.md`](supabase/README.md)).
2. Root `.env` (từ [`.env.example`](.env.example)): `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
3. `web/.env.local` (từ [`web/.env.example`](web/.env.example)): `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`.
4. Crawl local (tab Quản trị) → `python scripts/sync_to_supabase.py` (hoặc nút Sync trong Admin).
5. `python scripts/export_all_for_pages.py` (build SPA nhẹ) → commit + push `master` / `/docs`.

Local API (`MO_WEB`) vẫn dùng SQLite đầy đủ offline.

## Danh mục 93

Nhúng tại [`web/public/data/dm93.json`](web/public/data/dm93.json) theo Phụ lục TT 03/2024/TT-BYT.

## Ghi chú

- Pages **không** chạy crawl / không lưu mật khẩu / **không** commit `service_role`.
- Mật khẩu MSC lưu local ngoài git, dùng điền sẵn khi mở browser crawl.
