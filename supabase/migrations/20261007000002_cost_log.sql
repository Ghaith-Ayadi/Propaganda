-- The cost log (Propaganda 0.2). Additive only: new tables and functions,
-- nothing existing is renamed, dropped or rewritten. Ayadi approved it
-- (2026-10-08). Needs the superadmin migration (20261007000001) first.
--
-- Every model call writes one row to model_calls (api/_ai/gateway.ts, the only
-- code that may reach a model). Cost is priced at API prices even while the
-- app runs on a subscription, from model_prices (data, not constants). Limits
-- default to off: no cost_limits row, or null columns, means no limit.
--
-- Writes: service_role only. Members read their own site's calls and usage.
-- Everything cross-tenant goes through public.is_superadmin().

-- Needs the superadmin flag (admin-superadmin/20261007000001_superadmin.sql):
-- public.is_superadmin() and private.require_superadmin(). Apply that one first.

-- ---- prices ----

-- USD per million tokens. A price change is a new row (effective_from). A call
-- stores only its computed cost_usd, so editing a price row never changes what
-- a past call reads as.
create table public.model_prices (
  id text primary key default private.new_id() check (id ~ '^[a-z0-9]{15}$'),
  model text not null check (char_length(model) between 1 and 200),
  input_per_mtok numeric(12,4) not null check (input_per_mtok >= 0),
  output_per_mtok numeric(12,4) not null check (output_per_mtok >= 0),
  cache_read_per_mtok numeric(12,4) not null default 0 check (cache_read_per_mtok >= 0),
  cache_write_per_mtok numeric(12,4) not null default 0 check (cache_write_per_mtok >= 0),
  effective_from timestamptz not null default private.ms_now(),
  unique (model, effective_from)
);
alter table public.model_prices enable row level security;
revoke all on public.model_prices from anon, authenticated;
grant all on public.model_prices to service_role;
grant select on public.model_prices to authenticated;
create policy "signed-in read prices" on public.model_prices for select to authenticated using (true);

-- ---- the log ----

