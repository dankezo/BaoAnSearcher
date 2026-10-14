-- Align the legacy VSS RPC with the list/metrics contract-start window.
-- Keep the existing function signature, grants and all other filters intact.
do $migration$
declare
  fn record;
  original text;
  patched text;
begin
  for fn in
    select p.oid from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'search_vss_bids'
  loop
    original := pg_get_functiondef(fn.oid);
    patched := replace(original,
      $old$coalesce(b.denngay_hd,'') <= (p_den_ngay || ' 23:59:59')$old$,
      $new$(nullif(b.tungay_hd,'') is not null and left(b.tungay_hd, 10) <= p_den_ngay)$new$);
    if patched <> original then
      execute patched;
    end if;
  end loop;
end
$migration$;
