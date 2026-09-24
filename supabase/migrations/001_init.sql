-- BaoAn Searcher — Supabase init
-- Run in SQL Editor (or supabase db push). Enables Pages remote search.

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- VSS bids (nam >= 2024 synced from local SQLite)
-- ---------------------------------------------------------------------------
create table if not exists public.vss_bids (
  fingerprint text primary key,
  search text not null default '',
  hoatchat text,
  sodk text,
  ten text,
  duongdung text,
  hamluong text,
  donvitinh text,
  soluong text,
  gia text,
  thanhtien text,
  nhomthau text,
  nhasx text,
  nuocsx text,
  ma_tinh text,
  ma_cskcb text,
  tungay_hd text,
  denngay_hd text,
  loai_thau text,
  congbo text,
  nam integer,
  ten_tinh text,
  ten_cskcb text,
  tennhathau text,
  dangbaoche text,
  loai text,
  updated_at timestamptz not null default now()
);

create index if not exists idx_vss_search_trgm on public.vss_bids using gin (search gin_trgm_ops);
create index if not exists idx_vss_tungay on public.vss_bids (tungay_hd desc nulls last);
create index if not exists idx_vss_nam on public.vss_bids (nam);
create index if not exists idx_vss_hoatchat on public.vss_bids (hoatchat);
create index if not exists idx_vss_sodk on public.vss_bids (sodk);
create index if not exists idx_vss_ma_tinh on public.vss_bids (ma_tinh);

-- ---------------------------------------------------------------------------
-- DAV drugs
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- MSC prices / tenders
-- ---------------------------------------------------------------------------
create table if not exists public.msc_prices (
  source_id text primary key,
  search text not null default '',
  name text,
  ingredient text,
  strength text,
  registration text,
  unit_price text,
  quantity text,
  unit text,
  group_name text,
  medicine_type text,
  manufacturer text,
  country text,
  buyer text,
  province text,
  tender_no text,
  published text,
  winner text,
  source_url text,
  collected_at text,
  updated_at timestamptz not null default now()
);

create table if not exists public.msc_tenders (
  source_id text primary key,
  search text not null default '',
  tender_no text,
  name text,
  buyer text,
  province text,
  published text,
  close_date text,
  status_label text,
  status_code text,
  bid_price text,
  bid_form text,
  source_url text,
  collected_at text,
  updated_at timestamptz not null default now()
);

create index if not exists idx_msc_prices_search on public.msc_prices using gin (search gin_trgm_ops);
create index if not exists idx_msc_prices_pub on public.msc_prices (published desc nulls last);
create index if not exists idx_msc_tenders_search on public.msc_tenders using gin (search gin_trgm_ops);
create index if not exists idx_msc_tenders_pub on public.msc_tenders (published desc nulls last);

