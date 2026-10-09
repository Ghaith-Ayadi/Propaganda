-- The Strategist (20261009000070_strategist.sql). Each check raises on
-- failure. Run by supabase/tests/sql/run.sh.
\set ON_ERROR_STOP on
set client_min_messages = warning;

insert into auth.users (id) values ('33333333-3333-3333-3333-333333333333'), ('44444444-4444-4444-4444-444444444444')
  on conflict do nothing;
insert into public.sites (id, name, slug) values ('sitestrat000001', 'Strat tenant', 'strat-tenant'), ('sitestrat000002', 'Strat other', 'strat-other');
insert into public.site_members (site, user_id, role) values ('sitestrat000001', '33333333-3333-3333-3333-333333333333', 'owner');

-- Nothing is public.
set role anon;
do $$ begin
  begin
    perform 1 from public.strategy_proposals;
    raise exception 'FAIL: anon read proposals';
  exception when insufficient_privilege then null; end;
  begin
    perform public.strategy_request('sitestrat000001', 'onboarding', '2026-Q4', '');
    raise exception 'FAIL: anon asked for a proposal';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- A member saves answers, asks for a proposal; asking twice returns the same one.
set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
insert into public.tenant_profile (site, answers, plan_text) values ('sitestrat000001', '{"offer": "Batch jobs"}', 'Our plan');
do $$
declare a text; b text;
begin
  a := public.strategy_request('sitestrat000001', 'onboarding', '2026-Q4', '');
  b := public.strategy_request('sitestrat000001', 'revision', '2026-Q4', 'again');
  if a <> b then raise exception 'FAIL: a second request while one waits made another'; end if;
  begin
    perform public.strategy_request('sitestrat000002', 'onboarding', '2026-Q4', '');
    raise exception 'FAIL: a non-member asked for a proposal';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.strategy_proposals (site, quarter, kind) values ('sitestrat000001', '2026-Q4', 'revision');
    raise exception 'FAIL: a member inserted a proposal directly';
  exception when insufficient_privilege then null; end;
  begin
    update public.tenant_profile set plan_read_at = now() where site = 'sitestrat000001';
    raise exception 'FAIL: a member marked the plan read';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- The worker (service role) sends it.
update public.strategy_proposals set status = 'sent', sent_at = now(),
  proposal = '{"covers": {"from": "2026-10-09", "to": "2026-12-31", "weeks": 12, "prorated": true}}'
  where site = 'sitestrat000001';
insert into public.watched_sites (site, url, added_by) values ('sitestrat000001', 'https://old.example.com/', 'strategist'),
  ('sitestrat000001', 'https://mine.example.com/', 'person');

-- A member approves an edited version.
set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
do $$
declare p text; v integer;
begin
  select id into p from public.strategy_proposals where site = 'sitestrat000001';
  v := public.strategy_approve(p,
    '{"volume": {"total": 18, "topics": [{"name": "Reliability", "low": 5, "high": 7}]},
      "ranking": {"searches": [{"query": "batch job retries", "topic": "Reliability"}], "pageOneTarget": 2, "aiMentionTarget": 1},
      "readership": {"pageviews": null}}',
    '[{"field": "volume", "from": "20", "to": "18"}]', '["Volume 20 → 18"]', 'Smaller start',
    '[{"url": "https://new.example.com/", "topic": "Reliability", "why": "Trade press"}]');
  if v <> 1 then raise exception 'FAIL: first version is %', v; end if;
  begin
    perform public.strategy_approve(p, '{"volume": {"total": 1}}');
    raise exception 'FAIL: approved twice';
  exception when invalid_parameter_value then null; end;
end $$;
reset role;

do $$ begin
  if (select status from public.strategy_proposals where site = 'sitestrat000001') <> 'approved' then raise exception 'FAIL: not approved'; end if;
  if (select (targets #>> '{volume,total}')::int from public.goal_versions where site = 'sitestrat000001') <> 18 then raise exception 'FAIL: goal version'; end if;
  if (select (covers ->> 'weeks')::int from public.goal_versions where site = 'sitestrat000001') <> 12 then raise exception 'FAIL: covers not copied'; end if;
  if not exists (select 1 from public.scout_searches where site = 'sitestrat000001' and query = 'batch job retries' and active) then raise exception 'FAIL: Scout search'; end if;
  if (select active from public.watched_sites where url = 'https://old.example.com/') then raise exception 'FAIL: dropped Strategist site still active'; end if;
  if not (select active from public.watched_sites where url = 'https://mine.example.com/') then raise exception 'FAIL: a person''s site was turned off'; end if;
  if not exists (select 1 from public.watched_sites where url = 'https://new.example.com/' and added_by = 'strategist') then raise exception 'FAIL: new watched site'; end if;
end $$;

-- Another tenant's member sees none of it; drift notes can only be dismissed.
insert into public.drift_notes (site, week, goal, severity, message) values ('sitestrat000001', '2026-W42', 'volume', 'behind', 'Volume: 2 of 18.');
set role authenticated;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
do $$ begin
  if exists (select 1 from public.goal_versions) or exists (select 1 from public.tenant_profile) or exists (select 1 from public.drift_notes)
  then raise exception 'FAIL: a non-member read another tenant''s goals'; end if;
end $$;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
update public.drift_notes set dismissed_at = now() where site = 'sitestrat000001';
do $$ begin
  begin
    update public.drift_notes set message = 'x' where site = 'sitestrat000001';
    raise exception 'FAIL: a member rewrote a note';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select 'strategist: all checks passed';
