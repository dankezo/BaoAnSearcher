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

## Pages
Rebuild with Vite env set, then push `docs/`. Search goes to Supabase RPCs — no large `*.json.gz`.
