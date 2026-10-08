-- The Scout's tables (Propaganda 0.2), to land as supabase/migrations/20261008000020_scout.sql.
-- DRAFT: not in supabase/migrations yet, so
-- no Bedrock deploy applies it; it waits for Ayadi's go-ahead, like the other
-- 0.2 drafts. Additive only: new tables, one new role, nothing existing is
-- renamed, dropped or rewritten, and no client syncs any of these tables.
--
-- Needs the 0.2 site schema (public.sites, private.my_sites, private.new_id,
-- private.ms_now, private.stamp_created_updated) and nothing else.
--
-- What the Scout follows (written by the Goals approval, or by hand for now):
--   scout_searches   the quarter's target searches, each also asked as an AI prompt
--   watched_sites    pages the Scout checks daily, each tied to a topic
-- What it writes (its ideas go to the Pitcher's agent_ideas, 20261008000030):
--   scout_seen       links it has already looked at, so it never pays twice for one
--   daily_facts      the Ranking facts per day (goal model: daily_facts)
--
-- The worker writes as propaganda_scout, a role that can write these tables
-- and nothing else (worker/src/scout/store.ts connects with role=propaganda_scout).

-- ---- the role ----

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'propaganda_scout') then
    create role propaganda_scout nologin;
  end if;
end $$;
grant usage on schema public, private, extensions to propaganda_scout;
grant execute on function private.new_id(), private.ms_now() to propaganda_scout;
grant select (id, name, slug, domain) on public.sites to propaganda_scout;

-- ---- what it follows ----

create table public.scout_searches (
  id text primary key default private.new_id() check (id ~ '^[a-z0-9]{15}$'),
  site text not null references public.sites (id) on delete cascade,
  -- Calendar quarter, '2026-Q4'. The Scout follows the current quarter's rows.
  quarter text not null check (quarter ~ '^[0-9]{4}-Q[1-4]$'),
  query text not null check (char_length(query) between 1 and 300),
  -- The same search phrased as a question, for AI answers. Empty: use query.
  prompt text not null default '' check (char_length(prompt) <= 500),
  topic text not null default '' check (char_length(topic) <= 200),
  -- DataForSEO location and language (2840 = United States).
  location_code integer not null default 2840,
  language_code text not null default 'en' check (char_length(language_code) between 2 and 10),
  active boolean not null default true,
  created timestamptz not null default private.ms_now(),
  updated timestamptz not null default private.ms_now(),
  unique (site, quarter, query)
);
create index scout_searches_site on public.scout_searches (site, quarter) where active;

create table public.watched_sites (
  id text primary key default private.new_id() check (id ~ '^[a-z0-9]{15}$'),
  site text not null references public.sites (id) on delete cascade,
  url text not null check (url ~ '^https?://' and char_length(url) <= 2000),
  topic text not null default '' check (char_length(topic) <= 200),
  why text not null default '' check (char_length(why) <= 1000),
  added_by text not null default 'person' check (added_by in ('strategist', 'person')),
  active boolean not null default true,
  -- The Scout's own bookkeeping: the links the page had last time.
  last_checked_at timestamptz,
  last_items jsonb check (last_items is null or octet_length(last_items::text) <= 200000),
  last_error text check (last_error is null or char_length(last_error) <= 1000),
  created timestamptz not null default private.ms_now(),
  updated timestamptz not null default private.ms_now(),
  unique (site, url)
);

-- ---- what it writes ----

create table public.scout_seen (
  site text not null references public.sites (id) on delete cascade,
  url text not null check (char_length(url) <= 2000),
  first_seen date not null,
  primary key (site, url)
);

-- The goal model's daily facts. The Scout writes kinds 'ranking_search' and
-- 'ranking_ai'; the scoring job will add the others.
create table public.daily_facts (
  site text not null references public.sites (id) on delete cascade,
  day date not null,
  kind text not null check (char_length(kind) between 1 and 60),
  value jsonb not null check (octet_length(value::text) <= 100000),
  updated timestamptz not null default private.ms_now(),
  primary key (site, day, kind)
);

create trigger scout_searches_stamp before insert or update on public.scout_searches
  for each row execute function private.stamp_created_updated();
create trigger watched_sites_stamp before insert or update on public.watched_sites
  for each row execute function private.stamp_created_updated();
create trigger scout_searches_stays before update on public.scout_searches
  for each row execute function private.site_stays_put();
create trigger watched_sites_stays before update on public.watched_sites
  for each row execute function private.site_stays_put();


-- ---- access ----
-- Members read their tenant's rows and edit what the Scout follows. The worker's role reads and writes all of it. Nothing is
-- public: published posts are the only thing anonymous readers see.

alter table public.scout_searches enable row level security;
alter table public.watched_sites enable row level security;
alter table public.scout_seen enable row level security;
alter table public.daily_facts enable row level security;

revoke all on public.scout_searches, public.watched_sites,
  public.scout_seen, public.daily_facts from anon, authenticated;
grant all on public.scout_searches, public.watched_sites,
  public.scout_seen, public.daily_facts to service_role;
grant select, insert, update, delete on public.scout_searches, public.watched_sites to authenticated;
grant select on public.daily_facts to authenticated;
grant select, insert, update on public.scout_searches, public.watched_sites,
  public.scout_seen, public.daily_facts to propaganda_scout;

create policy "members" on public.scout_searches for all to authenticated
  using (site in (select private.my_sites())) with check (site in (select private.my_sites()));
create policy "members" on public.watched_sites for all to authenticated
  using (site in (select private.my_sites())) with check (site in (select private.my_sites()));
create policy "members read" on public.daily_facts for select to authenticated
  using (site in (select private.my_sites()));

create policy "scout" on public.scout_searches for all to propaganda_scout using (true) with check (true);
create policy "scout" on public.watched_sites for all to propaganda_scout using (true) with check (true);
create policy "scout" on public.scout_seen for all to propaganda_scout using (true) with check (true);
create policy "scout" on public.daily_facts for all to propaganda_scout using (true) with check (true);
-- public.sites already has "anyone reads sites".
