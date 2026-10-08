-- What the knowledge base agents write (worker/src/agents/). The Checker and
-- the Guardian run in the worker, which reads the app's database read-only
-- and writes only through these functions, with the service key. Browsers
-- can call none of them. Additive only: two new tables and functions.

-- ---- which tenants the agents work for ----

-- A site's agents are off until it has a row here: Lite tenants (Verbatim)
-- never spend a token on them. Turned on by us (service role) for now; Admin
-- gets a switch later.
create table public.kb_agent_sites (
  site text primary key references public.sites (id) on delete cascade,
  checker boolean not null default true,
  guardian boolean not null default true,
  -- The Checker reads post versions written from this moment on. Older posts
  -- wait for the first sweep, so turning it on never re-reads a whole archive.
  since timestamptz not null default private.ms_now(),
  created timestamptz not null default private.ms_now(),
  updated timestamptz not null default private.ms_now()
);

-- ---- the Checker's reports ----

-- One row per post version the Checker read: what it checked against the
-- linked sources (numbers and quotes) and the tenant facts it found, offered
-- as Remember. The flags and post links it raised are in kb_flags and
-- kb_post_claims; this is the rest of its review, shown as review comments.
create table public.kb_checks (
  id text primary key default private.new_id() check (id ~ '^[a-z0-9]{15}$'),
  site text not null references public.sites (id) on delete cascade,
  post text not null references public.posts (id) on delete cascade,
  post_version text not null references public.post_versions (id) on delete cascade,
  -- {summary, sources: [{quote, url, verdict: ok|mismatch|unsupported|unreachable, note}],
  --  remember: [{text, quote}]}
  report jsonb not null default '{}' check (jsonb_typeof(report) = 'object' and octet_length(report::text) <= 200000),
  linked integer not null default 0,
  opened integer not null default 0,
  closed integer not null default 0,
  agent text not null default '' check (char_length(agent) <= 120),
  -- The worker's run, for the Runs page.
  workflow_id text not null default '' check (char_length(workflow_id) <= 200),
  created timestamptz not null default private.ms_now(),
  updated timestamptz not null default private.ms_now(),
  unique (site, id),
  unique (post_version)
);
create index kb_checks_site_post_idx on public.kb_checks (site, post);

do $$
declare
  t text;
