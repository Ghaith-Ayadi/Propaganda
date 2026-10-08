-- What the Pitcher and the Writer need (worker/src/agents), and the tenant's
-- batch cadence. Additive only:
-- new tables, new nullable or defaulted columns, and two check constraints
-- widened (dropped and re-added with more values). Nothing a client writes
-- today is renamed, dropped or refused.
--
-- The briefs columns are the pipeline UI's proposal (PR #30) plus three the
-- agents need (pitched_by, idea, expires_at). If PR #30's draft lands first,
-- the `if not exists` makes the overlap a no-op. Tested on plain Postgres by
-- supabase/tests/sql/run.sh.

-- ---- briefs: pitches ----

alter table public.briefs drop constraint if exists briefs_status_check;
alter table public.briefs add constraint briefs_status_check
  check (status in ('backlog', 'pitched', 'todo', 'in_progress', 'in_review', 'scheduled', 'done', 'cancelled', 'rejected'));

alter table public.briefs
  add column if not exists topics jsonb check (topics is null or octet_length(topics::text) <= 2000),
  -- { why, grade, reasons: [{kind, text, counts}], goals: [{goal, moves, note}] }
  add column if not exists fit jsonb check (fit is null or octet_length(fit::text) <= 20000),
  add column if not exists origin text not null default '' check (char_length(origin) <= 40),
  add column if not exists sources jsonb check (sources is null or octet_length(sources::text) <= 20000),
  add column if not exists notes jsonb check (notes is null or octet_length(notes::text) <= 50000),
  add column if not exists outline jsonb check (outline is null or octet_length(outline::text) <= 20000),
  add column if not exists angle text not null default '' check (char_length(angle) <= 4000),
  add column if not exists audience text not null default '' check (char_length(audience) <= 2000),
  add column if not exists length text not null default '' check (char_length(length) <= 120),
  add column if not exists writer text not null default '' check (char_length(writer) <= 120),
  add column if not exists reviewer text not null default '' check (char_length(reviewer) <= 120),
  add column if not exists reject_reason text not null default '' check (char_length(reject_reason) <= 4000),
  add column if not exists batch integer,
  add column if not exists scheduled_at timestamptz,
  -- 'agent:pitcher' when an agent pitched it; '' for a person's brief. The
  -- agents only ever change briefs an agent made.
  add column if not exists pitched_by text not null default '' check (pitched_by in ('', 'agent:pitcher', 'agent:strategist')),
  -- The idea it came from (agent_ideas.id), and when a timely pitch goes stale.
  add column if not exists idea text,
  add column if not exists expires_at date;

create index if not exists briefs_site_pitched_idx on public.briefs (site, pitched_by) where pitched_by <> '';

-- ---- ideas: what the Listener, the Scout, Chat and people hand the Pitcher ----

