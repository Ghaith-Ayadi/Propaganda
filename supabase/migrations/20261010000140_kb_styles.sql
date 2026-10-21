-- Styles: the second half of the knowledge base (Ayadi, 2026-10-15). Facts are
-- what is true about the tenant (kb_claims); Styles are how the tenant wants its
-- writing to sound ("this stinks of AI", "never open with a vendor's quote").
-- Every tenant has its own. The Strategist, the Pitcher, the Writer and Chat
-- read the active ones on every run, after our twenty rules, which stay the
-- floor: a style can add a rule or relax a judgement rule, never switch off one
-- we check in code.
--
-- Kept apart from kb_claims so a style rule never shows up when a post's facts
-- are checked. Private to the site's members (the worker reads with the service
-- role). Nothing is deleted: a rule nobody wants any more is retired.
--
-- Additive only: one new table.

create table public.kb_styles (
  id text primary key default private.new_id() check (id ~ '^[a-z0-9]{15}$'),
  site text not null references public.sites (id) on delete cascade,
  -- The rule, as the person said it.
  rule text not null check (char_length(btrim(rule)) between 1 and 2000),
  -- A line in the tone they want, so the Writer learns the register without reusing it.
  example text not null default '' check (char_length(example) <= 2000),
  -- Where it was said.
  origin text not null default 'person' check (origin in ('person', 'chat', 'comment', 'pitch')),
  status text not null default 'active' check (status in ('active', 'retired')),
  created_by uuid default auth.uid(),
  created timestamptz not null default private.ms_now(),
  updated timestamptz not null default private.ms_now()
);
create index kb_styles_site_idx on public.kb_styles (site, status);

create trigger stamp before insert or update on public.kb_styles
  for each row execute function private.stamp_created_updated();
create trigger site_stays_put before update of site on public.kb_styles
  for each row execute function private.site_stays_put();

alter table public.kb_styles enable row level security;
revoke all on public.kb_styles from anon, authenticated;
grant select, insert, update on public.kb_styles to authenticated;
grant all on public.kb_styles to service_role;

create policy "members read" on public.kb_styles for select to authenticated
  using (site in (select private.my_sites()));
create policy "members insert" on public.kb_styles for insert to authenticated
  with check (site in (select private.my_sites()));
create policy "members update" on public.kb_styles for update to authenticated
  using (site in (select private.my_sites()))
  with check (site in (select private.my_sites()));
