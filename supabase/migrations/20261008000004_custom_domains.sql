-- Custom domains, self-serve (Notion PPG-57). api/domains.ts sets
-- sites.domain with the service role once the owner's CNAME and TXT records
-- are found. Caddy's catch-all site (Bedrock compose/sites/
-- propaganda-custom-domains.caddy) then asks this check before requesting a
-- certificate for the host; until now it said yes only to the app host and
-- blog subdomains.
--
-- Additive: same signature, same grants (create or replace keeps them), one
-- more accepted case. Nothing a client writes changes shape.

create or replace function public.tls_check(domain text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  d text := regexp_replace(lower(btrim(coalesce(domain, ''))), '\.$', '');
  suffix text := '.' || coalesce(nullif(current_setting('propaganda.platform_domain', true), ''), 'propaganda.pub');
  label text;
begin
  if d = 'app' || suffix then
    return 'ok';
  end if;
  if length(d) > length(suffix) and right(d, length(suffix)) = suffix then
    label := left(d, length(d) - length(suffix));
    if position('.' in label) = 0 and exists (select 1 from public.sites s where s.slug = label) then
      return 'ok';
    end if;
  end if;
  -- A site's connected custom domain (set by api/domains.ts after its DNS
  -- checks). Never on the platform domain itself.
  if d <> '' and right(d, length(suffix)) <> suffix
     and exists (select 1 from public.sites s where s.domain = d) then
    return 'ok';
  end if;
  raise exception 'unknown host' using errcode = 'PT404';
end
$$;
