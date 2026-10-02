create table public.regulatory_insights (
 document_id text primary key references public.regulatory_documents(id) on delete cascade,
 input_hash text not null, priority integer not null check(priority between 0 and 100),
 reason text not null, impact text not null, action text not null, evidence_quote text not null default '',
 method text not null check(method in ('rules','ai')), model text not null default '', generated_at timestamptz not null default now()
);
create table public.regulatory_ai_runs (
 day date primary key, state text not null default 'reserved', model text not null default 'gemini-3.1-flash-lite',
 reserved_usd numeric(8,5) not null default 0.025 check(reserved_usd=0.025),
 input_tokens integer, output_tokens integer, prompt_version text, message text not null default '',
 started_at timestamptz not null default now(), finished_at timestamptz
);
alter table public.regulatory_insights enable row level security;
alter table public.regulatory_ai_runs enable row level security;
revoke all on public.regulatory_insights,public.regulatory_ai_runs from anon,authenticated;
grant select on public.regulatory_insights,public.regulatory_ai_runs to authenticated;
grant all on public.regulatory_insights,public.regulatory_ai_runs to service_role;
create policy regulatory_insights_read on public.regulatory_insights for select to authenticated using ((select public.regulatory_staff()));
create policy regulatory_ai_runs_read on public.regulatory_ai_runs for select to authenticated using ((select public.regulatory_staff()));
create function public.regulatory_ai_reserve() returns text language plpgsql security invoker set search_path='' as $$
declare today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; claimed date;
begin
 perform pg_advisory_xact_lock(62829431);
 if (select coalesce(sum(reserved_usd),0) from public.regulatory_ai_runs where day>=date_trunc('month',today)::date) + 0.025 > 0.90 then return null; end if;
 insert into public.regulatory_ai_runs(day) values(today) on conflict(day) do nothing returning day into claimed;
 return claimed::text;
end; $$;
revoke all on function public.regulatory_ai_reserve() from public,anon,authenticated;
grant execute on function public.regulatory_ai_reserve() to service_role;
