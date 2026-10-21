-- Styles (20261010000140_kb_styles.sql). Each check raises on failure. Run by
-- supabase/tests/sql/run.sh.
\set ON_ERROR_STOP on
set client_min_messages = warning;

insert into auth.users (id) values ('77777777-7777-7777-7777-777777777777'), ('88888888-8888-8888-8888-888888888888')
  on conflict do nothing;
insert into public.sites (id, name, slug) values ('sitestyle000001', 'Styled tenant', 'styled-tenant'),
  ('sitestyle000002', 'Other tenant', 'other-styled-tenant');
insert into public.site_members (site, user_id, role) values ('sitestyle000001', '77777777-7777-7777-7777-777777777777', 'editor'),
  ('sitestyle000002', '88888888-8888-8888-8888-888888888888', 'owner');
insert into public.kb_styles (id, site, rule) values ('styleother00001', 'sitestyle000002', 'Never quote a vendor.');

set role authenticated;
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', false);
do $$ begin
  insert into public.kb_styles (site, rule, example) values ('sitestyle000001', 'Jokes are welcome.', 'A ski instructor line.');
  if (select created_by from public.kb_styles where site = 'sitestyle000001') <> '77777777-7777-7777-7777-777777777777'
    then raise exception 'FAIL: created_by is not the member'; end if;
  if exists (select 1 from public.kb_styles where site = 'sitestyle000002') then raise exception 'FAIL: read another tenant''s styles'; end if;
  begin
    insert into public.kb_styles (site, rule) values ('sitestyle000002', 'Planted.');
    raise exception 'FAIL: wrote another tenant''s styles';
  exception when insufficient_privilege then null; end;
  update public.kb_styles set status = 'retired' where site = 'sitestyle000001';
  if (select status from public.kb_styles where site = 'sitestyle000001') <> 'retired' then raise exception 'FAIL: a member can''t retire'; end if;
  update public.kb_styles set status = 'retired' where id = 'styleother00001';
  begin
    delete from public.kb_styles where site = 'sitestyle000001';
    raise exception 'FAIL: a member deleted a style';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.kb_styles (site, rule) values ('sitestyle000001', '   ');
    raise exception 'FAIL: an empty rule';
  exception when check_violation then null; end;
end $$;
reset role;
do $$ begin
  if (select status from public.kb_styles where id = 'styleother00001') <> 'active' then raise exception 'FAIL: retired another tenant''s style'; end if;
end $$;

set role anon;
do $$ begin
  begin
    perform 1 from public.kb_styles;
    raise exception 'FAIL: anon reads styles';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'kb_styles: ok';