begin
  foreach t in array array['kb_agent_sites', 'kb_checks'] loop
    execute format('create trigger stamp before insert or update on public.%I
      for each row execute function private.stamp_created_updated()', t);
    execute format('create trigger site_stays_put before update of site on public.%I
      for each row execute function private.site_stays_put()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy "members read" on public.%I for select to authenticated
      using (site in (select private.my_sites()))', t);
  end loop;
end
$$;

-- ---- what the agents call ----

/** The site a post version belongs to, or an error naming the mismatch. */
create function private.kb_version_site(p_site text, p_post_version text) returns public.post_versions
language plpgsql stable set search_path = '' as $$
declare
  v public.post_versions;
begin
  select * into v from public.post_versions where id = p_post_version;
  if v.id is null or v.site <> p_site then
    raise exception 'No such post version in this site.' using errcode = 'PT404';
  end if;
  return v;
end
$$;

/**
 * Something an agent cites: a post version, a web page, the sentence a person
 * gave when contesting a flag. A post version is one source per version.
 * Returns its id.
 */
create function public.kb_agent_source(
  p_site text, p_kind text, p_tier smallint, p_title text, p_body text,
  p_uri text default '', p_post_version text default null
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  sid text;
begin
  if p_kind = 'post' then
    perform private.kb_version_site(p_site, p_post_version);
    select id into sid from public.kb_sources where site = p_site and post_version = p_post_version;
    if sid is not null then
      return sid;
    end if;
  end if;
  insert into public.kb_sources (site, kind, tier, title, body, uri, post_version, occurred, status)
  values (p_site, p_kind, p_tier, left(coalesce(p_title, ''), 300), left(coalesce(p_body, ''), 2000000),
          left(coalesce(p_uri, ''), 2000), p_post_version, private.ms_now(), 'extracted')
  returning id into sid;
  return sid;
end
$$;

/**
 * The Checker read a post version. In one go:
 *   - its links to the claims it relies on replace the version's earlier ones
 *     (p_links: [{claim, reliance, quote}]);
 *   - each conflict opens a contradiction flag, or refreshes the open one on
 *     the same post and claim (p_conflicts: [{claim, quote, explanation,
 *     suggested_action, suggested_fix}]); a flag someone closed as won't fix
 *     stays closed;
 *   - an open contradiction on an earlier version whose claim the Checker saw
 *     again (p_seen) and no longer conflicts is closed as fixed: the content
 *     changed;
 *   - the report is kept in kb_checks.
 * Returns {linked, opened, closed}.
 */
create function public.kb_checker_record(
  p_site text, p_post_version text, p_links jsonb, p_conflicts jsonb, p_seen text[],
  p_report jsonb, p_agent text, p_workflow text default ''
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.post_versions := private.kb_version_site(p_site, p_post_version);
  c jsonb;
  fid text;
  n_linked integer := 0;
  n_opened integer := 0;
  n_closed integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('kb:' || p_site));

  delete from public.kb_post_claims where post_version = v.id;
  insert into public.kb_post_claims (site, post_version, claim, reliance, quote, agent)
  select distinct on (l ->> 'claim') p_site, v.id, l ->> 'claim', l ->> 'reliance',
         left(coalesce(l ->> 'quote', ''), 4000), coalesce(p_agent, '')
    from jsonb_array_elements(coalesce(p_links, '[]')) l
    join public.kb_claims k on k.id = l ->> 'claim' and k.site = p_site;
  get diagnostics n_linked = row_count;

  for c in select * from jsonb_array_elements(coalesce(p_conflicts, '[]')) loop
    if not exists (select 1 from public.kb_claims where id = c ->> 'claim' and site = p_site
                    and status in ('settled', 'contested')) then
      continue;
    end if;
    select id into fid from public.kb_flags
     where post = v.post and claim = c ->> 'claim' and kind = 'contradiction'
       and status in ('open', 'snoozed', 'wont_fix')
     order by created desc limit 1;
    if fid is not null then
      update public.kb_flags
         set post_version = v.id, quote = left(coalesce(c ->> 'quote', ''), 4000),
             explanation = left(coalesce(c ->> 'explanation', ''), 4000),
             suggested_action = coalesce(c ->> 'suggested_action', ''),
             suggested_fix = left(coalesce(c ->> 'suggested_fix', ''), 20000), checked = private.ms_now()
       where id = fid and status <> 'wont_fix';
    else
      insert into public.kb_flags (site, kind, post, post_version, claim, quote, explanation,
                                   suggested_action, suggested_fix, assignee, checked)
      values (p_site, 'contradiction', v.post, v.id, c ->> 'claim', left(coalesce(c ->> 'quote', ''), 4000),
              left(coalesce(c ->> 'explanation', ''), 4000), coalesce(c ->> 'suggested_action', ''),
              left(coalesce(c ->> 'suggested_fix', ''), 20000),
              (select o from private.kb_claim_owners(c ->> 'claim') o limit 1), private.ms_now());
      n_opened := n_opened + 1;
    end if;
  end loop;

  update public.kb_flags
     set status = 'fixed', closed = private.ms_now(), checked = private.ms_now()
   where post = v.post and kind = 'contradiction' and status in ('open', 'snoozed')
     and post_version is distinct from v.id
     and claim = any (coalesce(p_seen, '{}'))
     and claim not in (select x ->> 'claim' from jsonb_array_elements(coalesce(p_conflicts, '[]')) x);
  get diagnostics n_closed = row_count;

  insert into public.kb_checks (site, post, post_version, report, linked, opened, closed, agent, workflow_id)
  values (p_site, v.post, v.id, coalesce(p_report, '{}'), n_linked, n_opened, n_closed,
          coalesce(p_agent, ''), coalesce(p_workflow, ''))
  on conflict (post_version) do update
    set report = excluded.report, linked = excluded.linked, opened = excluded.opened,
        closed = excluded.closed, agent = excluded.agent, workflow_id = excluded.workflow_id;

  return jsonb_build_object('linked', n_linked, 'opened', n_opened, 'closed', n_closed);
end
$$;

/**
 * The Checker read a post again after a claim it relies on changed. Still
 * holds: the re-check closes as cleared and never counts. Otherwise it stays
 * open, now counting, with what to do about it.
 */
create function public.kb_agent_review_flag(
  p_flag text, p_holds boolean, p_explanation text, p_suggested_action text, p_suggested_fix text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  f public.kb_flags;
begin
  select * into f from public.kb_flags where id = p_flag for update;
  if f.id is null or f.kind <> 'recheck' then
    raise exception 'No such re-check.' using errcode = 'PT404';
  end if;
  if f.status not in ('open', 'snoozed') then
    return;
  end if;
  update public.kb_flags
     set status = case when p_holds then 'cleared' else f.status end,
         closed = case when p_holds then private.ms_now() end,
         explanation = left(coalesce(p_explanation, ''), 4000),
         suggested_action = case when p_holds then 'leave' else coalesce(p_suggested_action, '') end,
         suggested_fix = case when p_holds then '' else left(coalesce(p_suggested_fix, ''), 20000) end,
         checked = private.ms_now()
   where id = f.id;
end
$$;

/**
 * The agent drafted a contest: the changes that would make the flagged post
 * and the knowledge base agree, and its argument, appended to the person's
 * sentence. Replaces any earlier draft. The person submits it (kb_submit).
 * p_changes: [{op, text, target, scope, topics, valid_from, valid_until, rationale,
 *              evidence: [{source, quote, stance}]}]
 */
create function public.kb_agent_draft(p_proposal text, p_changes jsonb, p_argument text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.kb_proposals;
  c jsonb;
  i integer := 0;
begin
  select * into p from public.kb_proposals where id = p_proposal for update;
  if p.id is null then
    raise exception 'No such proposal.' using errcode = 'PT404';
  end if;
  if p.status <> 'draft' then
    raise exception 'Only a draft can be drafted.' using errcode = '22023';
  end if;
  delete from public.kb_changes where proposal = p.id;
  for c in select * from jsonb_array_elements(coalesce(p_changes, '[]')) loop
    insert into public.kb_changes (site, proposal, position, op, text, target, scope, topics,
                                   valid_from, valid_until, rationale, evidence)
    values (p.site, p.id, i, c ->> 'op', coalesce(c ->> 'text', ''), c ->> 'target',
            coalesce(c -> 'scope', '{}'),
            coalesce(array(select jsonb_array_elements_text(c -> 'topics')), '{}'),
            (c ->> 'valid_from')::date, (c ->> 'valid_until')::date, left(coalesce(c ->> 'rationale', ''), 4000),
            coalesce(c -> 'evidence', '[]'));
    i := i + 1;
  end loop;
  update public.kb_proposals
     set summary = left(split_part(summary, E'\n\n---\n', 1) || E'\n\n---\n' || coalesce(p_argument, ''), 20000),
         opened_by_agent = 'checker'
   where id = p.id;
end
$$;

revoke execute on function public.kb_agent_source(text, text, smallint, text, text, text, text),
  public.kb_checker_record(text, text, jsonb, jsonb, text[], jsonb, text, text),
  public.kb_agent_review_flag(text, boolean, text, text, text),
  public.kb_agent_draft(text, jsonb, text),
  private.kb_version_site(text, text)
  from public, anon, authenticated;
grant execute on function public.kb_agent_source(text, text, smallint, text, text, text, text),
  public.kb_checker_record(text, text, jsonb, jsonb, text[], jsonb, text, text),
  public.kb_agent_review_flag(text, boolean, text, text, text),
  public.kb_agent_draft(text, jsonb, text)
  to service_role;
