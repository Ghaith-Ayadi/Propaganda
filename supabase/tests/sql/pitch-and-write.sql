-- The Pitcher and Writer draft (20261008000010_pitch_and_write.sql). Each
-- check raises on failure. Run by supabase/tests/sql/run.sh.
\set ON_ERROR_STOP on
set client_min_messages = warning;

insert into auth.users (id) values ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222');
insert into public.sites (id, name, slug) values ('sitetest0000001', 'Test tenant', 'test-tenant'), ('sitetest0000002', 'Other', 'other');
insert into public.site_members (site, user_id, role) values ('sitetest0000001', '11111111-1111-1111-1111-111111111111', 'owner');

-- Old shapes keep working: a person's brief with an old status and no new columns.
insert into public.briefs (id, site, title, status) values ('briefperson0001', 'sitetest0000001', 'Mine', 'todo');

-- An idea and the Pitcher's brief.
insert into public.agent_ideas (id, site, title, origin, source_agent, evidence)
  values ('ideatest0000001', 'sitetest0000001', 'Why batch jobs fail at 3am', 'calls', 'listener',
          '[{"label": "Call with a customer", "quote": "it dies every night"}]');
insert into public.briefs (id, site, title, status, pitched_by, idea, topics, fit, origin, outline, batch, expires_at)
  values ('briefagent00001', 'sitetest0000001', 'Batch jobs at 3am', 'pitched', 'agent:pitcher', 'ideatest0000001',
          '["Reliability"]', '{"grade": "fair", "reasons": []}', 'calls', '[{"id": "l1", "text": "Intro"}]', 1, '2026-12-01');
update public.agent_ideas set status = 'pitched', brief = 'briefagent00001' where id = 'ideatest0000001';

do $$ begin
  begin
    insert into public.briefs (site, title, status) values ('sitetest0000001', 'x', 'nonsense');
    raise exception 'FAIL: an unknown status was accepted';
  exception when check_violation then null; end;
  begin
    insert into public.agent_ideas (site, title, origin, source_agent) values ('sitetest0000001', 'x', 'gossip', 'scout');
    raise exception 'FAIL: an unknown origin was accepted';
  exception when check_violation then null; end;
  begin
    insert into public.briefs (site, title, status, pitched_by) values ('sitetest0000001', 'x', 'pitched', 'someone');
    raise exception 'FAIL: pitched_by accepted a person';
  exception when check_violation then null; end;
end $$;

-- A deleted idea leaves the brief, without its link.
insert into public.agent_ideas (id, site, title, origin, source_agent) values ('ideatest0000002', 'sitetest0000001', 'Gone', 'news', 'scout');
update public.briefs set idea = 'ideatest0000002' where id = 'briefperson0001';
delete from public.agent_ideas where id = 'ideatest0000002';
do $$ begin
  if (select idea from public.briefs where id = 'briefperson0001') is not null then raise exception 'FAIL: idea link kept'; end if;
end $$;
update public.briefs set idea = null where id = 'briefperson0001';

-- The Writer's draft and version.
insert into public.posts (id, site, title, type, status, content_md) values ('posttest0000001', 'sitetest0000001', 'Batch jobs at 3am', 'Test', 'draft', 'Draft');
insert into public.post_versions (site, post, version, content, created_by) values ('sitetest0000001', 'posttest0000001', 1, 'Draft', 'agent:writer');
do $$ begin
  begin
    insert into public.post_versions (site, post, version, content, created_by) values ('sitetest0000001', 'posttest0000001', 2, 'x', 'agent:nobody');
    raise exception 'FAIL: an unknown author was accepted';
  exception when check_violation then null; end;
end $$;

-- The Writer's voice guide (service role), then a member edits it.
insert into public.voice_guides (site, body, source, updated_by) values ('sitetest0000001', 'Agent guide', 'content', 'agent:writer');

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$ begin
  if (select count(*) from public.agent_ideas) <> 1 then raise exception 'FAIL: the member should see their tenant''s idea'; end if;
  begin
    insert into public.agent_ideas (site, title, origin, source_agent) values ('sitetest0000001', 'x', 'team', 'person');
    raise exception 'FAIL: a member wrote an idea';
  exception when insufficient_privilege then null; end;
end $$;
update public.voice_guides set body = 'My guide', source = 'content' where site = 'sitetest0000001';
do $$ begin
  if (select source from public.voice_guides where site = 'sitetest0000001') <> 'person' then raise exception 'FAIL: a member''s edit is not marked as theirs'; end if;
end $$;
-- The batch cadence: a member sets it; only weekly or flood.
insert into public.agent_settings (site, batch_cadence) values ('sitetest0000001', 'flood');
do $$ begin
  if (select updated_by from public.agent_settings where site = 'sitetest0000001') <> '11111111-1111-1111-1111-111111111111' then raise exception 'FAIL: the cadence change is not stamped with its author'; end if;
  begin
    update public.agent_settings set batch_cadence = 'monthly' where site = 'sitetest0000001';
    raise exception 'FAIL: an unknown cadence was accepted';
  exception when check_violation then null; end;
end $$;

-- A member of another tenant sees nothing.
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$ begin
  if (select count(*) from public.agent_ideas) <> 0 then raise exception 'FAIL: ideas leaked across tenants'; end if;
  if (select count(*) from public.voice_guides) <> 0 then raise exception 'FAIL: voice guides leaked across tenants'; end if;
  if (select count(*) from public.agent_settings) <> 0 then raise exception 'FAIL: settings leaked across tenants'; end if;
end $$;
reset role;

select 'pitch and write: all checks passed' as result;
