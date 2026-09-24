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

## Auth nội bộ + Vercel (`app.baoanpharma.com`)

App là **Vite SPA** (không phải Next.js). Auth dùng `@supabase/supabase-js`.

### Biến môi trường

| Biến | Ở đâu | Ghi chú |
|------|--------|---------|
| `VITE_SUPABASE_URL` | `web/.env.local` + Vercel | Bắt buộc (hoặc `NEXT_PUBLIC_SUPABASE_URL`) |
| `VITE_SUPABASE_ANON_KEY` | `web/.env.local` + Vercel | Bắt buộc (hoặc `NEXT_PUBLIC_SUPABASE_ANON_KEY`) |
| `SUPABASE_SERVICE_ROLE_KEY` | root `.env` only | Sync script — **không** đưa lên Vercel/frontend |

### Supabase Dashboard
1. SQL: `supabase/migrations/001_init.sql` rồi `002_auth_rls.sql`
2. Tắt public sign-up; Add user `@baoanpharma.com`
3. Site URL / Redirect: `https://app.baoanpharma.com`

### Deploy Vercel + Cloudflare
1. Push GitHub → import project trên Vercel (`vercel.json` ở root → build `web/`).
2. Env trên Vercel: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (hoặc cặp `NEXT_PUBLIC_*`).
3. Cloudflare DNS: CNAME `app` → `cname.vercel-dns.com` (Proxied).
4. Vercel Domains: thêm `app.baoanpharma.com`.

Local API / crawl vẫn chạy trên máy sau khi đăng nhập.

## Danh mục 93

Nhúng tại [`web/public/data/dm93.json`](web/public/data/dm93.json) theo Phụ lục TT 03/2024/TT-BYT.

## Ghi chú

- Pages **không** chạy crawl / không lưu mật khẩu / **không** commit `service_role`.
- Mật khẩu MSC lưu local ngoài git, dùng điền sẵn khi mở browser crawl.
