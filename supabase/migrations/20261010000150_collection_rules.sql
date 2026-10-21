-- Rules for the agents, per collection (Ayadi, 2026-10-18).
--
-- A collection's description is public (collections are readable by anyone,
-- for the blogs). Its rules are not: they tell the Pitcher and the Writer how
-- posts in that collection are written ("academic: show the method, the
-- numbers and what we learned"). So they live in their own table, one row per
-- collection, readable and writable by the site's members only. The worker
-- reads them with the service role.
--
-- Additive only: one new table.

create table public.collection_rules (
  collection text primary key references public.collections (id) on delete cascade,
  site text not null references public.sites (id),
  rules text not null default '' check (char_length(rules) <= 8000),
  created timestamptz not null default private.ms_now(),
  updated timestamptz not null default private.ms_now()
);
create index collection_rules_site_idx on public.collection_rules (site);

create trigger stamp before insert or update on public.collection_rules
  for each row execute function private.stamp_created_updated();
create trigger site_stays_put before update of site on public.collection_rules
  for each row execute function private.site_stays_put();

-- The row's site must be its collection's site.
create function private.collection_rules_same_site() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from public.collections c where c.id = new.collection and c.site = new.site) then
    raise exception 'collection_rules: the collection is not on this site';
  end if;
  return new;
end;
$$;
create trigger same_site before insert or update on public.collection_rules
  for each row execute function private.collection_rules_same_site();

alter table public.collection_rules enable row level security;
revoke all on public.collection_rules from anon, authenticated;
grant select, insert, update, delete on public.collection_rules to authenticated;
grant all on public.collection_rules to service_role;

create policy "members read" on public.collection_rules for select to authenticated
  using (site in (select private.my_sites()));
create policy "members insert" on public.collection_rules for insert to authenticated
  with check (site in (select private.my_sites()));
create policy "members update" on public.collection_rules for update to authenticated
  using (site in (select private.my_sites()))
  with check (site in (select private.my_sites()));
create policy "members delete" on public.collection_rules for delete to authenticated
  using (site in (select private.my_sites()));