create table public.model_calls (
  id text primary key default private.new_id() check (id ~ '^[a-z0-9]{15}$'),
  site text not null references public.sites (id) on delete cascade,
  -- What asked: 'extract-quotes', later 'writer', 'scout', ...
  job text not null check (char_length(job) between 1 and 80),
  -- The DBOS workflow and step the call ran in (the gateway fills both from
  -- DBOS's context); null outside a workflow, such as the editor. The Runs page
  -- sums cost by workflow_id and shows per-step cost by (workflow_id, step_id).
  workflow_id text check (workflow_id is null or char_length(workflow_id) <= 200),
  step_id integer,
  model text not null check (char_length(model) between 1 and 200),
  -- Background work stops at the tenant's budget; the editor keeps working.
  background boolean not null default false,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cache_read_tokens integer not null default 0 check (cache_read_tokens >= 0),
  cache_write_tokens integer not null default 0 check (cache_write_tokens >= 0),
  -- API-price cost in USD, computed when the call finished. 0 with priced =
  -- false when the model had no price row: the call is kept, the gap is visible.
  cost_usd numeric(12,6) not null default 0 check (cost_usd >= 0),
  priced boolean not null default true,
  status text not null default 'ok' check (status in ('ok', 'error')),
  created timestamptz not null default private.ms_now()
);
create index model_calls_site_created on public.model_calls (site, created desc);
create index model_calls_workflow on public.model_calls (workflow_id, step_id) where workflow_id is not null;
create index model_calls_created on public.model_calls (created desc);
alter table public.model_calls enable row level security;
revoke all on public.model_calls from anon, authenticated;
grant all on public.model_calls to service_role;
grant select on public.model_calls to authenticated;
create policy "members read" on public.model_calls for select to authenticated
  using (site in (select private.my_sites()) or public.is_superadmin());

-- ---- limits ----

-- scope is a site id, or 'global'. Null = off. warn_ratio is the share of the
-- monthly budget that triggers the warning.
create table public.cost_limits (
  scope text primary key check (scope = 'global' or scope ~ '^[a-z0-9]{15}$'),
  monthly_usd numeric(12,2) check (monthly_usd is null or monthly_usd > 0),
  daily_usd numeric(12,2) check (daily_usd is null or daily_usd > 0),
  warn_ratio numeric(3,2) not null default 0.80 check (warn_ratio > 0 and warn_ratio <= 1),
  updated timestamptz not null default private.ms_now()
);
alter table public.cost_limits enable row level security;
revoke all on public.cost_limits from anon, authenticated;
grant all on public.cost_limits to service_role;
grant select on public.cost_limits to authenticated;
create policy "members read their own, superadmin all" on public.cost_limits for select to authenticated
  using (scope in (select private.my_sites()) or public.is_superadmin());

-- The kill switch: one row. Engaged by the gateway when the global daily cap is
-- hit; lifted only by a superadmin (cost_lift_kill).
create table public.cost_kill (
  id boolean primary key default true check (id),
  engaged boolean not null default false,
  reason text not null default '',
  changed timestamptz not null default private.ms_now()
);
insert into public.cost_kill default values;
alter table public.cost_kill enable row level security;
revoke all on public.cost_kill from anon, authenticated;
grant all on public.cost_kill to service_role;
grant select on public.cost_kill to authenticated;
create policy "signed-in read" on public.cost_kill for select to authenticated using (true);

-- ---- functions ----

-- The gateway's one read before a call (service_role): spend and limits.
create function public.cost_gate(p_site text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'tenant_month_usd', coalesce((select sum(cost_usd) from public.model_calls
       where site = p_site and created >= date_trunc('month', now())), 0),
    'tenant_monthly_limit', (select monthly_usd from public.cost_limits where scope = p_site),
    'tenant_warn_ratio', coalesce((select warn_ratio from public.cost_limits where scope = p_site), 0.80),
    'global_day_usd', coalesce((select sum(cost_usd) from public.model_calls
       where created >= date_trunc('day', now())), 0),
    'global_daily_limit', (select daily_usd from public.cost_limits where scope = 'global'),
    'killed', (select engaged from public.cost_kill)
  )
$$;
revoke all on function public.cost_gate(text) from public, anon, authenticated;
grant execute on function public.cost_gate(text) to service_role;

create function public.cost_engage_kill(p_reason text) returns void
language sql security definer set search_path = '' as $$
  update public.cost_kill set engaged = true, reason = left(p_reason, 200), changed = private.ms_now()
$$;
revoke all on function public.cost_engage_kill(text) from public, anon, authenticated;
grant execute on function public.cost_engage_kill(text) to service_role;

-- Only a superadmin can lift it.
create function public.cost_lift_kill() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_superadmin();
  update public.cost_kill set engaged = false, reason = '', changed = private.ms_now();
end $$;
revoke all on function public.cost_lift_kill() from public, anon;
grant execute on function public.cost_lift_kill() to authenticated;

-- A tenant's own month: what the Home meter shows. Members only.
create function public.cost_my_month(p_site text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (p_site in (select private.my_sites()) or public.is_superadmin()) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'spent_usd', coalesce((select sum(cost_usd) from public.model_calls
       where site = p_site and created >= date_trunc('month', now())), 0),
    'calls', (select count(*) from public.model_calls
       where site = p_site and created >= date_trunc('month', now())),
    'monthly_limit', (select monthly_usd from public.cost_limits where scope = p_site),
    'warn_ratio', coalesce((select warn_ratio from public.cost_limits where scope = p_site), 0.80),
    'killed', (select engaged from public.cost_kill)
  );
end $$;
revoke all on function public.cost_my_month(text) from public, anon;
grant execute on function public.cost_my_month(text) to authenticated;

-- Superadmin: every tenant, by job and model, between two instants.
create function public.cost_admin_summary(p_from timestamptz, p_to timestamptz)
returns table (site text, site_name text, job text, model text, calls bigint,
               input_tokens bigint, output_tokens bigint, cost_usd numeric, unpriced bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_superadmin();
  return query
    select c.site, s.name, c.job, c.model, count(*),
           sum(c.input_tokens)::bigint, sum(c.output_tokens)::bigint, sum(c.cost_usd),
           count(*) filter (where not c.priced)
    from public.model_calls c join public.sites s on s.id = c.site
    where c.created >= p_from and c.created < p_to
    group by c.site, s.name, c.job, c.model
    order by sum(c.cost_usd) desc;
end $$;
revoke all on function public.cost_admin_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.cost_admin_summary(timestamptz, timestamptz) to authenticated;

-- Superadmin: spend per day, all tenants (the line graph).
create function public.cost_admin_daily(p_from timestamptz, p_to timestamptz)
returns table (day date, cost_usd numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_superadmin();
  return query
    select (c.created at time zone 'utc')::date, sum(c.cost_usd)
    from public.model_calls c where c.created >= p_from and c.created < p_to
    group by 1 order by 1;
end $$;
revoke all on function public.cost_admin_daily(timestamptz, timestamptz) from public, anon;
grant execute on function public.cost_admin_daily(timestamptz, timestamptz) to authenticated;

-- Superadmin sets limits (null = off).
create function public.cost_set_limits(p_scope text, p_monthly numeric, p_daily numeric, p_warn numeric default 0.80)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_superadmin();
  insert into public.cost_limits (scope, monthly_usd, daily_usd, warn_ratio)
  values (p_scope, p_monthly, p_daily, p_warn)
  on conflict (scope) do update set monthly_usd = excluded.monthly_usd,
    daily_usd = excluded.daily_usd, warn_ratio = excluded.warn_ratio, updated = private.ms_now();
end $$;
revoke all on function public.cost_set_limits(text, numeric, numeric, numeric) from public, anon;
grant execute on function public.cost_set_limits(text, numeric, numeric, numeric) to authenticated;

-- ---- starting prices (USD per million tokens, as published; edit as data) ----
insert into public.model_prices (model, input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok) values
  ('google/gemini-2.5-flash-lite', 0.10, 0.40, 0.01, 0);
-- Claude prices are added when the DBOS worker lands; check them against
-- Anthropic's price page then rather than copying numbers from memory.
