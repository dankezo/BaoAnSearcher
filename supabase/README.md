# Supabase (BaoAn Searcher)

## Setup
1. Create a free project at https://supabase.com
2. SQL Editor → paste and run [`migrations/001_init.sql`](migrations/001_init.sql)
3. Project Settings → API → copy URL, `anon` key, `service_role` key
4. Root `.env` (from [`.env.example`](../.env.example)):
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (sync only — never expose to browser/git)
5. `web/.env.local` (from [`web/.env.example`](../web/.env.example)):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY` (safe to ship in Pages build)

## Sync local SQLite → cloud
```bash
pip install -r server/requirements.txt
python scripts/sync_to_supabase.py
# or: python scripts/sync_to_supabase.py --only vss
```

VSS syncs `nam >= 2024` (full years through current). DAV/MSC sync full tables.

## Auth (nội bộ @baoanpharma.com)

1. Chạy thêm SQL [`migrations/002_auth_rls.sql`](migrations/002_auth_rls.sql) (chỉ `authenticated` đọc data).
2. Authentication → Providers → Email: bật Email; **giữ Allow new users to sign up = ON** nếu dùng Outlook (lần đầu OAuth tạo user). App vẫn chỉ cho phép email trong allowlist.
3. URL Configuration (**quan trọng — nếu để localhost sẽ nhảy về localhost:3000**):
   - Site URL: `https://app.baoanpharma.com`  ← **đổi ngay**, không để `http://localhost:3000`
   - Redirect URLs (mỗi dòng một URL):
     - `https://app.baoanpharma.com`
     - `https://app.baoanpharma.com/**`
     - `https://baoan-searcher.vercel.app/**`
     - `http://localhost:5173/**` (chỉ khi dev Vite)
4. Frontend: `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`.

### Đăng nhập Outlook (Microsoft Azure)

App có nút **Đăng nhập với Outlook**. Cần bật provider Azure một lần:

1. **Azure Portal** → Microsoft Entra ID → App registrations → **New registration**
   - Name: `BaoAn Searcher`
   - Supported accounts: *Accounts in this organizational directory only* (chỉ tenant BaoAn)
   - Redirect URI (Web): `https://gojdltnquedwpcqvecob.supabase.co/auth/v1/callback`
2. **Certificates & secrets** → New client secret → copy **Value**
3. **API permissions** → Microsoft Graph (Delegated): `openid`, `profile`, `email`, `offline_access`, `User.Read` → **Grant admin consent**
4. **Enterprise applications** → BaoAn Searcher → Users and groups → **Add** `sales@baoanpharma.com` và `importer@baoanpharma.com` (Assignment required = Yes nếu muốn chỉ 2 TK này)
5. **Supabase** → Authentication → Providers → **Azure**
   - Enable = **ON** (bắt buộc — chỉ tạo App trên Azure chưa đủ)
   - Application (client) ID
   - Client secret (Value)
   - Azure Tenant URL (optional, single-tenant): `https://login.microsoftonline.com/<TENANT_ID>`
6. Authentication → Providers → Email: **Allow new users to sign up = ON** (OAuth lần đầu cần tạo user; app vẫn chặn email ngoài allowlist).
7. Soft-launch: mở `https://app.baoanpharma.com` → **Đăng nhập với Outlook** → chọn sales/importer.

Kiểm tra: `GET https://gojdltnquedwpcqvecob.supabase.co/auth/v1/settings` → `external.azure` phải là `true`.

Allowlist trong code: `sales@`, `importer@`, `admin@`, `sonnguyen@`, `tuanvu@` (`web/src/supabaseClient.js`). Thêm email mới = sửa list + redeploy.

SPA Vite chặn email ngoài allowlist và bắt đăng nhập trước khi vào tool.
