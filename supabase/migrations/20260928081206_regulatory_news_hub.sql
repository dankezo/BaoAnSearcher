-- Regulatory Hub is separate from the large DAV/MSC/VSS data stores.
create table public.regulatory_sources (
 id text primary key, name text not null check(length(name) between 1 and 200),
 url text not null unique check(url ~ '^https://(www\.)?(moh\.gov\.vn|dav\.gov\.vn|thuvienphapluat\.vn)(/|$)'),
 kind text not null default 'html' check(kind in ('html','rss')), official boolean not null default false,
 enabled boolean not null default true, interval_hours integer not null default 24 check(interval_hours between 6 and 168),
 keywords text not null default '', last_attempt timestamptz, last_success timestamptz, last_error text,
 lease_until timestamptz, version integer not null default 1
);
create table public.regulatory_documents (
 id text primary key, title text not null check(length(title) between 1 and 600), code text not null default '',
 category text not null default 'Khác' check(category in ('BE','BHYT','Đấu thầu','Khác')),
 summary text not null default '', source_id text references public.regulatory_sources(id),
 source_url text not null unique check(source_url ~ '^https://'), pdf_url text not null default '' check(pdf_url='' or pdf_url ~ '^https://'),
 issued_at date, published_at date, effective_at date, expires_at date,
 legal_status text not null default 'unknown' check(legal_status in ('unknown','active','expired','replaced','draft','partial')),
 reviewed_at date, review_source text not null default '', review_note text not null default '',
 fetched_at timestamptz, content_hash text not null default '', search_text text not null,
 origin text not null default 'crawl' check(origin in ('crawl','manual','seed')),
 version integer not null default 1, updated_at timestamptz not null default now(),
 check(legal_status in ('unknown','draft') or (reviewed_at is not null and review_source ~ '^https://' and length(review_note)>0))
);
create index regulatory_document_date on public.regulatory_documents(published_at desc,issued_at desc);
create index regulatory_document_source on public.regulatory_documents(source_id);
create index regulatory_document_category on public.regulatory_documents(category,legal_status);
create table public.regulatory_reads (
 user_id uuid not null references auth.users(id) on delete cascade,
 document_id text not null references public.regulatory_documents(id) on delete cascade,
 read_at timestamptz not null default now(), primary key(user_id,document_id)
);
create index regulatory_reads_document on public.regulatory_reads(document_id);
create table public.regulatory_relations (
 document_id text not null references public.regulatory_documents(id), related_id text not null references public.regulatory_documents(id),
 relation text not null default 'related', reason text not null, primary key(document_id,related_id)
);
create index regulatory_related_id on public.regulatory_relations(related_id);
create table public.regulatory_runs (
 id text primary key, source_id text not null references public.regulatory_sources(id), started_at timestamptz not null,
 finished_at timestamptz, state text not null, item_count integer not null default 0, message text not null default ''
);
create index regulatory_runs_source on public.regulatory_runs(source_id,started_at desc);
create table public.regulatory_audit (
 id uuid primary key default gen_random_uuid(), actor uuid, entity text not null, entity_id text not null,
 before_json jsonb, after_json jsonb not null, created_at timestamptz not null default now()
);
create table public.regulatory_http_cache (
 url text primary key, body text not null, etag text, modified text, checked_at timestamptz not null
);
create or replace function public.regulatory_staff() returns boolean language sql stable security invoker set search_path='' as $$
 select auth.uid() is not null and lower(auth.jwt()->>'email') in ('sales@baoanpharma.com','importer@baoanpharma.com','admin@baoanpharma.com','sonnguyen@baoanpharma.com','tuanvu@baoanpharma.com');
$$;
create or replace function public.regulatory_admin() returns boolean language sql stable security invoker set search_path='' as $$
 select auth.uid() is not null and lower(auth.jwt()->>'email')='admin@baoanpharma.com';
$$;
revoke all on function public.regulatory_staff(),public.regulatory_admin() from public,anon;
grant execute on function public.regulatory_staff(),public.regulatory_admin() to authenticated;

alter table public.regulatory_sources enable row level security;
alter table public.regulatory_documents enable row level security;
alter table public.regulatory_reads enable row level security;
alter table public.regulatory_relations enable row level security;
alter table public.regulatory_runs enable row level security;
alter table public.regulatory_audit enable row level security;
alter table public.regulatory_http_cache enable row level security;
revoke all on public.regulatory_sources, public.regulatory_documents, public.regulatory_reads, public.regulatory_relations, public.regulatory_runs, public.regulatory_audit, public.regulatory_http_cache from anon,authenticated;
grant select on public.regulatory_sources,public.regulatory_documents,public.regulatory_relations,public.regulatory_runs to authenticated;
grant insert,update on public.regulatory_sources,public.regulatory_documents to authenticated;
grant select,insert,update,delete on public.regulatory_reads to authenticated;
grant select on public.regulatory_audit to authenticated;
grant all on public.regulatory_sources,public.regulatory_documents,public.regulatory_reads,public.regulatory_relations,public.regulatory_runs,public.regulatory_audit,public.regulatory_http_cache to service_role;
create policy regulatory_sources_read on public.regulatory_sources for select to authenticated using ((select public.regulatory_staff()));
create policy regulatory_sources_add on public.regulatory_sources for insert to authenticated with check ((select public.regulatory_admin()));
create policy regulatory_sources_edit on public.regulatory_sources for update to authenticated using ((select public.regulatory_admin())) with check ((select public.regulatory_admin()));
create policy regulatory_documents_read on public.regulatory_documents for select to authenticated using ((select public.regulatory_staff()));
create policy regulatory_documents_add on public.regulatory_documents for insert to authenticated with check ((select public.regulatory_admin()));
create policy regulatory_documents_edit on public.regulatory_documents for update to authenticated using ((select public.regulatory_admin())) with check ((select public.regulatory_admin()));
create policy regulatory_relations_read on public.regulatory_relations for select to authenticated using ((select public.regulatory_staff()));
create policy regulatory_runs_read on public.regulatory_runs for select to authenticated using ((select public.regulatory_staff()));
create policy regulatory_audit_read on public.regulatory_audit for select to authenticated using ((select public.regulatory_admin()));
create policy regulatory_reads_own on public.regulatory_reads for all to authenticated using ((select public.regulatory_staff()) and user_id=(select auth.uid())) with check ((select public.regulatory_staff()) and user_id=(select auth.uid()));

