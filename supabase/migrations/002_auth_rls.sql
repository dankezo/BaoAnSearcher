-- Require authenticated company users for all data access.
-- Service role (sync script) bypasses RLS.
-- Run in Supabase SQL Editor after 001_init.sql.

-- Tables: drop open anon policies, require authenticated
drop policy if exists vss_bids_select on public.vss_bids;
create policy vss_bids_select on public.vss_bids
  for select to authenticated
  using (true);

drop policy if exists dav_drugs_select on public.dav_drugs;
create policy dav_drugs_select on public.dav_drugs
  for select to authenticated
  using (true);

drop policy if exists msc_prices_select on public.msc_prices;
create policy msc_prices_select on public.msc_prices
  for select to authenticated
  using (true);

drop policy if exists msc_tenders_select on public.msc_tenders;
create policy msc_tenders_select on public.msc_tenders
  for select to authenticated
  using (true);

drop policy if exists app_meta_select on public.app_meta;
create policy app_meta_select on public.app_meta
  for select to authenticated
  using (true);

-- RPC: only signed-in users
revoke execute on function public.search_vss_bids from anon, public;
revoke execute on function public.search_dav_drugs from anon, public;
revoke execute on function public.search_msc from anon, public;

grant execute on function public.search_vss_bids to authenticated;
grant execute on function public.search_dav_drugs to authenticated;
grant execute on function public.search_msc to authenticated;

-- Optional hard domain check at JWT level (defense in depth; UI also checks)
-- Email domain is enforced in the SPA; Admin should only create @baoanpharma.com users
-- and disable public sign-up in Authentication → Providers → Email.
