-- DRAFT: moves to supabase/migrations only on Ayadi's own go (repo rule). Not applied anywhere.
--
-- A tenant's own Anthropic key (BYOK) and which credential each tenant runs on.
-- Additive only: two new tables, two new columns with defaults, one new
-- function, and new versions of two cost functions that return the same keys
-- plus one. Needs the cost log (20261007000002) first.
--
-- The key itself is never readable from a browser: model_keys is service-role
-- only, and holds AES-256-GCM ciphertext sealed by the API and the worker
-- (api/_ai/modelKeys.ts, MODEL_KEY_SECRET), bound to the site. Members see the
-- last four characters and the last test's result through /api/model-key.

-- ---- the keys ----

create table public.model_keys (
  id text primary key default private.new_id() check (id ~ '^[a-z0-9]{15}$'),
  site text not null references public.sites (id) on delete cascade,
  provider text not null default 'anthropic' check (provider in ('anthropic')),
  -- 'v1:<iv>:<tag>:<ciphertext>', base64 parts.
  secret text not null check (secret ~ '^v1:' and char_length(secret) <= 2000),
  last4 text not null check (char_length(last4) = 4),
  -- The last test or real call: ok, or failed with Anthropic's answer.
  status text not null default 'ok' check (status in ('ok', 'failed')),
  error text not null default '' check (char_length(error) <= 500),
  checked timestamptz not null default private.ms_now(),
  created timestamptz not null default private.ms_now(),
  updated timestamptz not null default private.ms_now(),
  unique (site, provider)
);
create trigger stamp before insert or update on public.model_keys
  for each row execute function private.stamp_created_updated();
alter table public.model_keys enable row level security;
-- No policies: anon and authenticated can't see a row, not even its own site's.
revoke all on public.model_keys from anon, authenticated;
grant all on public.model_keys to service_role;

-- ---- which credential each tenant runs on ----

-- One row pins a tenant to one Anthropic credential, with no fallback to any
-- other (api/_ai/modelKeys.ts): 'default' (Propaganda's own), 'own' (the
-- tenant's saved key) or 'pool:<name>' (ANTHROPIC_KEY_<NAME> on the server,
-- such as a separate Console account kept for one customer). No row: the
-- tenant's saved key when it has one, else the default. Only a superadmin
-- sets it; the gateway reads it with the service role.
create table public.model_credentials (
  site text primary key references public.sites (id) on delete cascade,
  credential text not null check (credential in ('default', 'own') or credential ~ '^pool:[a-z0-9_]{1,40}$'),
  created timestamptz not null default private.ms_now(),
  updated timestamptz not null default private.ms_now()
);
create trigger stamp before insert or update on public.model_credentials
  for each row execute function private.stamp_created_updated();
alter table public.model_credentials enable row level security;
revoke all on public.model_credentials from anon, authenticated;
grant all on public.model_credentials to service_role;

-- Superadmin: pin a tenant (null removes the pin).
create function public.model_credential_set(p_site text, p_credential text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_superadmin();
  if p_credential is null then
    delete from public.model_credentials where site = p_site;
  else
    insert into public.model_credentials (site, credential) values (p_site, p_credential)
    on conflict (site) do update set credential = excluded.credential;
  end if;
end $$;
revoke all on function public.model_credential_set(text, text) from public, anon;
grant execute on function public.model_credential_set(text, text) to authenticated;

-- ---- the cost log: who paid ----

-- 'tenant' when the call ran on the tenant's own key. Existing rows are ours.
alter table public.model_calls
  add column paid_by text not null default 'propaganda' check (paid_by in ('propaganda', 'tenant'));
-- Which of our keys paid, when it wasn't the default ('pool:axoniq', ...).
alter table public.model_calls
  add column credential text not null default 'default'
    check (credential in ('default', 'own') or credential ~ '^pool:[a-z0-9_]{1,40}$');

-- Our budget rules count only what we pay for. Same keys as before.
create or replace function public.cost_gate(p_site text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'tenant_month_usd', coalesce((select sum(cost_usd) from public.model_calls
       where site = p_site and paid_by = 'propaganda' and created >= date_trunc('month', now())), 0),
    'tenant_monthly_limit', (select monthly_usd from public.cost_limits where scope = p_site),
    'tenant_warn_ratio', coalesce((select warn_ratio from public.cost_limits where scope = p_site), 0.80),
    'global_day_usd', coalesce((select sum(cost_usd) from public.model_calls
       where paid_by = 'propaganda' and created >= date_trunc('day', now())), 0),
    'global_daily_limit', (select daily_usd from public.cost_limits where scope = 'global'),
    'killed', (select engaged from public.cost_kill)
  )
$$;

-- The Home meter: spent_usd is what counts against the budget (ours);
-- own_key_usd is the month's spend on the tenant's own key, at API prices.
create or replace function public.cost_my_month(p_site text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (p_site in (select private.my_sites()) or public.is_superadmin()) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'spent_usd', coalesce((select sum(cost_usd) from public.model_calls
       where site = p_site and paid_by = 'propaganda' and created >= date_trunc('month', now())), 0),
    'own_key_usd', coalesce((select sum(cost_usd) from public.model_calls
       where site = p_site and paid_by = 'tenant' and created >= date_trunc('month', now())), 0),
    'calls', (select count(*) from public.model_calls
       where site = p_site and created >= date_trunc('month', now())),
    'monthly_limit', (select monthly_usd from public.cost_limits where scope = p_site),
    'warn_ratio', coalesce((select warn_ratio from public.cost_limits where scope = p_site), 0.80),
    'killed', (select engaged from public.cost_kill)
  );
end $$;
