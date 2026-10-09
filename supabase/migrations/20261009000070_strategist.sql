-- The Strategist (agents/strategist.md, approved by Ayadi 2026-10-09) and the
-- goals it proposes. Additive only: four new tables and four functions;
-- nothing existing is renamed, dropped or rewritten, and no client syncs any
-- of these tables (the app reads them live).
--
--   tenant_profile      the onboarding answers and the plan drop, per tenant
--   strategy_proposals  what the Strategist proposed, asked for, and what was approved
--   goal_versions       the approved goals: one row per version per quarter
--   drift_notes         the weekly check's notes for Home
--
-- How work reaches the worker: a member asks with public.strategy_request()
-- (onboarding, "Ask for changes", "Run the Strategist now"), which adds a
-- proposal in status 'requested'; the worker polls for those, runs, and fills
-- the same row ('running', then 'sent' or 'failed'). Approving goes through
-- public.strategy_approve(), the only writer of goal versions: it also points
-- the Scout at the approved searches and watched sites (20261008000020).
--
-- Grants: the API roles get nothing by default. Members read their tenant's
-- rows, edit the profile, dismiss notes, and call the two functions. The
-- worker writes with the service role.

-- ---- tenant_profile ----

create table public.tenant_profile (
  site text primary key references public.sites (id) on delete cascade,
  -- { offer, searches, watch, upcoming } (app/src/lib/goals/types.ts StrategyAnswers)
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object' and octet_length(answers::text) <= 20000),
  -- The plan drop: pasted text, and files uploaded to Blob (name, url, size, kind).
  plan_text text not null default '' check (char_length(plan_text) <= 100000),
  plan_files jsonb not null default '[]'::jsonb check (jsonb_typeof(plan_files) = 'array' and octet_length(plan_files::text) <= 20000),
  -- When the Strategist last read the plan.
  plan_read_at timestamptz,
  updated_by text not null default '' check (char_length(updated_by) <= 120),
  updated timestamptz not null default private.ms_now()
);

create function private.tenant_profile_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(auth.role(), '') = 'authenticated' then
    new.updated_by := coalesce(auth.uid()::text, '');
    -- Only the worker marks the plan read.
    if tg_op = 'INSERT' then new.plan_read_at := null;
    else new.plan_read_at := old.plan_read_at;
    end if;
  end if;
  new.updated := private.ms_now();
  return new;
end
$$;
create trigger stamp before insert or update on public.tenant_profile
  for each row execute function private.tenant_profile_stamp();
create trigger stays before update on public.tenant_profile
  for each row execute function private.site_stays_put();

-- ---- strategy_proposals ----

