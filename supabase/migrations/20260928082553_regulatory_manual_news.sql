-- Keep reviewed crawl items in the feed; manual news uses an explicit publication date.
create or replace function public.regulatory_search(p_words text[] default '{}',p_category text default '',p_status text default '',p_news boolean default false,p_unread boolean default false,p_page integer default 0)
returns jsonb language sql stable security invoker set search_path='' as $$
 with matched as (
 select d.*,s.name as source_name,s.official,r.read_at
 from public.regulatory_documents d left join public.regulatory_sources s on s.id=d.source_id
 left join public.regulatory_reads r on r.document_id=d.id and r.user_id=(select auth.uid())
 where (not p_news or (d.origin='crawl' or d.source_id is not null or d.published_at is not null)) and (not p_unread or r.read_at is null)
 and (p_category='' or d.category=p_category) and (p_status='' or d.legal_status=p_status)
 and not exists(select 1 from unnest(p_words) w where position(w in d.search_text)=0)
 ), paged as (select * from matched order by coalesce(published_at,issued_at) desc nulls last,updated_at desc,id limit 20 offset greatest(0,least(p_page,10000))*20)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p)) from paged p),'[]'::jsonb),'total',(select count(*) from matched),'size',20,'page',greatest(0,least(p_page,10000)));
$$;
revoke all on function public.regulatory_search(text[],text,text,boolean,boolean,integer) from public,anon;
grant execute on function public.regulatory_search(text[],text,text,boolean,boolean,integer) to authenticated,service_role;
