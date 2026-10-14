create table public.user_saved_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  source text not null check (source in ('dav','vss','msc_prices','msc_tenders','tender','analytics','map')),
  row_count integer not null check (row_count between 1 and 50000),
  snapshot jsonb not null check (coalesce(jsonb_typeof(snapshot) = 'object' and snapshot->>'version' = '1' and jsonb_typeof(snapshot->'rows') = 'array' and jsonb_array_length(snapshot->'rows') = row_count and octet_length(snapshot::text) <= 8388608,false)),
  created_at timestamptz not null default now()
);
create index user_saved_results_owner on public.user_saved_results(user_id,created_at desc,id desc);
alter table public.user_saved_results enable row level security;
revoke all on public.user_saved_results from anon, authenticated;
grant select,insert,delete on public.user_saved_results to authenticated;
create policy saved_results_select on public.user_saved_results for select to authenticated using ((select auth.uid())=user_id);
create policy saved_results_insert on public.user_saved_results for insert to authenticated with check ((select auth.uid())=user_id);
create policy saved_results_delete on public.user_saved_results for delete to authenticated using ((select auth.uid())=user_id);
