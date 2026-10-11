-- A suspended tenant spends nothing (Ayadi, 2026-10-10): the gateway refuses
-- every paid call for it before it is made (models and paid APIs, background
-- and editor alike, on our account or the tenant's own key), and the worker's
-- schedules leave it out. Havok, the disposable test tenant on dev, is always
-- suspended; the same switch can turn AI off for Lite later.
--
-- The flag sits on cost_limits, which only the service role writes: an owner
-- can't lift it. Superadmins set it with cost_set_suspended(). Adds only.

alter table public.cost_limits add column suspended boolean not null default false;

-- Same keys as before, plus 'suspended'.
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
    'killed', (select engaged from public.cost_kill),
    'suspended', coalesce((select suspended from public.cost_limits where scope = p_site), false)
  )
$$;
revoke all on function public.cost_gate(text) from public, anon, authenticated;
grant execute on function public.cost_gate(text) to service_role;

-- Superadmins only. Keeps the tenant's limits as they are.
create function public.cost_set_suspended(p_site text, p_suspended boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_superadmin();
  if not exists (select 1 from public.sites where id = p_site) then
    raise exception 'no such tenant' using errcode = 'P0002';
  end if;
  insert into public.cost_limits (scope, suspended) values (p_site, p_suspended)
  on conflict (scope) do update set suspended = excluded.suspended, updated = private.ms_now();
end $$;
revoke all on function public.cost_set_suspended(text, boolean) from public, anon;
grant execute on function public.cost_set_suspended(text, boolean) to authenticated;
