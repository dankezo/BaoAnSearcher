create table if not exists public.user_saved_filters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  configuration jsonb not null check (jsonb_typeof(configuration) = 'object'),
  version integer not null default 1 check (version = 1),
  created_at timestamptz not null default now()
);
create index if not exists user_saved_filters_owner on public.user_saved_filters(user_id,created_at);
alter table public.user_saved_filters enable row level security;
revoke all on public.user_saved_filters from anon, authenticated;
grant select,insert,update,delete on public.user_saved_filters to authenticated;
create policy analytics_presets_select on public.user_saved_filters for select to authenticated using ((select auth.uid())=user_id);
create policy analytics_presets_insert on public.user_saved_filters for insert to authenticated with check ((select auth.uid())=user_id);
create policy analytics_presets_update on public.user_saved_filters for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy analytics_presets_delete on public.user_saved_filters for delete to authenticated using ((select auth.uid())=user_id);
