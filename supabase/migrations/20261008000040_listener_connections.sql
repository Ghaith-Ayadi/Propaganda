-- The Listener's connections (Propaganda 0.2): where a tenant's calls and
-- Slack threads come from. One row per connected source: the ingest URL,
-- Granola, Slack, Zoom, Teams, Google Meet.
--
-- Additive only: a new private table and two functions. Nothing a client
-- syncs is touched. Private: no browser reads it, PostgREST doesn't expose
-- the schema. The worker reads it with its read-only pool and writes it
-- through the two functions below, which only service_role may run.
--
-- `secret` is ciphertext (AES-256-GCM, sealed by the worker under its own
-- key, worker/src/listener/connections.ts): API keys, OAuth tokens, webhook
-- signing secrets. The ingest URL's token is never stored, only its hash.

create table private.listener_connections (
  id text primary key default private.new_id() check (id ~ '^[a-z0-9]{15}$'),
  site text not null references public.sites (id) on delete cascade,
  provider text not null check (provider in ('url', 'granola', 'slack', 'zoom', 'teams', 'meet')),
  -- The other side's id: Slack team, Zoom account, Microsoft tenant, Google user, Granola webhook.
  external_id text not null default '' check (char_length(external_id) <= 200),
  -- What the Connections page shows: "Granola (ayadi@kontra.run)", "Slack: Kontra".
  label text not null default '' check (char_length(label) <= 200),
  token_hash text not null default '' check (token_hash = '' or token_hash ~ '^[0-9a-f]{64}$'),
  secret text not null default '' check (char_length(secret) <= 20000),
  -- Not secret: cursors, subscription ids and expiry, chosen channels.
  config jsonb not null default '{}' check (jsonb_typeof(config) = 'object' and octet_length(config::text) <= 20000),
  status text not null default 'active' check (status in ('active', 'paused', 'error', 'revoked')),
  last_error text not null default '' check (char_length(last_error) <= 1000),
  last_seen timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created timestamptz not null default private.ms_now(),
  updated timestamptz not null default private.ms_now()
);
create index listener_connections_site_idx on private.listener_connections (site);
-- One Slack workspace (Zoom account, ...) feeds one tenant at a time.
create unique index listener_connections_external_key on private.listener_connections (provider, external_id)
  where external_id <> '' and status <> 'revoked';
create unique index listener_connections_token_key on private.listener_connections (token_hash)
  where token_hash <> '';

alter table private.listener_connections enable row level security;

/**
 * Insert or update a connection from a JSON object. Keys left out keep their
 * value; `seen: true` stamps last_seen. Returns the id.
 */
create function public.listener_connection_save(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare
  cid text := nullif(p->>'id', '');
begin
  if cid is not null and exists (select 1 from private.listener_connections where id = cid) then
    update private.listener_connections c set
      external_id = coalesce(p->>'external_id', c.external_id),
      label = coalesce(p->>'label', c.label),
      token_hash = coalesce(p->>'token_hash', c.token_hash),
      secret = coalesce(p->>'secret', c.secret),
      config = coalesce(p->'config', c.config),
      status = coalesce(p->>'status', c.status),
      last_error = coalesce(p->>'last_error', c.last_error),
      last_seen = case when (p->>'seen')::boolean then private.ms_now() else c.last_seen end,
      updated = private.ms_now()
    where c.id = cid and c.site = p->>'site';
    if not found then
      raise exception 'Connection % is not in site %.', cid, p->>'site' using errcode = '42501';
    end if;
    return cid;
  end if;
  insert into private.listener_connections
    (id, site, provider, external_id, label, token_hash, secret, config, status, created_by)
  values (
    coalesce(cid, private.new_id()), p->>'site', p->>'provider',
    coalesce(p->>'external_id', ''), coalesce(p->>'label', ''), coalesce(p->>'token_hash', ''),
    coalesce(p->>'secret', ''), coalesce(p->'config', '{}'), coalesce(p->>'status', 'active'),
    nullif(p->>'created_by', '')::uuid)
  returning id into cid;
  return cid;
end
$$;

/** Disconnect: the secret is wiped, the row stays for the record. */
create function public.listener_connection_revoke(p_id text) returns void
language sql security definer set search_path = '' as $$
  update private.listener_connections
     set status = 'revoked', secret = '', token_hash = '', updated = private.ms_now()
   where id = p_id
$$;

revoke execute on function public.listener_connection_save(jsonb), public.listener_connection_revoke(text)
  from public, anon, authenticated;
grant execute on function public.listener_connection_save(jsonb), public.listener_connection_revoke(text)
  to service_role;
