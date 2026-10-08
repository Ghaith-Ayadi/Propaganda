-- The knowledge base (Propaganda 0.2). The design: docs/knowledge-base.md.
-- Additive only: fourteen new tables, their functions and views, nothing an
-- existing client writes changes.
--
-- One knowledge base per site. Server-side only: none of these tables are in
-- the editor's Dexie sync. Members read everything of their site; they write
-- only through the functions at the end (Remember, contest, close a flag,
-- an owner's ruling). Claims, relationships, evidence, post links and
-- decisions are written by the Guardian's worker (service_role) through
-- kb_guardian_decide, never row by row from a browser.
--
-- Same-site integrity comes from composite foreign keys: every parent has
-- unique (site, id) and every child points at (site, <parent>), so a row can
-- never reference another site's row.

create extension if not exists vector with schema extensions;

-- ---- people and topics ----

-- People the knowledge base talks about as owners and authors: imported from
-- Slack (later LinkedIn) or created when a member first acts. Never named in
-- a claim's text.
create table public.kb_people (
  id text primary key default private.new_id() check (id ~ '^[a-z0-9]{15}$'),
  site text not null references public.sites (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  email text not null default '' check (char_length(email) <= 320),
  slack_id text not null default '' check (char_length(slack_id) <= 64),
  -- Set when the person has a Propaganda account in this site.
  user_id uuid references auth.users (id) on delete set null,
  -- The one level above topic owners: may rule on any topic.
  top_authority boolean not null default false,
  created timestamptz not null default private.ms_now(),
  updated timestamptz not null default private.ms_now(),
  unique (site, id)
);
create unique index kb_people_site_user_key on public.kb_people (site, user_id) where user_id is not null;

-- A light tree, reorganised freely: claims point at topics, never at pages.
create table public.kb_topics (
  id text primary key default private.new_id() check (id ~ '^[a-z0-9]{15}$'),
  site text not null references public.sites (id) on delete cascade,
  parent text,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  created timestamptz not null default private.ms_now(),
  updated timestamptz not null default private.ms_now(),
  unique (site, id),
  unique (site, name),
  foreign key (site, parent) references public.kb_topics (site, id) on delete set null (parent)
);

-- CODEOWNERS for topics: an owner's word is final on the topic and everything under it.
create table public.kb_topic_owners (
  site text not null references public.sites (id) on delete cascade,
  topic text not null,
  person text not null,
  created timestamptz not null default private.ms_now(),
  primary key (topic, person),
  foreign key (site, topic) references public.kb_topics (site, id) on delete cascade,
  foreign key (site, person) references public.kb_people (site, id) on delete cascade
);

-- ---- what comes in ----

-- Everything the knowledge base can cite: a call, a document, a Slack thread,
-- a chat with the agent, a post version, a person clicking Remember, an
-- external signal. Immutable once extracted.
--
-- The text lives here (`body`), because quotes, search and context around a
-- quote need it in Postgres. The original file (a recording, a PDF, a scraped
-- page's HTML) lives in the object store, a private R2 bucket, under
-- `file_key`; the worker reads and writes it, browsers never do.
create table public.kb_sources (
  id text primary key default private.new_id() check (id ~ '^[a-z0-9]{15}$'),
  site text not null references public.sites (id) on delete cascade,
  kind text not null check (kind in ('person', 'document', 'call', 'slack', 'chat', 'post', 'signal')),
  -- Evidence weight, 1 strongest. A tier is weight, not authority: only people declare.
  tier smallint not null check (tier between 1 and 5),
  title text not null default '' check (char_length(title) <= 300),
  uri text not null default '' check (char_length(uri) <= 2000),
  -- kind = 'post': the version, whose text lives in post_versions.
  post_version text references public.post_versions (id) on delete cascade,
  body text not null default '' check (char_length(body) <= 2000000),
  -- The original in the object store: `<site>/<source id>/<name>`, '' when there is none.
  file_key text not null default '' check (char_length(file_key) <= 1024),
  file_type text not null default '' check (char_length(file_type) <= 255),
  file_size bigint not null default 0 check (file_size >= 0),
  -- Of the original (or the body): the same transcript or page pulled twice is stored once.
  sha256 text not null default '' check (sha256 = '' or sha256 ~ '^[0-9a-f]{64}$'),
  person text,
  occurred timestamptz,
  -- Extraction state. Signals are kept for ideas and coverage, not mined for claims.
  status text not null default 'pending' check (status in ('pending', 'extracted', 'skipped', 'failed')),
  created timestamptz not null default private.ms_now(),
  updated timestamptz not null default private.ms_now(),
  unique (site, id),
  foreign key (site, person) references public.kb_people (site, id) on delete set null (person),
  check ((kind = 'post') = (post_version is not null))
);
create index kb_sources_site_status_idx on public.kb_sources (site, status);
create unique index kb_sources_site_sha256_key on public.kb_sources (site, sha256) where sha256 <> '';

-- ---- proposals and decisions (pull requests and their reviews) ----

-- Every change to the knowledge base is a proposal: from Remember, the
-- first sweep, a new call, contesting a flag, a re-check or a chat. A
-- draft proposal with many changes is a branch (a repositioning): it lands
-- all at once or not at all.
create table public.kb_proposals (
  id text primary key default private.new_id() check (id ~ '^[a-z0-9]{15}$'),
  site text not null references public.sites (id) on delete cascade,
  origin text not null check (origin in ('remember', 'sweep', 'ingest', 'contest', 'recheck', 'chat')),
  status text not null default 'open'
    check (status in ('draft', 'open', 'escalated', 'admitted', 'rejected', 'withdrawn')),
  title text not null default '' check (char_length(title) <= 300),
  -- The description: what changes and why, in the person's words, then the agent's.
  summary text not null default '' check (char_length(summary) <= 20000),
  opened_by text,
  opened_by_agent text not null default '' check (char_length(opened_by_agent) <= 120),
  -- A contest answers a flag (foreign key added below the flags table), and
  -- names how both statements can be true.
  flag text,
  axis text not null default '' check (axis in ('', 'time', 'scope', 'audience', 'wording')),
  created timestamptz not null default private.ms_now(),
  updated timestamptz not null default private.ms_now(),
  closed timestamptz,
  unique (site, id),
  foreign key (site, opened_by) references public.kb_people (site, id) on delete set null (opened_by)
);
create index kb_proposals_site_status_idx on public.kb_proposals (site, status);

/**
 * The shape of a ruling's checks: [{check: "C8", result, reason}], one entry
 * per named check of the policy (H1-H4, C1-C11). C11 reports a severity.
 */
create function private.kb_checks_valid(p_checks jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_checks) = 'array' and not exists (
    select 1 from jsonb_array_elements(p_checks) e
     where jsonb_typeof(e) <> 'object'
        or coalesce(e ->> 'check', '') !~ '^(C([1-9]|1[01])|H[1-4])$'
        or coalesce(e ->> 'result', '') not in ('pass', 'weak', 'fail', 'escalate', 'patch', 'minor', 'major')
        or char_length(coalesce(e ->> 'reason', '')) > 2000)
$$;

-- The Guardian's (or an owner's) ruling on a proposal. Append-only: a
-- rejected proposal argued again gets a second decision, never an edit.
create table public.kb_decisions (
  id text primary key default private.new_id() check (id ~ '^[a-z0-9]{15}$'),
  site text not null references public.sites (id) on delete cascade,
  proposal text not null,
  verdict text not null check (verdict in ('admit', 'admit_contested', 'reject', 'escalate')),
  -- Why, in plain sentences. Shown to people; read by later agents.
  argument text not null check (char_length(argument) between 1 and 20000),
  -- The named checks and their results: [{check: "C8", result: pass|weak|fail|escalate, reason}].
  checks jsonb not null default '[]' check (private.kb_checks_valid(checks) and octet_length(checks::text) <= 50000),
  -- How much an admitted change moves meaning: patch (wording, no re-check),
  -- minor (narrower or broader), major (reversed or retracted).
  severity text not null default '' check (severity in ('', 'patch', 'minor', 'major')),
  -- The Guardian's model and rule set, or the person who ruled.
  agent text not null default '' check (char_length(agent) <= 120),
  policy_version integer,
  decided_by text,
  created timestamptz not null default private.ms_now(),
  unique (site, id),
  foreign key (site, proposal) references public.kb_proposals (site, id) on delete cascade,
  foreign key (site, decided_by) references public.kb_people (site, id) on delete set null (decided_by),
  check (agent <> '' or decided_by is not null)
);
create index kb_decisions_proposal_idx on public.kb_decisions (proposal);
create index kb_decisions_site_created_idx on public.kb_decisions (site, created);

-- ---- claims ----

-- One plain sentence that could be wrong, standalone ("Propaganda's Pro plan
-- includes 3 seats", not "It includes 3"). Never edited in meaning: a change
-- is a new claim that supersedes this one. Each row is a version, and posts
-- pin rows.
create table public.kb_claims (
  id text primary key default private.new_id() check (id ~ '^[a-z0-9]{15}$'),
  site text not null references public.sites (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 1000),
  status text not null check (status in ('settled', 'contested', 'superseded', 'retracted')),
  -- Where it holds: {"product": "...", "market": "...", "audience": "...", "channel": "..."}.
  -- Most reconciliations add scope here.
  scope jsonb not null default '{}' check (jsonb_typeof(scope) = 'object' and octet_length(scope::text) <= 4000),
  -- True in the world from / until (a dated post may stay as it was).
  valid_from date,
  valid_until date,
  -- Not public before this (a launch, an announcement): drafts may use it,
  -- published content is not checked against it yet.
  public_from timestamptz,
  -- Ask "still true?" after this date.
  review_after date,
  -- Optional "why we believe this", including argued reconciliations.
  rationale text not null default '' check (char_length(rationale) <= 4000),
  -- Set when a person declared it with Remember. The Guardian can only flag
  -- a remembered claim, never supersede or retract it on its own.
  remembered_by text,
  -- The decision that admitted it, and the one that retired it.
  decision text,
  retired_by text,
  -- Retrieval. 1024 dimensions (Qwen3-Embedding / BGE-M3 class), filled by the worker.
  embedding extensions.vector(1024),
  embedding_model text not null default '' check (char_length(embedding_model) <= 120),
  search tsvector generated always as (to_tsvector('simple'::regconfig, text)) stored,
  created timestamptz not null default private.ms_now(),
  retired timestamptz,
  unique (site, id),
  foreign key (site, remembered_by) references public.kb_people (site, id) on delete set null (remembered_by),
  foreign key (site, decision) references public.kb_decisions (site, id) on delete set null (decision),
  foreign key (site, retired_by) references public.kb_decisions (site, id) on delete set null (retired_by),
  check ((status in ('superseded', 'retracted')) = (retired is not null)),
  check (valid_until is null or valid_from is null or valid_until >= valid_from)
);
create index kb_claims_site_status_idx on public.kb_claims (site, status);
create index kb_claims_search_idx on public.kb_claims using gin (search);
create index kb_claims_embedding_idx on public.kb_claims
  using hnsw (embedding extensions.vector_cosine_ops);

create table public.kb_claim_topics (
  site text not null references public.sites (id) on delete cascade,
  claim text not null,
  topic text not null,
  primary key (claim, topic),
  foreign key (site, claim) references public.kb_claims (site, id) on delete cascade,
  foreign key (site, topic) references public.kb_topics (site, id) on delete cascade
);
create index kb_claim_topics_topic_idx on public.kb_claim_topics (topic);

-- Claim to claim. "contradicts" between two live claims is an open
-- contradiction inside the knowledge base: it counts against its grade until
-- one side is superseded, retracted, or the two are reconciled by scope.
create table public.kb_relationships (
  id text primary key default private.new_id() check (id ~ '^[a-z0-9]{15}$'),
  site text not null references public.sites (id) on delete cascade,
  from_claim text not null,
  to_claim text not null,
  kind text not null check (kind in ('supersedes', 'contradicts', 'refines', 'depends_on')),
  decision text,
  created timestamptz not null default private.ms_now(),
  unique (from_claim, to_claim, kind),
  foreign key (site, from_claim) references public.kb_claims (site, id) on delete cascade,
  foreign key (site, to_claim) references public.kb_claims (site, id) on delete cascade,
  foreign key (site, decision) references public.kb_decisions (site, id) on delete set null (decision),
  check (from_claim <> to_claim)
);
create index kb_relationships_to_idx on public.kb_relationships (to_claim);

-- A span of a source that supports or contradicts a claim. Quotes show
-- context around themselves from the source's body, by offset.
create table public.kb_evidence (
  id text primary key default private.new_id() check (id ~ '^[a-z0-9]{15}$'),
  site text not null references public.sites (id) on delete cascade,
  claim text not null,
  source text not null,
  quote text not null default '' check (char_length(quote) <= 4000),
  span_start integer check (span_start >= 0),
  span_end integer check (span_end >= span_start),
  stance text not null default 'supports' check (stance in ('supports', 'contradicts')),
  created timestamptz not null default private.ms_now(),
  foreign key (site, claim) references public.kb_claims (site, id) on delete cascade,
  foreign key (site, source) references public.kb_sources (site, id) on delete cascade
);
create index kb_evidence_claim_idx on public.kb_evidence (claim);
create index kb_evidence_source_idx on public.kb_evidence (source);

-- The changes a proposal makes, applied in order when it's admitted.
--   add        a new claim (text)
--   supersede  a new claim (text) replaces `target`
--   retract    `target` was wrong
--   relate     `target` -[relation]-> `other`; either side may instead be the
--              claim an earlier change of the same proposal adds
--              (`target_change`, `other_change`)
create table public.kb_changes (
  id text primary key default private.new_id() check (id ~ '^[a-z0-9]{15}$'),
  site text not null references public.sites (id) on delete cascade,
  proposal text not null,
  position integer not null default 0,
  op text not null check (op in ('add', 'supersede', 'retract', 'relate')),
  text text not null default '' check (char_length(text) <= 1000),
  target text,
  other text,
  relation text check (relation in ('contradicts', 'refines', 'depends_on')),
  scope jsonb not null default '{}' check (jsonb_typeof(scope) = 'object' and octet_length(scope::text) <= 4000),
  topics text[] not null default '{}',
  valid_from date,
  valid_until date,
  public_from timestamptz,
  rationale text not null default '' check (char_length(rationale) <= 4000),
  -- [{source, quote, span_start, span_end, stance}], copied to kb_evidence on admission.
  evidence jsonb not null default '[]' check (jsonb_typeof(evidence) = 'array' and octet_length(evidence::text) <= 50000),
  -- Set by the ruling: this change goes in contested even when the verdict
  -- is admit (the first sweep, a push back with one solid and one weak part).
  contested boolean not null default false,
  target_change text,
  other_change text,
  -- The claim this change produced, once applied.
  result text,
  created timestamptz not null default private.ms_now(),
  unique (site, id),
  foreign key (site, proposal) references public.kb_proposals (site, id) on delete cascade,
  foreign key (site, target_change) references public.kb_changes (site, id) on delete cascade,
  foreign key (site, other_change) references public.kb_changes (site, id) on delete cascade,
  foreign key (site, target) references public.kb_claims (site, id),
  foreign key (site, other) references public.kb_claims (site, id),
  foreign key (site, result) references public.kb_claims (site, id) on delete set null (result),
  check (case op
    when 'add' then text <> '' and target is null and target_change is null and other_change is null
    when 'supersede' then text <> '' and target is not null and target_change is null and other_change is null
    when 'retract' then target is not null and target_change is null and other_change is null
    when 'relate' then (target is null) <> (target_change is null) and (other is null) <> (other_change is null)
                       and relation is not null
  end)
);
create index kb_changes_proposal_idx on public.kb_changes (proposal, position);

-- ---- posts ----

-- The lockfile: which claims a post version relies on. Written by the
-- reviewing agent; both directions are one query on this table.
create table public.kb_post_claims (
  site text not null references public.sites (id) on delete cascade,
  post_version text not null references public.post_versions (id) on delete cascade,
  claim text not null,
  -- asserts and assumes trigger re-checks; mentions don't.
  reliance text not null check (reliance in ('asserts', 'assumes', 'mentions')),
  quote text not null default '' check (char_length(quote) <= 4000),
  agent text not null default '' check (char_length(agent) <= 120),
  created timestamptz not null default private.ms_now(),
  primary key (post_version, claim),
  foreign key (site, claim) references public.kb_claims (site, id) on delete cascade
);
create index kb_post_claims_claim_idx on public.kb_post_claims (claim);

-- ---- flags (the inbox) ----

--   contradiction  a post says something a live claim contradicts
--   recheck        a claim the post relies on was superseded or retracted;
--                  `batch` is the decision, so one change is one thread
--   kb_conflict    two live claims contradict each other
create table public.kb_flags (
  id text primary key default private.new_id() check (id ~ '^[a-z0-9]{15}$'),
  site text not null references public.sites (id) on delete cascade,
  kind text not null check (kind in ('contradiction', 'recheck', 'kb_conflict')),
  post text references public.posts (id) on delete cascade,
  post_version text references public.post_versions (id) on delete set null,
  claim text not null,
  other_claim text,
  quote text not null default '' check (char_length(quote) <= 4000),
  explanation text not null default '' check (char_length(explanation) <= 4000),
  suggested_action text not null default ''
    check (suggested_action in ('', 'leave', 'edit_wording', 'rewrite', 'dated_note', 'unpublish')),
  suggested_fix text not null default '' check (char_length(suggested_fix) <= 20000),
  batch text,
  assignee text,
  --   fixed        the content changed (the agent saw it)
  --   reconciled   the Guardian admitted a contest
  --   wont_fix     "true, not worth fixing": closed, still counts against the grade
  --   retracted    the content was taken down (a social image deleted, a post
  --                unpublished): closed, out of the grade since the content is gone
  --   cant_fix     set by object type (a sent email), never chosen; out of the grade
  --   cleared      a re-check: the agent read the post again and it still holds
  status text not null default 'open'
    check (status in ('open', 'snoozed', 'fixed', 'reconciled', 'wont_fix', 'retracted', 'cant_fix', 'duplicate', 'cleared')),
  duplicate_of text,
  snoozed_until timestamptz,
  due date,
  note text not null default '' check (char_length(note) <= 4000),
  closed_by text,
  -- When the agent last read the post for this flag. A re-check counts in the
  -- content grade only once it has (until then it may still clear).
  checked timestamptz,
  created timestamptz not null default private.ms_now(),
  updated timestamptz not null default private.ms_now(),
  closed timestamptz,
  unique (site, id),
  foreign key (site, claim) references public.kb_claims (site, id) on delete cascade,
  foreign key (site, other_claim) references public.kb_claims (site, id) on delete cascade,
  foreign key (site, batch) references public.kb_decisions (site, id) on delete set null (batch),
  foreign key (site, assignee) references public.kb_people (site, id) on delete set null (assignee),
  foreign key (site, closed_by) references public.kb_people (site, id) on delete set null (closed_by),
  foreign key (site, duplicate_of) references public.kb_flags (site, id) on delete set null (duplicate_of),
  check ((kind = 'kb_conflict') = (post is null)),
  check ((kind = 'kb_conflict') = (other_claim is not null)),
  check ((status in ('open', 'snoozed')) = (closed is null))
);
create index kb_flags_site_status_idx on public.kb_flags (site, status);
create index kb_flags_post_idx on public.kb_flags (post);
create index kb_flags_batch_idx on public.kb_flags (batch);

alter table public.kb_proposals
  add foreign key (site, flag) references public.kb_flags (site, id) on delete set null (flag);

-- ---- the Guardian's rules ----

-- The judgment rules, as a versioned text per site (policy as code). The
-- deterministic ones are in kb_guardian_decide below. Test cases live with
-- the worker.
create table public.kb_policies (
  id text primary key default private.new_id() check (id ~ '^[a-z0-9]{15}$'),
  site text not null references public.sites (id) on delete cascade,
  version integer not null check (version > 0),
  body text not null check (char_length(body) <= 200000),
  created timestamptz not null default private.ms_now(),
  unique (site, version)
);

-- ---- stamps, sites, append-only ----

do $$
declare
  t text;
begin
  foreach t in array array['kb_people', 'kb_topics', 'kb_sources', 'kb_proposals', 'kb_flags'] loop
    execute format('create trigger stamp before insert or update on public.%I
      for each row execute function private.stamp_created_updated()', t);
  end loop;
  foreach t in array array['kb_topic_owners', 'kb_decisions', 'kb_claims', 'kb_relationships',
                           'kb_evidence', 'kb_changes', 'kb_post_claims', 'kb_policies'] loop
    execute format('create trigger stamp before insert or update on public.%I
      for each row execute function private.stamp_created()', t);
  end loop;
  foreach t in array array['kb_people', 'kb_topics', 'kb_topic_owners', 'kb_sources', 'kb_proposals',
                           'kb_decisions', 'kb_claims', 'kb_claim_topics', 'kb_relationships',
                           'kb_evidence', 'kb_changes', 'kb_post_claims', 'kb_flags', 'kb_policies'] loop
    execute format('create trigger site_stays_put before update of site on public.%I
      for each row execute function private.site_stays_put()', t);
  end loop;
end
$$;

create function private.kb_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only.', tg_table_name using errcode = '42501';
end
$$;
create trigger append_only before update or delete on public.kb_decisions
  for each row when (pg_trigger_depth() = 0) execute function private.kb_append_only();
create trigger append_only before update or delete on public.kb_policies
  for each row when (pg_trigger_depth() = 0) execute function private.kb_append_only();

-- A claim's meaning never changes: only its status, retirement, rationale
-- and embedding may.
create function private.kb_claim_text_fixed() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.text is distinct from old.text or new.scope is distinct from old.scope
     or new.valid_from is distinct from old.valid_from or new.valid_until is distinct from old.valid_until then
    raise exception 'A claim''s meaning can''t be edited: supersede it.' using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger text_fixed before update on public.kb_claims
  for each row execute function private.kb_claim_text_fixed();

-- ---- access ----

do $$
declare
  t text;
begin
  foreach t in array array['kb_people', 'kb_topics', 'kb_topic_owners', 'kb_sources', 'kb_proposals',
                           'kb_decisions', 'kb_claims', 'kb_claim_topics', 'kb_relationships',
                           'kb_evidence', 'kb_changes', 'kb_post_claims', 'kb_flags', 'kb_policies'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy "members read" on public.%I for select to authenticated
      using (site in (select private.my_sites()))', t);
  end loop;
  -- Organising the knowledge base (people, topics, owners, tagging) is open
  -- to members. Claims themselves are not.
  foreach t in array array['kb_people', 'kb_topics', 'kb_topic_owners', 'kb_claim_topics'] loop
    execute format('grant insert, update, delete on public.%I to authenticated', t);
    execute format('create policy "members insert" on public.%I for insert to authenticated
      with check (site in (select private.my_sites()))', t);
    execute format('create policy "members update" on public.%I for update to authenticated
      using (site in (select private.my_sites())) with check (site in (select private.my_sites()))', t);
    execute format('create policy "members delete" on public.%I for delete to authenticated
      using (site in (select private.my_sites()))', t);
  end loop;
end
$$;

-- ---- helpers ----

/** The caller's person in a site, created from their account on first use. */
create function private.kb_me(p_site text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  pid text;
begin
  if p_site not in (select private.my_sites()) then
    raise exception 'Not a member of this site.' using errcode = '42501';
  end if;
  select id into pid from public.kb_people where site = p_site and user_id = uid;
  if pid is null then
    insert into public.kb_people (site, name, email, user_id)
    select p_site,
           coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), nullif(u.email, ''), 'Member'),
           coalesce(u.email, ''), uid
      from auth.users u where u.id = uid
    returning id into pid;
  end if;
  return pid;
end
$$;

/** A topic and all of its ancestors. */
create function private.kb_topic_lineage(p_topic text) returns setof text
language sql stable set search_path = '' as $$
  with recursive up(id, parent) as (
    select t.id, t.parent from public.kb_topics t where t.id = p_topic
    union
    select t.id, t.parent from public.kb_topics t join up on t.id = up.parent)
  select id from up
$$;

/** The owners of a claim: the owners of its topics and their ancestors. */
create function private.kb_claim_owners(p_claim text) returns setof text
language sql stable set search_path = '' as $$
  select distinct o.person
    from public.kb_claim_topics ct
    cross join lateral private.kb_topic_lineage(ct.topic) l(topic)
    join public.kb_topic_owners o on o.topic = l.topic
   where ct.claim = p_claim
$$;

/** May this person rule on this claim: an owner of it, or the top authority. */
create function private.kb_may_rule(p_person text, p_claim text) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from public.kb_people where id = p_person and top_authority)
      or p_person in (select private.kb_claim_owners(p_claim))
$$;

/**
 * Queue re-checks for the posts relying on a claim that was just superseded
 * or retracted: one flag per post, grouped under the decision (one thread).
 */
create function private.kb_queue_rechecks(p_claim text, p_decision text) returns void
language sql set search_path = '' as $$
  insert into public.kb_flags (site, kind, post, post_version, claim, quote, batch, assignee)
  select distinct on (v.post) pc.site, 'recheck', v.post, v.id, pc.claim, pc.quote, p_decision,
         (select o from private.kb_claim_owners(p_claim) o limit 1)
    from public.kb_post_claims pc
    join public.post_versions v on v.id = pc.post_version
   where pc.claim = p_claim and pc.reliance in ('asserts', 'assumes')
   order by v.post, v.version desc
$$;

/** Apply an admitted proposal's changes, in order. */
create function private.kb_apply(p_proposal text, p_decision text, p_status text) returns void
language plpgsql set search_path = '' as $$
declare
  p public.kb_proposals;
  d public.kb_decisions;
  c public.kb_changes;
  new_claim text;
  rel_from text;
  rel_to text;
  e jsonb;
begin
  select * into p from public.kb_proposals where id = p_proposal;
  select * into d from public.kb_decisions where id = p_decision;
  for c in select * from public.kb_changes where proposal = p_proposal order by position, created loop
    if c.op in ('supersede', 'retract') then
      if not exists (select 1 from public.kb_claims where id = c.target and status in ('settled', 'contested')) then
        raise exception 'Claim % is no longer live: re-run the proposal against the current knowledge base.', c.target
          using errcode = '40001';
      end if;
      -- Remembered claims and owned topics: only an owner or the top authority.
      if (d.decided_by is null or not private.kb_may_rule(d.decided_by, c.target))
         and (exists (select 1 from public.kb_claims where id = c.target and remembered_by is not null)
              or exists (select private.kb_claim_owners(c.target))) then
        raise exception 'Claim % is remembered or owned: escalate to its owner.', c.target using errcode = '42501';
      end if;
    end if;

    new_claim := null;
    if c.op in ('add', 'supersede') then
      insert into public.kb_claims (site, text, status, scope, valid_from, valid_until, public_from,
                                    rationale, remembered_by, decision)
      values (c.site, c.text, case when c.contested then 'contested' else p_status end, c.scope, c.valid_from, c.valid_until, c.public_from, c.rationale,
              case when p.origin = 'remember' then p.opened_by end, p_decision)
      returning id into new_claim;
      insert into public.kb_claim_topics (site, claim, topic)
      select c.site, new_claim, unnest(c.topics);
      for e in select * from jsonb_array_elements(c.evidence) loop
        insert into public.kb_evidence (site, claim, source, quote, span_start, span_end, stance)
        values (c.site, new_claim, e ->> 'source', coalesce(e ->> 'quote', ''),
                (e ->> 'span_start')::integer, (e ->> 'span_end')::integer, coalesce(e ->> 'stance', 'supports'));
      end loop;
      update public.kb_changes set result = new_claim where id = c.id;
    end if;

    if c.op = 'supersede' then
      insert into public.kb_relationships (site, from_claim, to_claim, kind, decision)
      values (c.site, new_claim, c.target, 'supersedes', p_decision);
      -- Topics carry over unless the change names new ones.
      if cardinality(c.topics) = 0 then
        insert into public.kb_claim_topics (site, claim, topic)
        select site, new_claim, topic from public.kb_claim_topics where claim = c.target;
      end if;
    end if;

    if c.op in ('supersede', 'retract') then
      update public.kb_claims
         set status = case c.op when 'supersede' then 'superseded' else 'retracted' end,
             retired = private.ms_now(), retired_by = p_decision
       where id = c.target;
      if d.severity <> 'patch' then
        perform private.kb_queue_rechecks(c.target, p_decision);
      end if;
    end if;

    if c.op = 'relate' then
      -- A side added by this proposal is the claim its change produced (already applied: it comes earlier).
      rel_from := coalesce(c.target, (select result from public.kb_changes where id = c.target_change));
      rel_to := coalesce(c.other, (select result from public.kb_changes where id = c.other_change));
      if rel_from is null or rel_to is null then
        raise exception 'A relationship names a change that adds no claim, or comes later.' using errcode = '22023';
      end if;
      insert into public.kb_relationships (site, from_claim, to_claim, kind, decision)
      values (c.site, rel_from, rel_to, c.relation, p_decision)
      on conflict do nothing;
      if c.relation = 'contradicts' then
        insert into public.kb_flags (site, kind, claim, other_claim, explanation, batch, assignee)
        values (c.site, 'kb_conflict', rel_from, rel_to, d.argument, p_decision,
                coalesce((select o from private.kb_claim_owners(rel_to) o limit 1),
                         (select o from private.kb_claim_owners(rel_from) o limit 1)));
      end if;
    end if;
  end loop;
end
$$;

/** Record a ruling and carry it out. Admissions in a site are serialized. */
create function private.kb_rule(
  p_proposal text, p_verdict text, p_argument text, p_checks jsonb, p_severity text,
  p_agent text, p_policy_version integer, p_decided_by text,
  p_relations jsonb default '[]', p_contested text[] default '{}'
) returns text
language plpgsql set search_path = '' as $$
declare
  p public.kb_proposals;
  did text;
  r jsonb;
  next_pos integer;
begin
  select * into p from public.kb_proposals where id = p_proposal for update;
  if p.id is null then
    raise exception 'No such proposal.' using errcode = 'PT404';
  end if;
  perform pg_advisory_xact_lock(hashtext('kb:' || p.site));
  if p.status not in ('open', 'escalated') then
    raise exception 'This proposal is %, not open.', p.status using errcode = '22023';
  end if;
  -- The Guardian only flags a remembered claim: a Remember is never rejected.
  if p.origin = 'remember' and p_verdict = 'reject' then
    raise exception 'A remembered claim can''t be rejected: admit it and flag what it contradicts.'
      using errcode = '22023';
  end if;

  insert into public.kb_decisions (site, proposal, verdict, argument, checks, severity, agent, policy_version, decided_by)
  values (p.site, p.id, p_verdict, p_argument, coalesce(p_checks, '[]'), coalesce(p_severity, ''),
          coalesce(p_agent, ''), p_policy_version, p_decided_by)
  returning id into did;

  if p_verdict in ('admit', 'admit_contested') then
    -- What the ruling found on the way: changes it admits contested, and the
    -- relationships it saw between this proposal's claims and the knowledge
    -- base: [{change | claim, other | other_change, relation}].
    update public.kb_changes set contested = true
     where proposal = p.id and id = any (coalesce(p_contested, '{}'));
    select coalesce(max(position), 0) + 1 into next_pos from public.kb_changes where proposal = p.id;
    for r in select * from jsonb_array_elements(coalesce(p_relations, '[]')) loop
      insert into public.kb_changes (site, proposal, position, op, target, target_change, other, other_change, relation)
      values (p.site, p.id, next_pos, 'relate', r ->> 'claim', r ->> 'change', r ->> 'other', r ->> 'other_change',
              r ->> 'relation');
      next_pos := next_pos + 1;
    end loop;
    perform private.kb_apply(p.id, did, case p_verdict when 'admit' then 'settled' else 'contested' end);
    update public.kb_proposals set status = 'admitted', closed = private.ms_now() where id = p.id;
    if p.flag is not null then
      update public.kb_flags set status = 'reconciled', closed = private.ms_now()
       where id = p.flag and status in ('open', 'snoozed');
    end if;
  elsif p_verdict = 'reject' then
    update public.kb_proposals set status = 'rejected', closed = private.ms_now() where id = p.id;
  else
    update public.kb_proposals set status = 'escalated' where id = p.id;
  end if;
  return did;
end
$$;

-- ---- what people and the Guardian call ----

/** Remember: a person declares a claim. Opens a proposal the Guardian can only admit. */
create function public.kb_remember(
  p_site text, p_text text, p_topics text[] default '{}', p_scope jsonb default '{}'
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me text := private.kb_me(p_site);
  src text;
  pid text;
begin
  insert into public.kb_sources (site, kind, tier, title, body, person, occurred, status)
  values (p_site, 'person', 1, 'Remembered', p_text, me, private.ms_now(), 'extracted')
  returning id into src;
  insert into public.kb_proposals (site, origin, status, title, opened_by)
  values (p_site, 'remember', 'open', left(p_text, 300), me)
  returning id into pid;
  insert into public.kb_changes (site, proposal, op, text, topics, scope, evidence)
  values (p_site, pid, 'add', p_text, coalesce(p_topics, '{}'), coalesce(p_scope, '{}'),
          jsonb_build_array(jsonb_build_object('source', src, 'quote', p_text)));
  return pid;
end
$$;

/**
 * Contest a flag ("this isn't inconsistent, because..."). Opens a draft
 * proposal with the person's sentence; the agent adds the changes and the
 * argument, and the person submits it with kb_submit.
 */
create function public.kb_contest(p_flag text, p_reason text, p_axis text default '') returns text
language plpgsql security definer set search_path = '' as $$
declare
  f public.kb_flags;
  pid text;
begin
  select * into f from public.kb_flags where id = p_flag;
  if f.id is null or f.site not in (select private.my_sites()) then
    raise exception 'No such flag.' using errcode = 'PT404';
  end if;
  insert into public.kb_proposals (site, origin, status, title, summary, opened_by, flag, axis)
  values (f.site, 'contest', 'draft', 'Contest a flag', p_reason, private.kb_me(f.site), f.id, coalesce(p_axis, ''))
  returning id into pid;
  return pid;
end
$$;

/** Submit a draft (a contest, or a branch) to the Guardian. */
create function public.kb_submit(p_proposal text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.kb_proposals;
begin
  select * into p from public.kb_proposals where id = p_proposal;
  if p.id is null or p.site not in (select private.my_sites()) then
    raise exception 'No such proposal.' using errcode = 'PT404';
  end if;
  if p.status <> 'draft' then
    raise exception 'Only a draft can be submitted.' using errcode = '22023';
  end if;
  update public.kb_proposals set status = 'open' where id = p.id;
end
$$;

/** Close or snooze a flag by hand: wont_fix, retracted, snoozed or duplicate. */
create function public.kb_close_flag(
  p_flag text, p_status text, p_note text default '', p_until timestamptz default null,
  p_duplicate_of text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  f public.kb_flags;
begin
  select * into f from public.kb_flags where id = p_flag;
  if f.id is null or f.site not in (select private.my_sites()) then
    raise exception 'No such flag.' using errcode = 'PT404';
  end if;
  if p_status not in ('wont_fix', 'retracted', 'snoozed', 'duplicate') then
    raise exception 'A flag is closed by hand only as wont_fix, retracted, snoozed or duplicate.' using errcode = '22023';
  end if;
  update public.kb_flags
     set status = p_status, note = coalesce(p_note, ''), snoozed_until = p_until,
         duplicate_of = p_duplicate_of, closed_by = private.kb_me(f.site),
         closed = case when p_status = 'snoozed' then null else private.ms_now() end
   where id = f.id;
end
$$;

/** An owner (or the top authority) rules on an open or escalated proposal. */
create function public.kb_owner_rule(p_proposal text, p_verdict text, p_argument text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  p public.kb_proposals;
  me text;
begin
  select * into p from public.kb_proposals where id = p_proposal;
  if p.id is null or p.site not in (select private.my_sites()) then
    raise exception 'No such proposal.' using errcode = 'PT404';
  end if;
  me := private.kb_me(p.site);
  if p_verdict not in ('admit', 'admit_contested', 'reject') then
    raise exception 'An owner admits or rejects.' using errcode = '22023';
  end if;
  -- Every claim the proposal retires must be one this person may rule on
  -- (kb_apply checks it again, for the claims that are owned).
  if exists (select 1 from public.kb_changes c where c.proposal = p.id and c.target is not null
              and not private.kb_may_rule(me, c.target))
     and not exists (select 1 from public.kb_people where id = me and top_authority) then
    raise exception 'Only an owner of these topics, or the top authority, can rule here.' using errcode = '42501';
  end if;
  return private.kb_rule(p.id, p_verdict, p_argument, '[]', 'minor', '', null, me);
end
$$;

/** The Guardian's ruling. Its worker calls this with the service key; browsers can't. */
create function public.kb_guardian_decide(
  p_proposal text, p_verdict text, p_argument text, p_checks jsonb, p_severity text,
  p_agent text, p_policy_version integer, p_relations jsonb default '[]', p_contested text[] default '{}'
) returns text
language sql security definer set search_path = '' as $$
  select private.kb_rule(p_proposal, p_verdict, p_argument, p_checks, p_severity, p_agent, p_policy_version, null,
                         p_relations, p_contested)
$$;

revoke execute on function public.kb_guardian_decide(text, text, text, jsonb, text, text, integer, jsonb, text[])
  from public, anon, authenticated;
grant execute on function public.kb_guardian_decide(text, text, text, jsonb, text, text, integer, jsonb, text[]) to service_role;
revoke execute on function public.kb_remember(text, text, text[], jsonb), public.kb_contest(text, text, text),
  public.kb_submit(text), public.kb_close_flag(text, text, text, timestamptz, text),
  public.kb_owner_rule(text, text, text) from public, anon;
grant execute on function public.kb_remember(text, text, text[], jsonb), public.kb_contest(text, text, text),
  public.kb_submit(text), public.kb_close_flag(text, text, text, timestamptz, text),
  public.kb_owner_rule(text, text, text) to authenticated, service_role;

-- ---- retrieval ----

/**
 * Hybrid search over a site's claims: keyword (full text) and meaning
 * (embedding), merged by reciprocal rank. Agents call this with a passage of
 * a post or a question; they never load the whole knowledge base. Runs with
 * the caller's rights, so members see only their sites.
 */
create function public.kb_search(
  p_site text, p_query text, p_embedding extensions.vector(1024) default null, p_limit integer default 20,
  p_statuses text[] default array['settled', 'contested'],
  -- Match any word instead of all of them: what agents use to search with a
  -- whole passage, ranked by how many words a claim shares with it.
  p_any boolean default false
) returns table (id text, text text, status text, scope jsonb, topics text[], score double precision)
language sql stable set search_path = '' as $$
  with keyword as (
    select c.id, row_number() over (order by ts_rank_cd(c.search, q) desc) as r
      from public.kb_claims c,
           (select case when p_any
                     then replace(plainto_tsquery('simple'::regconfig, p_query)::text, ' & ', ' | ')
                     else '' end as any_q) a,
           lateral (select case when p_any and a.any_q <> '' then a.any_q::tsquery
                                else websearch_to_tsquery('simple'::regconfig, p_query) end as q) qq(q)
     where c.site = p_site and c.status = any (p_statuses) and c.search @@ q
     order by r
     limit 50),
  meaning as (
    select c.id, row_number() over (order by c.embedding operator(extensions.<=>) p_embedding) as r
      from public.kb_claims c
     where p_embedding is not null and c.site = p_site and c.status = any (p_statuses) and c.embedding is not null
     order by c.embedding operator(extensions.<=>) p_embedding
     limit 50),
  fused as (
    select coalesce(k.id, m.id) as id,
           coalesce(1.0 / (60 + k.r), 0) + coalesce(1.0 / (60 + m.r), 0) as score
      from keyword k full join meaning m on m.id = k.id)
  select c.id, c.text, c.status, c.scope,
         array(select t.name from public.kb_claim_topics ct join public.kb_topics t on t.id = ct.topic
                where ct.claim = c.id order by t.name),
         f.score
    from fused f join public.kb_claims c on c.id = f.id
   order by f.score desc
   limit p_limit
$$;
grant execute on function public.kb_search(text, text, extensions.vector, integer, text[], boolean) to authenticated, service_role;

-- ---- grades (first version: shares, fixed bands; calibrate on real projects) ----

create function private.kb_letter(ok_share numeric) returns text
language sql immutable set search_path = '' as $$
  select case when ok_share >= 0.95 then 'A' when ok_share >= 0.85 then 'B'
              when ok_share >= 0.70 then 'C' when ok_share >= 0.50 then 'D' else 'F' end
$$;

-- Content: share of published posts with no open, snoozed or won't-fix flag.
-- Can't-fix, cleared and fixed flags stay out, and an open re-check counts
-- only once the agent has read the post (until then it may still clear).
create view public.kb_content_grade with (security_invoker = true) as
select p.site,
       count(*) as posts,
       count(*) filter (where f.post is not null) as flagged,
       private.kb_letter(1 - count(*) filter (where f.post is not null)::numeric / count(*)) as grade
  from public.posts p
  left join (select distinct post from public.kb_flags
              where kind in ('contradiction', 'recheck') and status in ('open', 'snoozed', 'wont_fix')
                and (kind = 'contradiction' or status = 'wont_fix' or checked is not null)) f
    on f.post = p.id
 where p.status = 'published'
 group by p.site;

-- Knowledge base: share of live claims that are settled and in no open
-- contradiction, each weighted by 1 + the posts relying on it (so splitting
-- claims into trivial ones doesn't game it).
create view public.kb_grade with (security_invoker = true) as
with live as (
  select c.id, c.site, c.status,
         1 + (select count(distinct v.post) from public.kb_post_claims pc
                join public.post_versions v on v.id = pc.post_version
               where pc.claim = c.id and pc.reliance in ('asserts', 'assumes')) as weight,
         exists (select 1 from public.kb_relationships r
                   join public.kb_claims o on o.id = case when r.from_claim = c.id then r.to_claim else r.from_claim end
                  where r.kind = 'contradicts' and c.id in (r.from_claim, r.to_claim)
                    and o.status in ('settled', 'contested')) as in_conflict
    from public.kb_claims c
   where c.status in ('settled', 'contested'))
select site,
       count(*) as claims,
       count(*) filter (where status = 'contested') as contested,
       count(*) filter (where in_conflict) as in_conflict,
       private.kb_letter(sum(weight) filter (where status = 'settled' and not in_conflict)::numeric / sum(weight)) as grade,
       -- The weights behind the letter, so a page can say how far the next band is.
       sum(weight) as total_weight,
       coalesce(sum(weight) filter (where status = 'contested' or in_conflict), 0) as bad_weight
  from live
 group by site;

grant select on public.kb_content_grade, public.kb_grade to authenticated, service_role;

-- ---- read views for the knowledge base pages ----
-- The claims list pages, filters and sorts on the server (never the whole
-- knowledge base in the browser), so the weight, post count and conflict
-- state each row shows are columns PostgREST can order by. Evidence shows the
-- text around a quote, cut on the server so a 2 MB transcript never travels
-- to show 320 characters.

-- One row per claim with what the list shows. Same weight and conflict rules as kb_grade.
create view public.kb_claim_list with (security_invoker = true) as
select c.id, c.site, c.text, c.status, c.valid_from, c.created,
       array(select ct.topic from public.kb_claim_topics ct where ct.claim = c.id) as topics,
       1 + (select count(distinct v.post) from public.kb_post_claims pc
              join public.post_versions v on v.id = pc.post_version
             where pc.claim = c.id and pc.reliance in ('asserts', 'assumes')) as weight,
       (select count(distinct v.post) from public.kb_post_claims pc
          join public.post_versions v on v.id = pc.post_version
         where pc.claim = c.id) as post_count,
       c.status in ('settled', 'contested') and exists (
         select 1 from public.kb_relationships r
           join public.kb_claims o on o.id = case when r.from_claim = c.id then r.to_claim else r.from_claim end
          where r.kind = 'contradicts' and c.id in (r.from_claim, r.to_claim)
            and o.status in ('settled', 'contested')) as in_conflict
  from public.kb_claims c;

-- Evidence with up to 160 characters of its source on each side of the quote.
create view public.kb_evidence_context with (security_invoker = true) as
select e.id, e.site, e.claim, e.source, e.quote, e.stance,
       substr(s.body, greatest(1, x.at - 160), least(160, x.at - 1)) as before,
       substr(s.body, x.at + char_length(e.quote), 160) as after
  from public.kb_evidence e
  join public.kb_sources s on s.id = e.source
  cross join lateral (
    select coalesce(e.span_start + 1, nullif(strpos(s.body, e.quote), 0), 1) as at) x;

grant select on public.kb_claim_list, public.kb_evidence_context to authenticated, service_role;

-- The internals are reached only through the functions above.
revoke execute on function private.kb_rule(text, text, text, jsonb, text, text, integer, text, jsonb, text[]),
  private.kb_apply(text, text, text), private.kb_queue_rechecks(text, text), private.kb_me(text)
  from public, anon, authenticated;
