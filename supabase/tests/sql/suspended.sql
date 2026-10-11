-- Suspended tenants (20261010000090_tenant_suspended.sql). Each check raises
-- on failure. Run by supabase/tests/sql/run.sh.
\set ON_ERROR_STOP on
set client_min_messages = warning;

insert into auth.users (id) values ('55555555-5555-5555-5555-555555555555'), ('66666666-6666-6666-6666-666666666666')
  on conflict do nothing;
insert into private.superadmins (user_id) values ('66666666-6666-6666-6666-666666666666') on conflict do nothing;
insert into public.sites (id, name, slug) values ('sitesusp0000001', 'Suspended tenant', 'suspended-tenant');
insert into public.site_members (site, user_id, role) values ('sitesusp0000001', '55555555-5555-5555-5555-555555555555', 'owner');

-- Off by default, with no cost_limits row.
do $$ begin
  if (public.cost_gate('sitesusp0000001')->>'suspended')::boolean then raise exception 'FAIL: suspended by default'; end if;
end $$;

-- The owner can't suspend or lift it, and can't write cost_limits.
set role authenticated;
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
do $$ begin
  begin
    perform public.cost_set_suspended('sitesusp0000001', true);
    raise exception 'FAIL: an owner set suspended';
  exception when insufficient_privilege then null; end;
  begin
    update public.cost_limits set suspended = false where scope = 'sitesusp0000001';
    raise exception 'FAIL: an owner wrote cost_limits';
  exception when insufficient_privilege then null; end;
end $$;

-- A superadmin suspends it; the gate says so; lifting it keeps the row's limits.
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', false);
select public.cost_set_suspended('sitesusp0000001', true);
reset role;
do $$ begin
  if not (public.cost_gate('sitesusp0000001')->>'suspended')::boolean then raise exception 'FAIL: not suspended after set'; end if;
end $$;
update public.cost_limits set monthly_usd = 25 where scope = 'sitesusp0000001';
set role authenticated;
select public.cost_set_suspended('sitesusp0000001', false);
reset role;
do $$ begin
  if (public.cost_gate('sitesusp0000001')->>'suspended')::boolean then raise exception 'FAIL: still suspended after lifting'; end if;
  if (select monthly_usd from public.cost_limits where scope = 'sitesusp0000001') <> 25 then raise exception 'FAIL: lifting changed the limit'; end if;
end $$;

-- Anon can't call it.
set role anon;
do $$ begin
  begin
    perform public.cost_set_suspended('sitesusp0000001', true);
    raise exception 'FAIL: anon set suspended';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select 'suspended: ok';
