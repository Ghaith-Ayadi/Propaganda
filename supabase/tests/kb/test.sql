-- Walks the knowledge base and its agents' functions through their main flows
-- on a throwaway database (run.sh applies every migration first). Every check
-- raises on failure.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

-- Two accounts, two sites.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'ayadi@example.com', '{"full_name": "Ayadi"}'),
  ('00000000-0000-0000-0000-00000000000b', 'sam@example.com', '{"full_name": "Sam"}'),
  ('00000000-0000-0000-0000-00000000000c', 'eve@example.com', '{}');
insert into public.sites (id, name, slug) values
  ('kbsite000000001', 'Acme', 'acme'), ('kbsite000000002', 'Other', 'other');
insert into public.site_members (site, user_id, role) values
  ('kbsite000000001', '00000000-0000-0000-0000-00000000000a', 'owner'),
  ('kbsite000000001', '00000000-0000-0000-0000-00000000000b', 'editor'),
  ('kbsite000000002', '00000000-0000-0000-0000-00000000000c', 'owner');
insert into public.posts (id, site, title, status) values
  ('kbpost000000001', 'kbsite000000001', 'Why Acme', 'published'),
  ('kbpost000000002', 'kbsite000000001', 'Acme for teams', 'published'),
  ('kbpost000000003', 'kbsite000000001', 'Unrelated', 'published');
insert into public.post_versions (id, site, post, version, content, created_by) values
  ('kbvers000000001', 'kbsite000000001', 'kbpost000000001', 1, 'Acme is a CMS for writers.', 'user'),
  ('kbvers000000002', 'kbsite000000001', 'kbpost000000002', 1, 'Acme is a CMS. Teams love it.', 'user'),
  ('kbvers000000003', 'kbsite000000001', 'kbpost000000003', 1, 'Nothing here.', 'user');

-- ---- as Ayadi: organise, then Remember ----
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into public.kb_topics (id, site, name) values ('kbtopic00000001', 'kbsite000000001', 'Positioning');
insert into public.kb_topics (id, site, name, parent) values ('kbtopic00000002', 'kbsite000000001', 'Tagline', 'kbtopic00000001');
select public.kb_remember('kbsite000000001', 'Acme is a CMS for teams who write a lot.', array['kbtopic00000002']) as remember \gset
-- Ayadi becomes the owner of Positioning (and so of Tagline under it).
insert into public.kb_topic_owners (site, topic, person)
select 'kbsite000000001', 'kbtopic00000001', id from public.kb_people where user_id = auth.uid();
-- Members can't write claims or call the Guardian.
do $$ begin
  insert into public.kb_claims (site, text, status) values ('kbsite000000001', 'Sneaky', 'settled');
  raise exception 'FAIL: a member wrote a claim';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform public.kb_guardian_decide('x', 'admit', 'x', '[]', '', 'x', 1);
  raise exception 'FAIL: a member called the Guardian';
exception when insufficient_privilege then null; end $$;
commit;

-- ---- the Guardian (service_role): a Remember can't be rejected; admit it ----
begin;
set local role service_role;
do $$ begin
  perform public.kb_guardian_decide((select id from public.kb_proposals where origin = 'remember'),
    'reject', 'No.', '[]', '', 'guardian-test', 1);
  raise exception 'FAIL: a Remember was rejected';
exception when invalid_parameter_value then null; end $$;
select public.kb_guardian_decide(:'remember', 'admit', 'Declared by its owner.',
  '[{"check": "C7", "result": "pass", "reason": "Nothing like it yet."}]', 'minor', 'guardian-test', 1);
-- The reviewing agent links both posts to it, at their versions.
insert into public.kb_post_claims (site, post_version, claim, reliance, quote, agent)
select 'kbsite000000001', v, c.id, 'asserts', 'Acme is a CMS', 'reviewer-test'
  from public.kb_claims c, unnest(array['kbvers000000001', 'kbvers000000002']) v;
commit;

