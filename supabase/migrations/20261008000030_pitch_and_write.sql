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

-- ---- content_batches: the plan's batches and their quotas ----

-- A batch's quota is how many briefs it should END with approved. The Pitcher
-- over-pitches, tops a short batch up the next morning, and cancels the rest
-- once the quarter's approvals reach the target. pending: not out yet.
-- in_review: out. topping_up: short, more pitches went out. closed: reached
-- its quota (or the tenant said enough). cancelled: the target was met first.
create table public.content_batches (
  site text not null references public.sites (id) on delete cascade,
  quarter text not null check (quarter ~ '^[0-9]{4}-Q[1-4]$'),
  number integer not null check (number > 0),
  quota integer not null check (quota >= 0),
  state text not null default 'pending' check (state in ('pending', 'in_review', 'topping_up', 'closed', 'cancelled')),
  released_at timestamptz,
  topups integer not null default 0,
  updated timestamptz not null default private.ms_now(),
  primary key (site, quarter, number)
);

alter table public.content_batches enable row level security;
grant select on public.content_batches to authenticated;
grant update (state) on public.content_batches to authenticated;
create policy "members read" on public.content_batches for select to authenticated
  using (site in (select private.my_sites()));
-- "That's enough": a member closes a batch.
create policy "members close" on public.content_batches for update to authenticated
  using (site in (select private.my_sites())) with check (site in (select private.my_sites()) and state in ('closed', 'in_review', 'topping_up'));

-- ---- taste_log: every decision on a pitch or a draft ----

-- What the tenant likes, dislikes and has already been shown: kept apart from
-- the knowledge base (facts about the company). Append-only: nothing updates
-- or deletes a row. The triggers below log decisions whatever client makes
-- them; the app adds what a status can't say (a "not now", a note).
create table public.taste_log (
  id text primary key default private.new_id() check (id ~ '^[a-z0-9]{15}$'),
  site text not null references public.sites (id) on delete cascade,
  at timestamptz not null default private.ms_now(),
  -- an auth user id, or agent:<name>, or 'server'
  actor text not null default '' check (char_length(actor) <= 120),
  object_kind text not null check (object_kind in ('pitch', 'draft', 'plan')),
  object_id text not null default '' check (char_length(object_id) <= 64),
  -- approved, approved_with_notes, rejected, not_now, cancelled, edited, sent_back, note
  decision text not null check (char_length(decision) between 1 and 40),
  reason text not null default '' check (char_length(reason) <= 4000),
  notes jsonb check (notes is null or octet_length(notes::text) <= 50000),
  title text not null default '' check (char_length(title) <= 300),
  topic text not null default '' check (char_length(topic) <= 200),
  angle text not null default '' check (char_length(angle) <= 4000),
  origin text not null default '' check (char_length(origin) <= 40)
);
create index taste_log_site_at_idx on public.taste_log (site, at);

create function private.taste_log_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(auth.role(), '') = 'authenticated' then
    new.actor := coalesce(auth.uid()::text, '');
    new.at := private.ms_now();
  end if;
  return new;
end
$$;
create trigger stamp before insert on public.taste_log
  for each row execute function private.taste_log_stamp();

alter table public.taste_log enable row level security;
grant select, insert on public.taste_log to authenticated;
create policy "members read" on public.taste_log for select to authenticated
  using (site in (select private.my_sites()));
create policy "members add" on public.taste_log for insert to authenticated
  with check (site in (select private.my_sites()));

-- A pitch decided: logged from the status change. Never blocks the write.
create function private.log_pitch_decision() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  d text;
begin
  d := case
    when new.status = 'rejected' then 'rejected'
    when new.status = 'backlog' then 'not_now'
    when new.status = 'cancelled' then 'cancelled'
    when coalesce(jsonb_array_length(case when jsonb_typeof(new.notes) = 'array' then new.notes end), 0) > 0 then 'approved_with_notes'
    else 'approved'
  end;
  insert into public.taste_log (site, actor, object_kind, object_id, decision, reason, notes, title, topic, angle, origin)
  values (new.site, coalesce(auth.uid()::text, 'server'), 'pitch', new.id, d, coalesce(new.reject_reason, ''), new.notes,
    left(new.title, 300), coalesce(new.topics ->> 0, ''), left(coalesce(new.angle, ''), 4000), coalesce(new.origin, ''));
  return null;
exception when others then
  raise warning 'taste_log: %', sqlerrm;
  return null;
end
$$;
create trigger log_pitch_decision after update of status on public.briefs
  for each row when (old.status = 'pitched' and new.status <> 'pitched')
  execute function private.log_pitch_decision();

-- A person's first version after the Writer's: the reviewer edited the draft.
create function private.log_draft_edit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select v.created_by from public.post_versions v
      where v.post = new.post and v.version < new.version order by v.version desc limit 1) = 'agent:writer' then
    insert into public.taste_log (site, actor, object_kind, object_id, decision, title)
    values (new.site, coalesce(auth.uid()::text, 'server'), 'draft', new.post, 'edited',
      coalesce((select left(p.title, 300) from public.posts p where p.id = new.post), ''));
  end if;
  return null;
exception when others then
  raise warning 'taste_log: %', sqlerrm;
  return null;
end
$$;
create trigger log_draft_edit after insert on public.post_versions
  for each row when (new.created_by = 'user')
  execute function private.log_draft_edit();

-- ---- taste_profiles: the Pitcher's summary, and the tenant's own words ----

-- summary: rewritten by the Pitcher from the log before each batch.
-- notes: the tenant's edit, read by the Pitcher, never written by an agent.
create table public.taste_profiles (
  site text primary key references public.sites (id) on delete cascade,
  summary text not null default '' check (char_length(summary) <= 4000),
  -- the newest log row the summary has read
  summary_through timestamptz,
  notes text not null default '' check (char_length(notes) <= 4000),
  notes_by text not null default '' check (char_length(notes_by) <= 120),
  updated timestamptz not null default private.ms_now()
);

create function private.taste_profile_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(auth.role(), '') = 'authenticated' then
    new.notes_by := coalesce(auth.uid()::text, '');
  end if;
  new.updated := private.ms_now();
  return new;
end
$$;
create trigger stamp before insert or update on public.taste_profiles
  for each row execute function private.taste_profile_stamp();

alter table public.taste_profiles enable row level security;
grant select on public.taste_profiles to authenticated;
grant insert (site, notes), update (notes) on public.taste_profiles to authenticated;
create policy "members read" on public.taste_profiles for select to authenticated
  using (site in (select private.my_sites()));
create policy "members insert" on public.taste_profiles for insert to authenticated
  with check (site in (select private.my_sites()));
create policy "members update" on public.taste_profiles for update to authenticated
  using (site in (select private.my_sites())) with check (site in (select private.my_sites()));

-- ---- what a pitch learned, and the Writer's proposed voice changes ----

alter table public.briefs
  add column if not exists learned text not null default '' check (char_length(learned) <= 400),
  add column if not exists changed text not null default '' check (char_length(changed) <= 600);

-- A change the Writer proposes from reviewers' repeated edits. The tenant
-- applies it to `body` (or not); the Writer never writes `body` for them.
alter table public.voice_guides
  add column if not exists suggestion text not null default '' check (char_length(suggestion) <= 6000),
  add column if not exists suggestion_through timestamptz;

-- ---- post_versions: the Writer's versions say so ----

alter table public.post_versions drop constraint if exists post_versions_created_by_check;
alter table public.post_versions add constraint post_versions_created_by_check
  check (created_by in ('user', 'mcp:claude-code', 'migration', 'agent:writer'));
