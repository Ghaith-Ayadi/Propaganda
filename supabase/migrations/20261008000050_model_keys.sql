-- Ayadi gave his go on 2026-10-08 ("4-8 YES", item 4: the BYOK key storage).
--
-- A tenant's own Anthropic key (BYOK). Which tenants run on Ayadi's own
-- accounts instead is hardcoded in api/_ai/modelKeys.ts, not stored here.
-- Additive only: one new table, two new columns with defaults, and new
-- versions of two cost functions that return the same keys plus one. Needs the
-- cost log (20261007000002) first.
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

-- ---- the cost log: who paid ----

-- 'tenant' when the call ran on the tenant's own key. Existing rows are ours.
alter table public.model_calls
  add column paid_by text not null default 'propaganda' check (paid_by in ('propaganda', 'tenant'));
-- Which account the call ran on: Ayadi's private one (every row so far), the
-- Ayadi-Axoniq one, or the tenant's own key.
alter table public.model_calls
  add column credential text not null default 'private' check (credential in ('private', 'axoniq', 'own'));

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