do $$ begin
  if (select count(*) from public.kb_claims where status = 'settled' and remembered_by is not null) <> 1 then
    raise exception 'FAIL: the remembered claim is not settled'; end if;
  if (select count(*) from public.kb_evidence) <> 1 then raise exception 'FAIL: evidence missing'; end if;
  if (select count(*) from public.kb_claim_topics) <> 1 then raise exception 'FAIL: topic missing'; end if;
end $$;

-- ---- a sweep proposes a repositioning: the Guardian alone can't retire an owned, remembered claim ----
insert into public.kb_proposals (id, site, origin, title, opened_by_agent)
values ('kbprop000000001', 'kbsite000000001', 'chat', 'We are a knowledge management company', 'chat-test');
insert into public.kb_changes (site, proposal, op, text, target)
select 'kbsite000000001', 'kbprop000000001', 'supersede',
       'Acme keeps a company''s content consistent with what it knows.', id
  from public.kb_claims where status = 'settled';
do $$ begin
  perform public.kb_guardian_decide('kbprop000000001', 'admit', 'Fits.', '[]', 'major', 'guardian-test', 1);
  raise exception 'FAIL: the Guardian retired an owned claim';
exception when insufficient_privilege then null; end $$;
select public.kb_guardian_decide('kbprop000000001', 'escalate', 'A change of position: needs the owner.', '[]', 'major', 'guardian-test', 1);

-- Sam (not an owner) can't rule; Ayadi (owner) can.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  perform public.kb_owner_rule('kbprop000000001', 'admit', 'I like it.');
  raise exception 'FAIL: a non-owner ruled';
exception when insufficient_privilege then null; end $$;
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select public.kb_owner_rule('kbprop000000001', 'admit', 'This is our new positioning.') as ruling \gset
commit;

do $$ begin
  if (select count(*) from public.kb_claims where status = 'superseded' and retired is not null) <> 1 then
    raise exception 'FAIL: old claim not superseded'; end if;
  if (select count(*) from public.kb_relationships where kind = 'supersedes') <> 1 then
    raise exception 'FAIL: supersedes relationship missing'; end if;
  -- The new claim inherited the topic.
  if (select count(*) from public.kb_claim_topics ct join public.kb_claims c on c.id = ct.claim where c.status = 'settled') <> 1 then
    raise exception 'FAIL: topics not carried over'; end if;
  -- One re-check per relying post, both in one batch, assigned to the owner.
  if (select count(*) from public.kb_flags where kind = 'recheck' and status = 'open' and assignee is not null) <> 2
     or (select count(distinct batch) from public.kb_flags where kind = 'recheck') <> 1 then
    raise exception 'FAIL: re-checks not queued as one batch'; end if;
  if (select status from public.kb_proposals where id = 'kbprop000000001') <> 'admitted' then
    raise exception 'FAIL: proposal not admitted'; end if;
end $$;

-- A claim's meaning can't be edited, and decisions are append-only.
do $$ begin
  update public.kb_claims set text = 'edited' where status = 'settled';
  raise exception 'FAIL: claim text edited';
exception when insufficient_privilege then null; end $$;
do $$ begin
  update public.kb_decisions set argument = 'rewritten';
  raise exception 'FAIL: decision edited';
exception when insufficient_privilege then null; end $$;

-- ---- contest a re-check flag, reconciled by the Guardian ----
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select public.kb_contest((select id from public.kb_flags where post = 'kbpost000000001'),
  'That post is from 2024, when we were a CMS.') as contest \gset
commit;
-- The agent drafts the reconciliation (a dated claim), Sam submits, the Guardian admits it contested.
insert into public.kb_changes (site, proposal, op, text, valid_until, topics)
values ('kbsite000000001', :'contest', 'add', 'Until 2026, Acme was positioned as a CMS for teams.', '2026-10-05',
        array['kbtopic00000001']);
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select public.kb_submit(:'contest');
commit;
select public.kb_guardian_decide(:'contest', 'admit_contested', 'Dated, but only argued from one post.', '[]', 'minor', 'guardian-test', 1);
do $$ begin
  if (select status from public.kb_flags where post = 'kbpost000000001') <> 'reconciled' then
    raise exception 'FAIL: flag not reconciled'; end if;
  if (select count(*) from public.kb_claims where status = 'contested') <> 1 then
    raise exception 'FAIL: contested claim missing'; end if;