create table public.strategy_proposals (
  id text primary key default private.new_id() check (id ~ '^[a-z0-9]{15}$'),
  site text not null references public.sites (id) on delete cascade,
  quarter text not null check (quarter ~ '^[0-9]{4}-Q[1-4]$'),
  kind text not null check (kind in ('onboarding', 'quarterly', 'revision')),
  -- requested: waiting for the worker. running: the worker has it.
  -- sent: on the tenant's Goals page. approved: became a goal version.
  -- superseded: a newer one replaced it. failed: the run gave up (Admin > Runs).
  status text not null default 'requested'
    check (status in ('requested', 'running', 'sent', 'approved', 'superseded', 'failed')),
  -- What the person asked for (a revision's note, or "Run the Strategist now").
  request text not null default '' check (char_length(request) <= 4000),
  requested_by text not null default '' check (char_length(requested_by) <= 120),
  -- The proposal itself (agents/strategist.md section 4), and what it read:
  -- references and numbers only, never page or post text.
  proposal jsonb check (proposal is null or octet_length(proposal::text) <= 200000),
  inputs jsonb check (inputs is null or octet_length(inputs::text) <= 200000),
  -- The tenant's edits before approving: [{field, from, to, reason}].
  edits jsonb check (edits is null or octet_length(edits::text) <= 50000),
  error text not null default '' check (char_length(error) <= 4000),
  run_id text not null default '' check (char_length(run_id) <= 200),
  model text not null default '' check (char_length(model) <= 200),
  cost_usd numeric(12, 6) not null default 0,
  created timestamptz not null default private.ms_now(),
  sent_at timestamptz,
  approved_by text not null default '' check (char_length(approved_by) <= 120),
  approved_at timestamptz
);
create index strategy_proposals_site on public.strategy_proposals (site, quarter, created desc);
create index strategy_proposals_requested on public.strategy_proposals (created) where status = 'requested';
create trigger stays before update on public.strategy_proposals
  for each row execute function private.site_stays_put();

-- ---- goal_versions ----

-- Every approval adds a version; nothing edits one. targets is the shape of
-- GoalTargets (app/src/lib/goals/types.ts): volume {total, topics[]},
-- readership, ranking {searches[], pageOneTarget, aiMentionTarget}.
create table public.goal_versions (
  site text not null references public.sites (id) on delete cascade,
  quarter text not null check (quarter ~ '^[0-9]{4}-Q[1-4]$'),
  version integer not null check (version > 0),
  targets jsonb not null check (jsonb_typeof(targets) = 'object' and octet_length(targets::text) <= 100000),
  -- One line per changed number, e.g. "Volume 18 → 20". Empty for version 1.
  changes jsonb not null default '[]'::jsonb check (jsonb_typeof(changes) = 'array' and octet_length(changes::text) <= 20000),
  note text not null default '' check (char_length(note) <= 2000),
  -- { from, to, weeks, prorated } when the goals cover part of the quarter.
  covers jsonb check (covers is null or octet_length(covers::text) <= 2000),
  proposal text references public.strategy_proposals (id) on delete set null,
  approved_by text not null default '' check (char_length(approved_by) <= 120),
  approved_at timestamptz not null default private.ms_now(),
  primary key (site, quarter, version)
);

-- ---- drift_notes ----

create table public.drift_notes (
  id text primary key default private.new_id() check (id ~ '^[a-z0-9]{15}$'),
  site text not null references public.sites (id) on delete cascade,
  -- ISO week of the Monday check, '2026-W42'.
  week text not null check (week ~ '^[0-9]{4}-W[0-9]{2}$'),
  goal text not null check (goal in ('volume', 'consistency', 'readership', 'ranking', 'topic')),
  severity text not null check (severity in ('behind', 'out_of_reach', 'trend', 'proposal')),
  message text not null check (char_length(message) between 1 and 1000),
  -- { kind: 'pitch' | 'revise' | 'dismiss', label, topic?, count? }
  action jsonb check (action is null or octet_length(action::text) <= 2000),
  dismissed_at timestamptz,
  created timestamptz not null default private.ms_now(),
  unique (site, week, goal, message)
);
create index drift_notes_site on public.drift_notes (site, week);
create trigger stays before update on public.drift_notes
  for each row execute function private.site_stays_put();

-- ---- functions ----

/** Ask the Strategist for a proposal. Members only. Returns the new proposal's id. */
create function public.strategy_request(p_site text, p_kind text, p_quarter text, p_request text default '')
returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  new_id text;
begin
  if p_site is null or p_site not in (select private.my_sites()) then
    raise exception 'Not a member of this site.' using errcode = '42501';
  end if;
  if p_kind not in ('onboarding', 'quarterly', 'revision') then
    raise exception 'Unknown kind of proposal.' using errcode = '22023';
  end if;
  if p_quarter !~ '^[0-9]{4}-Q[1-4]$' then
    raise exception 'Quarter must look like 2026-Q4.' using errcode = '22023';
  end if;
  -- One request at a time per tenant: asking again returns the one waiting.
  select id into new_id from public.strategy_proposals
    where site = p_site and status in ('requested', 'running') order by created desc limit 1;
  if new_id is not null then
    return new_id;
  end if;
  insert into public.strategy_proposals (site, quarter, kind, request, requested_by)
    values (p_site, p_quarter, p_kind, left(coalesce(p_request, ''), 4000), coalesce(auth.uid()::text, ''))
    returning id into new_id;
  return new_id;
end
$$;

/**
 * Approve a sent proposal, as the tenant edited it. Writes the next goal
 * version, supersedes the quarter's other open proposals, and points the Scout
 * at the approved searches and watched sites. Members only.
 */
create function public.strategy_approve(p_proposal text, p_targets jsonb, p_edits jsonb default '[]'::jsonb,
  p_changes jsonb default '[]'::jsonb, p_note text default '', p_watched jsonb default '[]'::jsonb)
returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  p public.strategy_proposals;
  next_version integer;
  s jsonb;
  w jsonb;
begin
  select * into p from public.strategy_proposals where id = p_proposal for update;
  if p.id is null or p.site not in (select private.my_sites()) then
    raise exception 'No such proposal.' using errcode = '42501';
  end if;
  if p.status <> 'sent' then
    raise exception 'This proposal is %, so it can''t be approved.', p.status using errcode = '22023';
  end if;
  if jsonb_typeof(p_targets) <> 'object' or jsonb_typeof(p_targets -> 'volume') <> 'object' then
    raise exception 'The goals are missing their Volume.' using errcode = '22023';
  end if;

  select coalesce(max(version), 0) + 1 into next_version
    from public.goal_versions where site = p.site and quarter = p.quarter;
  insert into public.goal_versions (site, quarter, version, targets, changes, note, covers, proposal, approved_by)
    values (p.site, p.quarter, next_version, p_targets, coalesce(p_changes, '[]'::jsonb), left(coalesce(p_note, ''), 2000),
            p.proposal -> 'covers', p.id, coalesce(auth.uid()::text, ''));

  update public.strategy_proposals
    set status = 'approved', edits = coalesce(p_edits, '[]'::jsonb),
        approved_by = coalesce(auth.uid()::text, ''), approved_at = private.ms_now()
    where id = p.id;
  update public.strategy_proposals set status = 'superseded'
    where site = p.site and quarter = p.quarter and id <> p.id and status = 'sent';

  -- The Scout follows the approved searches from tomorrow; ones dropped stop.
  update public.scout_searches set active = false
    where site = p.site and quarter = p.quarter and active
      and lower(query) not in (select lower(x ->> 'query') from jsonb_array_elements(coalesce(p_targets #> '{ranking,searches}', '[]'::jsonb)) x);
  for s in select * from jsonb_array_elements(coalesce(p_targets #> '{ranking,searches}', '[]'::jsonb)) loop
    continue when coalesce(btrim(s ->> 'query'), '') = '';
    insert into public.scout_searches (site, quarter, query, prompt, topic)
      values (p.site, p.quarter, left(btrim(s ->> 'query'), 300), left(coalesce(s ->> 'prompt', ''), 500), left(coalesce(s ->> 'topic', ''), 200))
      on conflict (site, quarter, query) do update set active = true, topic = excluded.topic,
        prompt = case when excluded.prompt <> '' then excluded.prompt else public.scout_searches.prompt end;
  end loop;

  -- Watched sites: the Strategist's own ones not approved stop; a person's stay.
  update public.watched_sites set active = false
    where site = p.site and added_by = 'strategist' and active
      and url not in (select x ->> 'url' from jsonb_array_elements(coalesce(p_watched, '[]'::jsonb)) x);
  for w in select * from jsonb_array_elements(coalesce(p_watched, '[]'::jsonb)) loop
    continue when coalesce(w ->> 'url', '') !~ '^https?://';
    insert into public.watched_sites (site, url, topic, why, added_by)
      values (p.site, left(w ->> 'url', 2000), left(coalesce(w ->> 'topic', ''), 200), left(coalesce(w ->> 'why', ''), 1000), 'strategist')
      on conflict (site, url) do update set active = true, topic = excluded.topic, why = excluded.why;
  end loop;

  return next_version;
end
$$;

-- ---- access ----

alter table public.tenant_profile enable row level security;
alter table public.strategy_proposals enable row level security;
alter table public.goal_versions enable row level security;
alter table public.drift_notes enable row level security;

revoke all on public.tenant_profile, public.strategy_proposals, public.goal_versions, public.drift_notes
  from anon, authenticated;
grant all on public.tenant_profile, public.strategy_proposals, public.goal_versions, public.drift_notes
  to service_role;

grant select, insert (site, answers, plan_text, plan_files), update (site, answers, plan_text, plan_files)
  on public.tenant_profile to authenticated;
create policy "members read" on public.tenant_profile for select to authenticated
  using (site in (select private.my_sites()));
create policy "members insert" on public.tenant_profile for insert to authenticated
  with check (site in (select private.my_sites()));
create policy "members update" on public.tenant_profile for update to authenticated
  using (site in (select private.my_sites())) with check (site in (select private.my_sites()));

grant select on public.strategy_proposals, public.goal_versions to authenticated;
create policy "members read" on public.strategy_proposals for select to authenticated
  using (site in (select private.my_sites()));
create policy "members read" on public.goal_versions for select to authenticated
  using (site in (select private.my_sites()));

grant select, update (dismissed_at) on public.drift_notes to authenticated;
create policy "members read" on public.drift_notes for select to authenticated
  using (site in (select private.my_sites()));
create policy "members dismiss" on public.drift_notes for update to authenticated
  using (site in (select private.my_sites())) with check (site in (select private.my_sites()));

revoke all on function public.strategy_request(text, text, text, text) from public, anon;
grant execute on function public.strategy_request(text, text, text, text) to authenticated;
revoke all on function public.strategy_approve(text, jsonb, jsonb, jsonb, text, jsonb) from public, anon;
grant execute on function public.strategy_approve(text, jsonb, jsonb, jsonb, text, jsonb) to authenticated;
