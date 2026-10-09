-- Refresh only unreviewed draft/unknown status during a recrawl.
-- Human-reviewed legal states and manual/seed documents remain protected.
create or replace function public.regulatory_ingest(p_row jsonb) returns void
language plpgsql security invoker set search_path='' as $$
begin
 insert into public.regulatory_documents(id,title,code,category,summary,content,source_id,source_url,pdf_url,issued_at,published_at,legal_status,review_note,fetched_at,content_hash,search_text,origin,updated_at)
 values(p_row->>'id',p_row->>'title',coalesce(p_row->>'code',''),p_row->>'category',p_row->>'summary',coalesce(p_row->>'content',''),p_row->>'source_id',p_row->>'source_url',coalesce(p_row->>'pdf_url',''),nullif(p_row->>'issued_at','')::date,nullif(p_row->>'published_at','')::date,
 case when p_row->>'legal_status'='draft' then 'draft' else 'unknown' end,'Thu thập tự động; chưa được chuyên viên đối chiếu hiệu lực.',now(),p_row->>'content_hash',p_row->>'search_text','crawl',now())
 on conflict(source_url) do update set title=excluded.title,code=excluded.code,category=excluded.category,summary=excluded.summary,content=excluded.content,pdf_url=excluded.pdf_url,issued_at=excluded.issued_at,published_at=excluded.published_at,
 legal_status=case when public.regulatory_documents.reviewed_at is null and public.regulatory_documents.legal_status in ('unknown','draft') then excluded.legal_status else public.regulatory_documents.legal_status end,
 fetched_at=now(),content_hash=excluded.content_hash,search_text=excluded.search_text,updated_at=now(),version=public.regulatory_documents.version+1
 where public.regulatory_documents.origin='crawl';
end; $$;