end $$;

-- ---- won't fix, and the grades ----
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select public.kb_close_flag((select id from public.kb_flags where post = 'kbpost000000002'), 'wont_fix', 'Old post, low traffic.');
-- Unpublish the third post and retract its (hand-made) flag: it leaves the grade.
reset role;
insert into public.kb_flags (site, kind, post, claim)
select 'kbsite000000001', 'contradiction', 'kbpost000000003', id from public.kb_claims where status = 'settled';
update public.posts set status = 'draft' where id = 'kbpost000000003';
set local role authenticated;
select public.kb_close_flag((select id from public.kb_flags where post = 'kbpost000000003'), 'retracted', 'Taken down.');
do $$ begin
  if (select closed from public.kb_flags where post = 'kbpost000000003') is null then
    raise exception 'FAIL: retracted flag still open'; end if;
  perform public.kb_close_flag((select id from public.kb_flags where post = 'kbpost000000002'), 'cant_fix');
  raise exception 'FAIL: cant_fix chosen by hand';
exception when invalid_parameter_value then null; end $$;
-- Content: 2 published, 1 still counts (won't fix): 50% -> D. KB: 1 settled + 1 contested.
do $$ begin
  if (select grade from public.kb_content_grade where site = 'kbsite000000001') <> 'D' then
    raise exception 'FAIL: content grade %', (select row(g.*) from public.kb_content_grade g); end if;
  if (select contested from public.kb_grade where site = 'kbsite000000001') <> 1 then
    raise exception 'FAIL: kb grade %', (select row(g.*) from public.kb_grade g); end if;
end $$;
commit;

-- ---- the same original stored once per site ----
insert into public.kb_sources (site, kind, tier, title, body, file_key, file_type, file_size, sha256)
values ('kbsite000000001', 'call', 2, 'Sales call', 'Transcript...', 'kbsite000000001/x/call.vtt', 'text/vtt', 12,
        repeat('a', 64));
do $$ begin
  insert into public.kb_sources (site, kind, tier, title, sha256) values ('kbsite000000001', 'call', 2, 'Again', repeat('a', 64));
  raise exception 'FAIL: duplicate original stored twice';
exception when unique_violation then null; end $$;

-- ---- retrieval ----
-- Fake embeddings: one direction per claim, so the nearest is unambiguous.
update public.kb_claims set embedding = array_fill(0.0::real, array[1024])::extensions.vector;
update public.kb_claims c set embedding = (select array_agg(case when i = n then 1.0::real else 0.0::real end order by i)
  from generate_series(1, 1024) i)::extensions.vector
  from (select id, row_number() over (order by created) as n from public.kb_claims) x where x.id = c.id;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$
declare
  hit text;
begin
  select text into hit from public.kb_search('kbsite000000001', 'consistent content');
  if hit not like 'Acme keeps%' then raise exception 'FAIL: keyword search found %', hit; end if;
  -- By meaning only: an embedding pointing at the third claim (the dated one).
  select text into hit from public.kb_search('kbsite000000001', 'zzz',
    (select array_agg(case when i = 3 then 1.0::real else 0.0::real end order by i) from generate_series(1, 1024) i)::extensions.vector);
  if hit not like 'Until 2026%' then raise exception 'FAIL: vector search found %', hit; end if;
  -- Superseded claims are left out by default.
  if exists (select 1 from public.kb_search('kbsite000000001', 'CMS teams write') where status = 'superseded') then
    raise exception 'FAIL: superseded claim returned'; end if;
end $$;
commit;

-- ---- the Guardian's ruling: checks have a fixed shape ----
insert into public.kb_proposals (id, site, origin, title, opened_by_agent)
values ('kbprop000000002', 'kbsite000000001', 'ingest', 'From a call', 'listener-test');
do $$ begin
  perform public.kb_guardian_decide('kbprop000000002', 'reject', 'No.', '[{"name": "C1", "result": "warn"}]', '', 'g', 1);
  raise exception 'FAIL: checks of the wrong shape were stored';
exception when check_violation then null; end $$;

-- ---- a Remember that contradicts a settled claim: admitted, related, flagged for the owner ----
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select public.kb_remember('kbsite000000001', 'Acme is a CMS for solo writers.') as remember2 \gset
commit;
select id as remember2_change from public.kb_changes where proposal = :'remember2' \gset
select id as positioning from public.kb_claims where text like 'Acme keeps%' \gset
select public.kb_guardian_decide(:'remember2', 'admit', 'Admitted: a Remember. It contradicts the positioning.',
  '[{"check": "C8", "result": "pass", "reason": "Contradicts the positioning; the owner decides."}]', '', 'g', 1,
  jsonb_build_array(jsonb_build_object('change', :'remember2_change', 'other', :'positioning', 'relation', 'contradicts')));
do $$ begin
  if (select count(*) from public.kb_relationships r join public.kb_claims c on c.id = r.from_claim
       where r.kind = 'contradicts' and c.text = 'Acme is a CMS for solo writers.') <> 1 then
    raise exception 'FAIL: the Remember is not related to the claim it contradicts'; end if;
  if (select count(*) from public.kb_flags where kind = 'kb_conflict' and status = 'open' and assignee is not null) <> 1 then
    raise exception 'FAIL: no conflict flag for the owner'; end if;
  if (select in_conflict from public.kb_grade where site = 'kbsite000000001') <> 2 then
    raise exception 'FAIL: kb grade misses the conflict %', (select row(g.*) from public.kb_grade g); end if;
end $$;

-- ---- the first sweep: two posts disagree, the older one goes in contested ----
insert into public.kb_proposals (id, site, origin, title, opened_by_agent)
values ('kbprop000000003', 'kbsite000000001', 'sweep', 'Sweep', 'sweep-test');
insert into public.kb_changes (id, site, proposal, position, op, text) values
  ('kbchng000000001', 'kbsite000000001', 'kbprop000000003', 0, 'add', 'Setting up Acme takes one day.'),
  ('kbchng000000002', 'kbsite000000001', 'kbprop000000003', 1, 'add', 'Setting up Acme takes one week.');
select public.kb_guardian_decide('kbprop000000003', 'admit', 'Newest post settles.',
  '[{"check": "C8", "result": "weak", "reason": "Two posts disagree."}]', '', 'g', 1,
  '[{"change": "kbchng000000001", "other_change": "kbchng000000002", "relation": "contradicts"}]',
  array['kbchng000000002']);
do $$ begin
  if (select status from public.kb_claims where text = 'Setting up Acme takes one day.') <> 'settled'
     or (select status from public.kb_claims where text = 'Setting up Acme takes one week.') <> 'contested' then
    raise exception 'FAIL: per-change status ignored'; end if;
  if not exists (select 1 from public.kb_flags f join public.kb_claims a on a.id = f.claim join public.kb_claims b on b.id = f.other_claim
                  where a.text like '%one day.' and b.text like '%one week.') then
    raise exception 'FAIL: the sweep conflict was not flagged'; end if;
end $$;

-- ---- the Checker records a post version ----
insert into public.posts (id, site, title, status) values ('kbpost000000004', 'kbsite000000001', 'Setup guide', 'published');
insert into public.post_versions (id, site, post, version, content, created_by) values
  ('kbvers000000004', 'kbsite000000001', 'kbpost000000004', 1, 'Acme takes a week to set up.', 'user'),
  ('kbvers000000005', 'kbsite000000001', 'kbpost000000004', 2, 'Acme takes a day to set up.', 'user');
select id as one_day from public.kb_claims where text = 'Setting up Acme takes one day.' \gset
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  perform public.kb_checker_record('kbsite000000001', 'kbvers000000004', '[]', '[]', '{}', '{}', 'x');
  raise exception 'FAIL: a member recorded a check';
exception when insufficient_privilege then null; end $$;
commit;
begin;
set local role service_role;
select public.kb_checker_record('kbsite000000001', 'kbvers000000004',
  jsonb_build_array(jsonb_build_object('claim', :'one_day', 'reliance', 'mentions', 'quote', 'a week')),
  jsonb_build_array(jsonb_build_object('claim', :'one_day', 'quote', 'Acme takes a week to set up.',
    'explanation', 'The knowledge base says one day.', 'suggested_action', 'edit_wording', 'suggested_fix', 'Acme takes a day to set up.')),
  array[:'one_day'], '{"summary": "One conflict.", "remember": [{"text": "Acme has a setup guide.", "quote": "x"}]}',
  'checker-test', 'wf-1') as first_check \gset
commit;
do $$ begin
  if (select count(*) from public.kb_flags where post = 'kbpost000000004' and kind = 'contradiction' and status = 'open'
        and checked is not null) <> 1 then raise exception 'FAIL: the Checker opened no flag'; end if;
  if (select count(*) from public.kb_post_claims where post_version = 'kbvers000000004') <> 1 then
    raise exception 'FAIL: the post version is not linked'; end if;
end $$;
-- The same version read again refreshes the flag instead of opening a second one.
select public.kb_checker_record('kbsite000000001', 'kbvers000000004', '[]',
  jsonb_build_array(jsonb_build_object('claim', :'one_day', 'quote', 'a week', 'explanation', 'Still one day.')),
  array[:'one_day'], '{}', 'checker-test');
-- The author fixes the post: the next version no longer conflicts, the flag closes as fixed.
select public.kb_checker_record('kbsite000000001', 'kbvers000000005',
  jsonb_build_array(jsonb_build_object('claim', :'one_day', 'reliance', 'asserts', 'quote', 'a day')),
  '[]', array[:'one_day'], '{"summary": "Clean."}', 'checker-test');
do $$ begin
  if (select count(*) from public.kb_flags where post = 'kbpost000000004') <> 1 then
    raise exception 'FAIL: a second flag was opened for the same conflict'; end if;
  if (select status from public.kb_flags where post = 'kbpost000000004') <> 'fixed' then
    raise exception 'FAIL: the fixed post kept its flag'; end if;
  if (select count(*) from public.kb_checks where post = 'kbpost000000004') <> 2 then
    raise exception 'FAIL: reports not kept per version'; end if;
end $$;

-- ---- a re-check counts only once the agent has read the post; cleared never counts ----
-- Retract the claim the fixed post relies on (owned by nobody, so the Guardian may).
insert into public.kb_proposals (id, site, origin, title, opened_by_agent)
values ('kbprop000000004', 'kbsite000000001', 'chat', 'Setup got slower', 'chat-test');
insert into public.kb_changes (site, proposal, op, target) values ('kbsite000000001', 'kbprop000000004', 'retract', :'one_day');
select public.kb_guardian_decide('kbprop000000004', 'admit', 'Wrong.', '[{"check": "C11", "result": "major", "reason": "Retracted."}]', 'major', 'g', 1);
select id as recheck from public.kb_flags where post = 'kbpost000000004' and kind = 'recheck' \gset
do $$ begin
  if (select flagged from public.kb_content_grade where site = 'kbsite000000001') <> 1 then
    raise exception 'FAIL: an unread re-check counted %', (select row(g.*) from public.kb_content_grade g); end if;
end $$;
select public.kb_agent_review_flag(:'recheck', false, 'The post says one day; that was retracted.', 'edit_wording', 'Setup takes a few days.');
do $$ begin
  if (select flagged from public.kb_content_grade where site = 'kbsite000000001') <> 2 then
    raise exception 'FAIL: a read re-check did not count'; end if;
end $$;
select public.kb_agent_review_flag(:'recheck', true, 'Only mentions it in a dated note.', '', '');
do $$ begin
  if (select status from public.kb_flags where post = 'kbpost000000004' and kind = 'recheck') <> 'cleared'
     or (select flagged from public.kb_content_grade where site = 'kbsite000000001') <> 1 then
    raise exception 'FAIL: a re-check that holds did not clear'; end if;
end $$;

-- ---- the agent drafts a contest from the person's sentence ----
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select public.kb_contest((select id from public.kb_flags where kind = 'kb_conflict' limit 1), 'The guide is about the self-serve plan.', 'scope') as contest2 \gset
commit;
select public.kb_agent_source('kbsite000000001', 'chat', 4::smallint, 'Contest', 'The guide is about the self-serve plan.') as said \gset
select public.kb_agent_source('kbsite000000001', 'post', 5::smallint, 'Setup guide', '', '', 'kbvers000000005') as post_src \gset
do $$ begin
  if public.kb_agent_source('kbsite000000001', 'post', 5::smallint, 'again', '', '', 'kbvers000000005')
     <> (select id from public.kb_sources where post_version = 'kbvers000000005') then
    raise exception 'FAIL: a post version became two sources'; end if;
end $$;
select public.kb_agent_draft(:'contest2',
  jsonb_build_array(jsonb_build_object('op', 'add', 'text', 'On the self-serve plan, setting up Acme takes one day.',
    'scope', jsonb_build_object('product', 'self-serve'),
    'evidence', jsonb_build_array(jsonb_build_object('source', :'said', 'quote', 'self-serve plan')))),
  'Scope: the guide covers the self-serve plan only.');
do $$ begin
  if (select axis from public.kb_proposals where origin = 'contest' and status = 'draft') <> 'scope' then
    raise exception 'FAIL: the axis was lost'; end if;
  if (select summary from public.kb_proposals where origin = 'contest' and status = 'draft') not like 'The guide is about%---%Scope:%' then
    raise exception 'FAIL: the argument was not appended'; end if;
  if (select count(*) from public.kb_changes c join public.kb_proposals p on p.id = c.proposal
       where p.origin = 'contest' and p.status = 'draft') <> 1 then raise exception 'FAIL: draft changes missing'; end if;
end $$;

-- ---- agents search with a whole passage ----
do $$ begin
  if not exists (select 1 from public.kb_search('kbsite000000001', 'honestly the positioning is that Acme keeps everything consistent',
                   p_any => true) where text like 'Acme keeps%') then
    raise exception 'FAIL: any-word search missed'; end if;
  if exists (select 1 from public.kb_search('kbsite000000001', 'honestly the positioning is that Acme keeps everything consistent')) then
    raise exception 'FAIL: all-words search matched a passage'; end if;
end $$;

-- ---- another site's member sees nothing ----
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
do $$ begin
  if (select count(*) from public.kb_claims) + (select count(*) from public.kb_flags)
     + (select count(*) from public.kb_search('kbsite000000001', 'Acme')) <> 0 then
    raise exception 'FAIL: another site read the knowledge base'; end if;
  begin
    perform public.kb_remember('kbsite000000001', 'Acme is bad.');
    raise exception 'FAIL: a non-member remembered';
  exception when insufficient_privilege then null; end;
end $$;
commit;

-- ---- deleting the site takes the knowledge base with it ----
delete from public.posts where site = 'kbsite000000001';  -- delete_site wants an empty site
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select public.delete_site('kbsite000000001');
commit;
do $$ begin
  if exists (select 1 from public.kb_claims) or exists (select 1 from public.kb_decisions) then
    raise exception 'FAIL: knowledge base survived its site'; end if;
end $$;

select 'ALL KB CHECKS PASSED' as result;
