alter table public.regulatory_documents
  add column content text not null default '';

create or replace function public.regulatory_ingest(p_row jsonb) returns void
language plpgsql security invoker set search_path='' as $$
begin
 insert into public.regulatory_documents(id,title,code,category,summary,content,source_id,source_url,pdf_url,issued_at,published_at,legal_status,review_note,fetched_at,content_hash,search_text,origin,updated_at)
 values(p_row->>'id',p_row->>'title',coalesce(p_row->>'code',''),p_row->>'category',p_row->>'summary',coalesce(p_row->>'content',''),p_row->>'source_id',p_row->>'source_url',coalesce(p_row->>'pdf_url',''),nullif(p_row->>'issued_at','')::date,nullif(p_row->>'published_at','')::date,
 case when p_row->>'legal_status'='draft' then 'draft' else 'unknown' end,'Thu thập tự động; chưa được chuyên viên đối chiếu hiệu lực.',now(),p_row->>'content_hash',p_row->>'search_text','crawl',now())
 on conflict(source_url) do update set title=excluded.title,code=excluded.code,category=excluded.category,summary=excluded.summary,content=excluded.content,pdf_url=excluded.pdf_url,issued_at=excluded.issued_at,published_at=excluded.published_at,fetched_at=now(),content_hash=excluded.content_hash,search_text=excluded.search_text,updated_at=now(),version=public.regulatory_documents.version+1
 where public.regulatory_documents.origin='crawl';
end; $$;

create table public.regulatory_news_analyses (
 document_id text primary key references public.regulatory_documents(id) on delete cascade,
 input_hash text not null default '',
 model text not null default '',
 prompt_version text not null default '',
 result jsonb,
 analyzed_at timestamptz,
 lease_token uuid,
 lease_until timestamptz
);
alter table public.regulatory_news_analyses enable row level security;
revoke all on public.regulatory_news_analyses from public,anon,authenticated;
grant select on public.regulatory_news_analyses to authenticated;
grant all on public.regulatory_news_analyses to service_role;
create policy regulatory_news_analyses_read on public.regulatory_news_analyses
 for select to authenticated using ((select public.regulatory_staff()));

create function public.claim_news_analysis(p_document_id text,p_token uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare claimed integer;
begin
 insert into public.regulatory_news_analyses(document_id,lease_token,lease_until)
 values(p_document_id,p_token,now()+interval '65 seconds')
 on conflict(document_id) do update
   set lease_token=excluded.lease_token,lease_until=excluded.lease_until
   where public.regulatory_news_analyses.lease_until is null
      or public.regulatory_news_analyses.lease_until<now();
 get diagnostics claimed=row_count;
 return claimed>0;
end; $$;
revoke all on function public.claim_news_analysis(text,uuid) from public,anon,authenticated;
grant execute on function public.claim_news_analysis(text,uuid) to service_role;
