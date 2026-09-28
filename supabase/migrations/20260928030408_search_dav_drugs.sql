-- DAV only: safe to run after 001/002, or on a project without DAV tables.
-- An empty table still needs DAV synchronization before searches can return data.
begin;
create extension if not exists pg_trgm;
create table if not exists public.dav_drugs (
  id text primary key,
  search text not null default '',
  so_dang_ky text,
  so_dang_ky_cu text,
  ten_thuoc text,
  ngay_cap text,
  ngay_gia_han text,
  ngay_het_han text,
  hoat_chat text,
  ham_luong text,
  dang_bao_che text,
  dong_goi text,
  han_dung text,
  cty_san_xuat text,
  nuoc_san_xuat text,
  cty_dang_ky text,
  nuoc_dang_ky text,
  so_quyet_dinh text,
  tieu_chuan text,
  ky_cap_nam text,
  con_hieu_luc boolean,
  ingredient_count integer,
  tag_id text,
  updated_at timestamptz not null default now()
);

create index if not exists idx_dav_search_trgm on public.dav_drugs using gin (search gin_trgm_ops);
create index if not exists idx_dav_ngay on public.dav_drugs (ngay_gia_han desc nulls last, ngay_cap desc nulls last);


alter table public.dav_drugs enable row level security;
drop policy if exists dav_drugs_select on public.dav_drugs;
create policy dav_drugs_select on public.dav_drugs for select to authenticated using (true);
grant select on public.dav_drugs to authenticated;

create or replace function public.dav_fold(p_text text)
returns text language sql immutable strict parallel safe
set search_path = pg_catalog
as $$ select replace(regexp_replace(normalize(lower(p_text), NFD), '[̀-ͯ]', '', 'g'), 'đ', 'd') $$;

-- Replace the legacy seven-argument signature; the eighth argument has a default,
-- so both legacy seven-argument callers and advanced filters use one unambiguous RPC.
drop function if exists public.search_dav_drugs(text, text, text, text, text, integer, integer);
create or replace function public.search_dav_drugs(
  p_q text default null,
  p_ten_thuoc text default null,
  p_so_dang_ky text default null,
  p_hoat_chat text default null,
  p_dang_bao_che text default null,
  p_page integer default 0,
  p_size integer default 100,
  p_filters jsonb default null
)
returns jsonb language sql stable security invoker
set search_path = pg_catalog, public
as $$
with limits as (
  select greatest(0, coalesce(p_page, 0)) as page,
         least(2000, greatest(1, coalesce(p_size, 100))) as size
), catalog as materialized (
  select d.*, public.dav_fold(coalesce(hoat_chat, '')) as ingredient_key
  from public.dav_drugs d
), groups as (
  select ingredient_key,
    count(distinct nullif(public.dav_fold(dang_bao_che), '')) as form_count,
    count(distinct nullif(regexp_replace(public.dav_fold(ham_luong), '[[:space:]]', '', 'g'), '')) as strength_count
  from catalog group by ingredient_key
), filtered as materialized (
  select d.* from catalog d join groups g using (ingredient_key)
  where (nullif(trim(p_q), '') is null or not exists (
    select 1 from regexp_split_to_table(public.dav_fold(trim(p_q)), '[[:space:]]+') w
    where coalesce(d.search, '') not like '%' || w || '%'
  ))
  and (nullif(trim(p_ten_thuoc), '') is null or public.dav_fold(coalesce(d.ten_thuoc, '')) like '%' || public.dav_fold(trim(p_ten_thuoc)) || '%')
  and (nullif(trim(p_so_dang_ky), '') is null or public.dav_fold(concat_ws(' ', d.so_dang_ky, d.so_dang_ky_cu)) like '%' || public.dav_fold(trim(p_so_dang_ky)) || '%')
  and (nullif(trim(p_hoat_chat), '') is null or public.dav_fold(coalesce(d.hoat_chat, '')) like '%' || public.dav_fold(trim(p_hoat_chat)) || '%')
  and (nullif(trim(p_dang_bao_che), '') is null or public.dav_fold(coalesce(d.dang_bao_che, '')) like '%' || public.dav_fold(trim(p_dang_bao_che)) || '%')
  and (nullif(trim(p_filters->>'sanXuat'), '') is null or public.dav_fold(coalesce(d.cty_san_xuat, '')) like '%' || public.dav_fold(trim(p_filters->>'sanXuat')) || '%')
  and (nullif(trim(p_filters->>'dangKy'), '') is null or public.dav_fold(coalesce(d.cty_dang_ky, '')) like '%' || public.dav_fold(trim(p_filters->>'dangKy')) || '%')
  and (coalesce(p_filters->'nuocSanXuat', 'null'::jsonb) in ('null'::jsonb, '[]'::jsonb) or exists (
    select 1 from jsonb_array_elements_text(p_filters->'nuocSanXuat') country
    where public.dav_fold(coalesce(d.nuoc_san_xuat, '')) like '%' || public.dav_fold(country) || '%'
  ))
  and (coalesce(p_filters->'tags', 'null'::jsonb) = 'null'::jsonb or exists (
    select 1 from jsonb_array_elements_text(p_filters->'tags') tag where tag = d.tag_id
  ))
  and not exists (
    select 1 from (values
      (d.ingredient_count::bigint, p_filters->>'ingredientCount', p_filters->>'ingredientCountOther'),
      (g.form_count, p_filters->>'dosageFormCount', p_filters->>'dosageFormCountOther'),
      (g.strength_count, p_filters->>'strengthCount', p_filters->>'strengthCountOther')
    ) counts(actual, choice, other)
    where case when choice = 'other' then other else choice end ~ '^[0-9]+$'
      and coalesce(actual, 0)::numeric <> (case when choice = 'other' then other else choice end)::numeric
  )
), page_rows as (
  select d.* from filtered d
  order by coalesce(nullif(d.ngay_cap, ''), nullif(d.ngay_gia_han, ''), d.ngay_het_han, '') desc, d.id
  limit (select size from limits) offset (select page::bigint * size from limits)
)
select jsonb_build_object(
  'total', (select count(*) from filtered),
  'page', limits.page, 'size', limits.size,
  'items', coalesce((select jsonb_agg(to_jsonb(r) - 'ingredient_key' - 'search' - 'updated_at') from page_rows r), '[]'::jsonb)
) from limits;
$$;

revoke execute on function public.search_dav_drugs(text, text, text, text, text, integer, integer, jsonb) from public, anon;
grant execute on function public.search_dav_drugs(text, text, text, text, text, integer, integer, jsonb) to authenticated;
commit;
NOTIFY pgrst, 'reload schema';