-- ---------------------------------------------------------------------------
-- Meta / status for UI freshness
-- ---------------------------------------------------------------------------
create table if not exists public.app_meta (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS: anon read-only
-- ---------------------------------------------------------------------------
alter table public.vss_bids enable row level security;
alter table public.dav_drugs enable row level security;
alter table public.msc_prices enable row level security;
alter table public.msc_tenders enable row level security;
alter table public.app_meta enable row level security;

drop policy if exists vss_bids_select on public.vss_bids;
create policy vss_bids_select on public.vss_bids for select to anon, authenticated using (true);

drop policy if exists dav_drugs_select on public.dav_drugs;
create policy dav_drugs_select on public.dav_drugs for select to anon, authenticated using (true);

drop policy if exists msc_prices_select on public.msc_prices;
create policy msc_prices_select on public.msc_prices for select to anon, authenticated using (true);

drop policy if exists msc_tenders_select on public.msc_tenders;
create policy msc_tenders_select on public.msc_tenders for select to anon, authenticated using (true);

drop policy if exists app_meta_select on public.app_meta;
create policy app_meta_select on public.app_meta for select to anon, authenticated using (true);

-- Service role bypasses RLS for sync upserts.

-- ---------------------------------------------------------------------------
-- Fold helper (mirror server/common.fold — approximate via unaccent + lower)
-- Client also folds; search column is pre-folded at sync time.
-- ---------------------------------------------------------------------------

create or replace function public.search_vss_bids(
  p_q text default null,
  p_hoatchat text default null,
  p_sodk text default null,
  p_loai text default null,
  p_nhomthau text default null,
  p_loai_thau text default null,
  p_duongdung text default null,
  p_ma_tinh text default null,
  p_nuocsx text default null,
  p_nam int default null,
  p_tu_ngay text default null,
  p_den_ngay text default null,
  p_page int default 0,
  p_size int default 100
)
returns jsonb
language plpgsql
stable
security invoker
as $$
declare
  v_page int := greatest(0, coalesce(p_page, 0));
  v_size int := least(5000, greatest(1, coalesce(p_size, 100)));
  v_total bigint;
  v_items jsonb;
  y text;
  y_start text;
  y_end text;
begin
  y := case when p_nam is not null then p_nam::text else null end;
  y_start := case when y is not null then y || '-01-01' else null end;
  y_end := case when y is not null then y || '-12-31' else null end;

  select count(*) into v_total
  from public.vss_bids b
  where
    (p_q is null or p_q = '' or (
      select bool_and(b.search like '%' || w || '%')
      from unnest(string_to_array(trim(p_q), ' ')) w
      where w <> ''
    ))
    and (p_hoatchat is null or p_hoatchat = '' or coalesce(b.hoatchat,'') ilike '%' || p_hoatchat || '%')
    and (p_sodk is null or p_sodk = '' or coalesce(b.sodk,'') ilike '%' || p_sodk || '%')
    and (p_loai is null or p_loai = '' or coalesce(b.loai,'') ilike '%' || p_loai || '%')
    and (p_nhomthau is null or p_nhomthau = '' or coalesce(b.nhomthau,'') ilike '%' || p_nhomthau || '%')
    and (p_loai_thau is null or p_loai_thau = '' or coalesce(b.loai_thau,'') ilike '%' || p_loai_thau || '%')
    and (p_duongdung is null or p_duongdung = '' or coalesce(b.duongdung,'') ilike '%' || p_duongdung || '%')
    and (p_ma_tinh is null or p_ma_tinh = '' or coalesce(b.ma_tinh,'') ilike '%' || p_ma_tinh || '%')
    and (p_nuocsx is null or p_nuocsx = '' or coalesce(b.nuocsx,'') ilike '%' || p_nuocsx || '%')
    and (p_tu_ngay is null or p_tu_ngay = '' or coalesce(b.tungay_hd,'') >= p_tu_ngay)
    and (p_den_ngay is null or p_den_ngay = '' or coalesce(b.denngay_hd,'') <= (p_den_ngay || ' 23:59:59'))
    and (
      p_nam is null or (
        b.nam = p_nam
        or coalesce(b.tungay_hd,'') like y || '%'
        or coalesce(b.denngay_hd,'') like y || '%'
        or coalesce(b.congbo,'') like y || '%'
        or (
          length(coalesce(b.tungay_hd,'')) >= 4
          and length(coalesce(b.denngay_hd,'')) >= 4
          and left(b.tungay_hd, 10) <= y_end
          and left(b.denngay_hd, 10) >= y_start
        )
      )
    );

  select coalesce(jsonb_agg(to_jsonb(r) - 'ord'), '[]'::jsonb)
  into v_items
  from (
    select
      (v_page * v_size) + row_number() over (order by coalesce(b.tungay_hd,'') desc, b.fingerprint) as stt,
      row_number() over (order by coalesce(b.tungay_hd,'') desc, b.fingerprint) as ord,
      b.hoatchat, b.sodk, b.ten, b.duongdung, b.hamluong, b.donvitinh,
      b.soluong, b.gia, b.thanhtien, b.nhomthau, b.nhasx, b.nuocsx,
      b.ma_tinh, b.ma_cskcb, b.tungay_hd, b.denngay_hd, b.loai_thau,
      b.congbo, b.nam, b.ten_tinh, b.ten_cskcb, b.tennhathau, b.dangbaoche, b.loai
    from public.vss_bids b
    where
      (p_q is null or p_q = '' or (
        select bool_and(b.search like '%' || w || '%')
        from unnest(string_to_array(trim(p_q), ' ')) w
        where w <> ''
      ))
      and (p_hoatchat is null or p_hoatchat = '' or coalesce(b.hoatchat,'') ilike '%' || p_hoatchat || '%')
      and (p_sodk is null or p_sodk = '' or coalesce(b.sodk,'') ilike '%' || p_sodk || '%')
      and (p_loai is null or p_loai = '' or coalesce(b.loai,'') ilike '%' || p_loai || '%')
      and (p_nhomthau is null or p_nhomthau = '' or coalesce(b.nhomthau,'') ilike '%' || p_nhomthau || '%')
      and (p_loai_thau is null or p_loai_thau = '' or coalesce(b.loai_thau,'') ilike '%' || p_loai_thau || '%')
      and (p_duongdung is null or p_duongdung = '' or coalesce(b.duongdung,'') ilike '%' || p_duongdung || '%')
      and (p_ma_tinh is null or p_ma_tinh = '' or coalesce(b.ma_tinh,'') ilike '%' || p_ma_tinh || '%')
      and (p_nuocsx is null or p_nuocsx = '' or coalesce(b.nuocsx,'') ilike '%' || p_nuocsx || '%')
      and (p_tu_ngay is null or p_tu_ngay = '' or coalesce(b.tungay_hd,'') >= p_tu_ngay)
      and (p_den_ngay is null or p_den_ngay = '' or coalesce(b.denngay_hd,'') <= (p_den_ngay || ' 23:59:59'))
      and (
        p_nam is null or (
          b.nam = p_nam
          or coalesce(b.tungay_hd,'') like y || '%'
          or coalesce(b.denngay_hd,'') like y || '%'
          or coalesce(b.congbo,'') like y || '%'
          or (
            length(coalesce(b.tungay_hd,'')) >= 4
            and length(coalesce(b.denngay_hd,'')) >= 4
            and left(b.tungay_hd, 10) <= y_end
            and left(b.denngay_hd, 10) >= y_start
          )
        )
      )
    order by coalesce(b.tungay_hd,'') desc, b.fingerprint
    offset v_page * v_size
    limit v_size
  ) r;

  return jsonb_build_object(
    'total', v_total,
    'page', v_page,
    'size', v_size,
    'items', coalesce(v_items, '[]'::jsonb)
  );
end;
$$;

grant execute on function public.search_vss_bids to anon, authenticated;

-- DAV search (text filters; tags/TT20 refined client-side on returned page)
create or replace function public.search_dav_drugs(
  p_q text default null,
  p_ten_thuoc text default null,
  p_so_dang_ky text default null,
  p_hoat_chat text default null,
  p_dang_bao_che text default null,
  p_page int default 0,
  p_size int default 100
)
returns jsonb
language plpgsql
stable
security invoker
as $$
declare
  v_page int := greatest(0, coalesce(p_page, 0));
  v_size int := least(5000, greatest(1, coalesce(p_size, 100)));
  v_total bigint;
  v_items jsonb;
begin
  select count(*) into v_total
  from public.dav_drugs d
  where
    (p_q is null or p_q = '' or (
      select bool_and(d.search like '%' || w || '%')
      from unnest(string_to_array(trim(p_q), ' ')) w where w <> ''
    ))
    and (p_ten_thuoc is null or p_ten_thuoc = '' or d.search like '%' || lower(p_ten_thuoc) || '%' or d.ten_thuoc ilike '%' || p_ten_thuoc || '%')
    and (p_so_dang_ky is null or p_so_dang_ky = '' or coalesce(d.so_dang_ky,'') ilike '%' || p_so_dang_ky || '%')
    and (p_hoat_chat is null or p_hoat_chat = '' or coalesce(d.hoat_chat,'') ilike '%' || p_hoat_chat || '%')
    and (p_dang_bao_che is null or p_dang_bao_che = '' or coalesce(d.dang_bao_che,'') ilike '%' || p_dang_bao_che || '%');

  select coalesce(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) into v_items
  from (
    select
      d.id,
      d.so_dang_ky as "soDangKy",
      d.so_dang_ky_cu as "soDangKyCu",
      d.ten_thuoc as "tenThuoc",
      d.ngay_cap as "ngayCap",
      d.ngay_gia_han as "ngayGiaHan",
      d.ngay_het_han as "ngayHetHan",
      d.hoat_chat as "hoatChat",
      d.ham_luong as "hamLuong",
      d.dang_bao_che as "dangBaoChe",
      d.dong_goi as "dongGoi",
      d.han_dung as "hanDung",
      d.cty_san_xuat as "ctySanXuat",
      d.nuoc_san_xuat as "nuocSanXuat",
      d.cty_dang_ky as "ctyDangKy",
      d.nuoc_dang_ky as "nuocDangKy",
      d.so_quyet_dinh as "soQuyetDinh",
      d.tieu_chuan as "tieuChuan",
      d.ky_cap_nam as "kyCapNam",
      d.con_hieu_luc as "conHieuLuc",
      d.ingredient_count as "ingredientCount",
      d.tag_id as "tagId"
    from public.dav_drugs d
    where
      (p_q is null or p_q = '' or (
        select bool_and(d.search like '%' || w || '%')
        from unnest(string_to_array(trim(p_q), ' ')) w where w <> ''
      ))
      and (p_ten_thuoc is null or p_ten_thuoc = '' or d.ten_thuoc ilike '%' || p_ten_thuoc || '%')
      and (p_so_dang_ky is null or p_so_dang_ky = '' or coalesce(d.so_dang_ky,'') ilike '%' || p_so_dang_ky || '%')
      and (p_hoat_chat is null or p_hoat_chat = '' or coalesce(d.hoat_chat,'') ilike '%' || p_hoat_chat || '%')
      and (p_dang_bao_che is null or p_dang_bao_che = '' or coalesce(d.dang_bao_che,'') ilike '%' || p_dang_bao_che || '%')
    order by coalesce(d.ngay_gia_han, d.ngay_cap, d.ngay_het_han, '') desc, d.id
    offset v_page * v_size
    limit v_size
  ) x;

  return jsonb_build_object(
    'total', v_total,
    'page', v_page,
    'size', v_size,
    'items', coalesce(v_items, '[]'::jsonb)
  );
end;
$$;

grant execute on function public.search_dav_drugs to anon, authenticated;

create or replace function public.search_msc(
  p_kind text default 'prices',
  p_q text default null,
  p_page int default 0,
  p_size int default 100
)
returns jsonb
language plpgsql
stable
security invoker
as $$
declare
  v_page int := greatest(0, coalesce(p_page, 0));
  v_size int := least(5000, greatest(1, coalesce(p_size, 100)));
  v_total bigint;
  v_items jsonb;
begin
  if p_kind = 'tenders' then
    select count(*) into v_total from public.msc_tenders t
    where p_q is null or p_q = '' or (
      select bool_and(t.search like '%' || w || '%')
      from unnest(string_to_array(trim(p_q), ' ')) w where w <> ''
    );
    select coalesce(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) into v_items from (
      select tender_no, name, buyer, province, published, close_date,
             status_label, status_code, bid_price, bid_form, source_url, source_id,
             collected_at as "_collected_at"
      from public.msc_tenders t
      where p_q is null or p_q = '' or (
        select bool_and(t.search like '%' || w || '%')
        from unnest(string_to_array(trim(p_q), ' ')) w where w <> ''
      )
      order by coalesce(published, collected_at, '') desc
      offset v_page * v_size limit v_size
    ) x;
  else
    select count(*) into v_total from public.msc_prices t
    where p_q is null or p_q = '' or (
      select bool_and(t.search like '%' || w || '%')
      from unnest(string_to_array(trim(p_q), ' ')) w where w <> ''
    );
    select coalesce(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) into v_items from (
      select name, ingredient, strength, registration, unit_price, quantity, unit,
             group_name, medicine_type, manufacturer, country, buyer, province,
             tender_no, published, winner, source_url, source_id,
             collected_at as "_collected_at"
      from public.msc_prices t
      where p_q is null or p_q = '' or (
        select bool_and(t.search like '%' || w || '%')
        from unnest(string_to_array(trim(p_q), ' ')) w where w <> ''
      )
      order by coalesce(published, collected_at, '') desc
      offset v_page * v_size limit v_size
    ) x;
  end if;

  return jsonb_build_object(
    'total', v_total,
    'page', v_page,
    'size', v_size,
    'items', coalesce(v_items, '[]'::jsonb)
  );
end;
$$;

grant execute on function public.search_msc to anon, authenticated;
