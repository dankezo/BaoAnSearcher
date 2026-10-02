alter table public.regulatory_sources drop constraint regulatory_sources_url_check;
alter table public.regulatory_sources add constraint regulatory_sources_url_check check (url ~ '^https://(www\.)?(moh\.gov\.vn|dav\.gov\.vn|thuvienphapluat\.vn|baochinhphu\.vn)(/|$)');