create schema if not exists regulatory_private;
revoke all on schema regulatory_private from public,anon,authenticated;
create or replace function regulatory_private.audit_changes() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is not null then
   insert into public.regulatory_audit(actor,entity,entity_id,before_json,after_json)
   values(auth.uid(),TG_TABLE_NAME,new.id,case when TG_OP='UPDATE' then to_jsonb(old) else null end,to_jsonb(new));
 end if;
 return new;
end; $$;
revoke all on function regulatory_private.audit_changes() from public,anon,authenticated;
create trigger regulatory_documents_audit after insert or update on public.regulatory_documents for each row execute function regulatory_private.audit_changes();
create trigger regulatory_sources_audit after insert or update on public.regulatory_sources for each row execute function regulatory_private.audit_changes();

-- Invoker functions: callable only by service_role; never accept arbitrary SQL.
create function public.regulatory_claim(p_id text,p_force boolean default false) returns boolean language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 update public.regulatory_sources set lease_until=now()+interval '15 minutes',last_attempt=now()
 where id=p_id and enabled and (lease_until is null or lease_until<now())
 and (p_force or last_attempt is null or last_attempt<now()-make_interval(hours=>interval_hours));
 get diagnostics n=row_count;
 return n>0;
end; $$;
create function public.regulatory_ingest(p_row jsonb) returns void language plpgsql security invoker set search_path='' as $$
begin
 insert into public.regulatory_documents(id,title,code,category,summary,source_id,source_url,pdf_url,issued_at,published_at,legal_status,review_note,fetched_at,content_hash,search_text,origin,updated_at)
 values(p_row->>'id',p_row->>'title',coalesce(p_row->>'code',''),p_row->>'category',p_row->>'summary',p_row->>'source_id',p_row->>'source_url',coalesce(p_row->>'pdf_url',''),nullif(p_row->>'issued_at','')::date,nullif(p_row->>'published_at','')::date,
 case when p_row->>'legal_status'='draft' then 'draft' else 'unknown' end,'Thu thập tự động; chưa được chuyên viên đối chiếu hiệu lực.',now(),p_row->>'content_hash',p_row->>'search_text','crawl',now())
 on conflict(source_url) do update set title=excluded.title,code=excluded.code,category=excluded.category,summary=excluded.summary,pdf_url=excluded.pdf_url,issued_at=excluded.issued_at,published_at=excluded.published_at,fetched_at=now(),content_hash=excluded.content_hash,search_text=excluded.search_text,updated_at=now(),version=public.regulatory_documents.version+1
 where public.regulatory_documents.origin='crawl';
end; $$;
revoke all on function public.regulatory_claim(text,boolean),public.regulatory_ingest(jsonb) from public,anon,authenticated;
grant execute on function public.regulatory_claim(text,boolean),public.regulatory_ingest(jsonb) to service_role;

-- Search with invoker RLS, parameterized keywords and personal read state.
create function public.regulatory_search(p_words text[] default '{}',p_category text default '',p_status text default '',p_news boolean default false,p_unread boolean default false,p_page integer default 0)
returns jsonb language sql stable security invoker set search_path='' as $$
 with matched as (
 select d.*,s.name as source_name,s.official,r.read_at
 from public.regulatory_documents d left join public.regulatory_sources s on s.id=d.source_id
 left join public.regulatory_reads r on r.document_id=d.id and r.user_id=(select auth.uid())
 where (not p_news or d.origin='crawl') and (not p_unread or r.read_at is null)
 and (p_category='' or d.category=p_category) and (p_status='' or d.legal_status=p_status)
 and not exists(select 1 from unnest(p_words) w where position(w in d.search_text)=0)
 ), paged as (select * from matched order by coalesce(published_at,issued_at) desc nulls last,updated_at desc,id limit 20 offset greatest(0,least(p_page,10000))*20)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p)) from paged p),'[]'::jsonb),'total',(select count(*) from matched),'size',20,'page',greatest(0,least(p_page,10000)));
$$;
revoke all on function public.regulatory_search(text[],text,text,boolean,boolean,integer) from public,anon;
grant execute on function public.regulatory_search(text[],text,text,boolean,boolean,integer) to authenticated,service_role;
