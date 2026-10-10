-- Turn the Checker and the Guardian on for every new tenant (Ayadi, 2026-10-10).
-- Until now a site's KB agents ran only once we added its kb_agent_sites row by
-- hand, and nobody did for new tenants: the Review tab's source and knowledge
-- base checks never ran, while it said everything checked holds up.
-- New sites only. Existing ones (Verbatim on Lite, PPGD) keep what they have;
-- adding them stays a separate call. `since` defaults to now, so a new site's
-- Checker reads only what is written from its first day.
create function private.kb_agents_on_new_site() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.kb_agent_sites (site) values (new.id) on conflict (site) do nothing;
  return new;
end
$$;
revoke all on function private.kb_agents_on_new_site() from public, anon, authenticated;

create trigger kb_agents_on after insert on public.sites
  for each row execute function private.kb_agents_on_new_site();
