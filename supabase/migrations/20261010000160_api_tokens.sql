-- API tokens: how a tenant's own tools reach Propaganda from outside the app
-- (the Claude plugin, through the worker's MCP server; Ayadi, 2026-10-19).
--
-- A member mints a token in Settings > Connections > Claude. It is shown once;
-- only its SHA-256 is stored, as the ingest URL's is. Every request the token
-- makes acts for the member who made it, on that one site, within the
-- token's scopes. Revoking keeps the row for the record.
--
-- Private: no browser reads it, PostgREST doesn't expose the schema. The
-- worker reads it with its read-only pool and writes it through the two
-- functions below, which only service_role may run.
--
-- Additive only: one new private table and two functions.

create table private.api_tokens (
  id text primary key default private.new_id() check (id ~ '^[a-z0-9]{15}$'),
  site text not null references public.sites (id) on delete cascade,
  -- What the Connections page shows: "Claude on Ayadi's Mac".
  label text not null default '' check (char_length(label) <= 200),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  -- What the token may do; today 'assign' (posts straight to the Writer) and 'read' (collections).
  scopes jsonb not null default '["read", "assign"]' check (jsonb_typeof(scopes) = 'array' and octet_length(scopes::text) <= 2000),
  created_by uuid not null references auth.users (id) on delete cascade,
  last_seen timestamptz,
  revoked timestamptz,
  created timestamptz not null default private.ms_now(),
  updated timestamptz not null default private.ms_now()
);
create index api_tokens_site_idx on private.api_tokens (site);
create unique index api_tokens_hash_key on private.api_tokens (token_hash);

alter table private.api_tokens enable row level security;
-- Nobody but the worker's pool and the functions below reads it; the schema's own grants don't reach a new table by accident.
revoke all on private.api_tokens from anon, authenticated;
grant all on private.api_tokens to service_role;

/** Mint one. p: { site, label, token_hash, scopes?, created_by }. Returns the id. */
create function public.api_token_save(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare
  tid text;
begin
  insert into private.api_tokens (site, label, token_hash, scopes, created_by)
  values (p->>'site', coalesce(p->>'label', ''), p->>'token_hash',
          coalesce(p->'scopes', '["read", "assign"]'), (p->>'created_by')::uuid)
  returning id into tid;
  return tid;
end
$$;

/** Mark a token used, or revoke it (p_revoke). Only a token of p_site. */
create function public.api_token_touch(p_id text, p_site text, p_revoke boolean default false) returns void
language sql security definer set search_path = '' as $$
  update private.api_tokens
     set last_seen = case when p_revoke then last_seen else private.ms_now() end,
         revoked = case when p_revoke then coalesce(revoked, private.ms_now()) else revoked end,
         updated = private.ms_now()
   where id = p_id and site = p_site
$$;

revoke execute on function public.api_token_save(jsonb), public.api_token_touch(text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.api_token_save(jsonb), public.api_token_touch(text, text, boolean)
  to service_role;