create table public.agent_ideas (
  id text primary key default private.new_id() check (id ~ '^[a-z0-9]{15}$'),
  site text not null references public.sites (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  summary text not null default '' check (char_length(summary) <= 4000),
  origin text not null check (origin in ('calls', 'search', 'news', 'watched', 'team', 'plan')),
  -- [{label, url?, quote?, at?, detail?}]: why it's an idea, with the quoted span or the number.
  evidence jsonb not null default '[]' check (jsonb_typeof(evidence) = 'array' and octet_length(evidence::text) <= 40000),
  source_agent text not null check (source_agent in ('listener', 'scout', 'chat', 'person', 'strategist')),
  expires_at timestamptz,
  target_search text not null default '' check (char_length(target_search) <= 300),
  -- new: waiting for the Pitcher. pitched: became `brief`. rejected: kept, with `reason`.
  status text not null default 'new' check (status in ('new', 'pitched', 'rejected')),
  reason text not null default '' check (char_length(reason) <= 4000),
  brief text references public.briefs (id) on delete set null,
  created timestamptz not null default private.ms_now(),
  updated timestamptz not null default private.ms_now()
);
create index agent_ideas_site_status_idx on public.agent_ideas (site, status, created);
create trigger stamp before insert or update on public.agent_ideas
  for each row execute function private.stamp_created_updated();
create trigger site_stays_put before update on public.agent_ideas
  for each row execute function private.site_stays_put();

alter table public.briefs add constraint briefs_idea_fkey
  foreign key (idea) references public.agent_ideas (id) on delete set null;

-- Members read their tenant's ideas (rejected ones included: "kept"). Only the
-- worker (service role) writes them.
alter table public.agent_ideas enable row level security;
grant select on public.agent_ideas to authenticated;
create policy "members read" on public.agent_ideas for select to authenticated
  using (site in (select private.my_sites()));

-- ---- voice guides: the Writer's first job, editable by the tenant ----

create table public.voice_guides (
  site text primary key references public.sites (id) on delete cascade,
  body text not null default '' check (char_length(body) <= 20000),
  -- [{title, passage}]: verbatim passages from the tenant's posts.
  samples jsonb check (samples is null or octet_length(samples::text) <= 20000),
  -- content: written by the Writer from the tenant's posts. default: the
  -- default voice. person: edited by someone; the Writer never writes it again.
  source text not null default 'default' check (source in ('content', 'default', 'person')),
  -- Another site whose posts gave the voice (Propaganda's own tenant reads Verbatim).
  source_site text references public.sites (id) on delete set null,
  updated_by text not null default '' check (char_length(updated_by) <= 120),
  updated timestamptz not null default private.ms_now()
);

-- An edit through the API is a person's edit, whatever the client sends.
create function private.voice_guide_by_person() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(auth.role(), '') = 'authenticated' then
    new.source := 'person';
    new.updated_by := coalesce(auth.uid()::text, '');
  end if;
  new.updated := private.ms_now();
  return new;
end
$$;
create trigger by_person before insert or update on public.voice_guides
  for each row execute function private.voice_guide_by_person();

alter table public.voice_guides enable row level security;
grant select, insert, update on public.voice_guides to authenticated;
create policy "members read" on public.voice_guides for select to authenticated
  using (site in (select private.my_sites()));
create policy "members insert" on public.voice_guides for insert to authenticated
  with check (site in (select private.my_sites()));
create policy "members update" on public.voice_guides for update to authenticated
  using (site in (select private.my_sites())) with check (site in (select private.my_sites()));

-- ---- agent_settings: how a tenant wants its agents to work ----

-- One row per tenant; no row means every default. batch_cadence: how planned
-- pitches reach the inbox. weekly (the default): equal weekly batches through
-- the quarter's first two months, a double batch at the start. flood: all at
-- once. Either way a person can ask for the next batch.
create table public.agent_settings (
  site text primary key references public.sites (id) on delete cascade,
  batch_cadence text not null default 'weekly' check (batch_cadence in ('weekly', 'flood')),
  updated_by text not null default '' check (char_length(updated_by) <= 120),
  updated timestamptz not null default private.ms_now()
);

create function private.agent_settings_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(auth.role(), '') = 'authenticated' then
    new.updated_by := coalesce(auth.uid()::text, '');
  end if;
  new.updated := private.ms_now();
  return new;
end
$$;
create trigger stamp before insert or update on public.agent_settings
  for each row execute function private.agent_settings_stamp();

alter table public.agent_settings enable row level security;
grant select, insert, update on public.agent_settings to authenticated;
create policy "members read" on public.agent_settings for select to authenticated
  using (site in (select private.my_sites()));
create policy "members insert" on public.agent_settings for insert to authenticated
  with check (site in (select private.my_sites()));
create policy "members update" on public.agent_settings for update to authenticated
  using (site in (select private.my_sites())) with check (site in (select private.my_sites()));

-- ---- post_versions: the Writer's versions say so ----

alter table public.post_versions drop constraint if exists post_versions_created_by_check;
alter table public.post_versions add constraint post_versions_created_by_check
  check (created_by in ('user', 'mcp:claude-code', 'migration', 'agent:writer'));
