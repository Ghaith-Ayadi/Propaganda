-- The scoped hotfix role (20261010000120_propaganda_hotfix_role.sql). Each
-- check raises on failure. Run by supabase/tests/sql/run.sh.
-- PostgREST sets role, request.method, request.path and request.headers, then
-- calls private.reader_guard(); the checks do the same by hand.
\set ON_ERROR_STOP on
set client_min_messages = warning;

insert into public.sites (id, name, slug) values ('sitehotfix00001', 'Hotfix tenant', 'hotfix-tenant');
insert into public.collections (id, site, name) values ('colhotfix000001', 'sitehotfix00001', 'Notes');
insert into public.posts (id, site, title, content_md, type) values ('posthotfix00001', 'sitehotfix00001', 'Original', 'Original body', 'Notes');
insert into public.briefs (id, site, title, status) values ('briefhotfix0001', 'sitehotfix00001', 'A brief', 'todo');
insert into public.model_keys (site, secret, last4) values ('sitehotfix00001', 'v1:x', 'abcd') on conflict do nothing;

-- Reads: every table but model_keys; no private, no auth.
set role propaganda_hotfix;
select set_config('request.method', 'GET', false);
select set_config('request.path', '/posts', false);
select set_config('request.headers', '{}', false);
select private.reader_guard();
do $$ begin
  perform 1 from public.posts;
  perform 1 from public.model_calls;
  begin perform 1 from public.model_keys; raise exception 'FAIL: hotfix read model_keys';
  exception when insufficient_privilege then null; end;
  begin perform 1 from private.superadmins; raise exception 'FAIL: hotfix read private';
  exception when insufficient_privilege then null; end;
  begin perform 1 from auth.users; raise exception 'FAIL: hotfix read auth.users';
  exception when insufficient_privilege then null; end;
end $$;

-- A write without a reason is refused by the guard.
select set_config('request.method', 'PATCH', false);
do $$ begin
  begin perform private.reader_guard(); raise exception 'FAIL: write without a reason passed the guard';
  exception when sqlstate 'PT400' then null; end;
end $$;
select set_config('request.headers', '{"x-hotfix-reason": "short"}', false);
do $$ begin
  begin perform private.reader_guard(); raise exception 'FAIL: a 5-character reason passed the guard';
  exception when sqlstate 'PT400' then null; end;
end $$;

-- rpc() is refused outright.
select set_config('request.path', '/rpc/delete_site', false);
do $$ begin
  begin perform private.reader_guard(); raise exception 'FAIL: rpc passed the guard';
  exception when sqlstate 'PT403' then null; end;
end $$;

-- With a reason: updates and inserts work, and are logged with old and new rows.
select set_config('request.path', '/posts', false);
select set_config('request.headers', '{"x-hotfix-reason": "restore the intro Ayadi asked for"}', false);
-- PostgREST runs the guard and the request in one transaction.
begin;
select private.reader_guard();
update public.posts set title = 'Fixed' where id = 'posthotfix00001';
update public.briefs set status = 'rejected' where id = 'briefhotfix0001';
insert into public.briefs (id, site, title, status) values ('briefhotfix0002', 'sitehotfix00001', 'New', 'todo');

-- No delete, no write outside the list, no direct write to the log.
do $$ begin
  begin delete from public.posts where id = 'posthotfix00001'; raise exception 'FAIL: hotfix deleted a post';
  exception when insufficient_privilege then null; end;
  begin delete from public.sites where id = 'sitehotfix00001'; raise exception 'FAIL: hotfix deleted a site';
  exception when insufficient_privilege then null; end;
  begin update public.sites set name = 'x' where id = 'sitehotfix00001'; raise exception 'FAIL: hotfix wrote sites';
  exception when insufficient_privilege then null; end;
  begin update public.site_members set role = 'owner'; raise exception 'FAIL: hotfix wrote site_members';
  exception when insufficient_privilege then null; end;
  begin update public.model_keys set last4 = 'wxyz'; raise exception 'FAIL: hotfix wrote model_keys';
  exception when insufficient_privilege then null; end;
  begin update public.cost_kill set engaged = false; raise exception 'FAIL: hotfix wrote cost_kill';
  exception when insufficient_privilege or undefined_column then null; end;
  begin insert into public.hotfix_audit (reason, table_name, op, new_row) values ('forged reason', 'posts', 'INSERT', '{}');
    raise exception 'FAIL: hotfix wrote the audit log';
  exception when insufficient_privilege then null; end;
end $$;
commit;
reset role;

-- The log holds the three writes, with the reason and the old row.
do $$
declare n int;
begin
  select count(*) into n from public.hotfix_audit;
  if n <> 3 then raise exception 'FAIL: expected 3 audit rows, got %', n; end if;
  if not exists (select 1 from public.hotfix_audit where table_name = 'posts' and op = 'UPDATE'
                 and reason = 'restore the intro Ayadi asked for'
                 and old_row ->> 'title' = 'Original' and new_row ->> 'title' = 'Fixed'
                 and row_key = 'posthotfix00001' and site = 'sitehotfix00001') then
    raise exception 'FAIL: the post update is not logged with its old row';
  end if;
  if not exists (select 1 from public.hotfix_audit where table_name = 'briefs' and op = 'INSERT'
                 and old_row is null and row_key = 'briefhotfix0002') then
    raise exception 'FAIL: the brief insert is not logged';
  end if;
end $$;

-- Other roles' writes pass through unlogged.
update public.posts set title = 'By the server' where id = 'posthotfix00001';
do $$ begin
  if (select count(*) from public.hotfix_audit) <> 3 then raise exception 'FAIL: a non-hotfix write was logged'; end if;
end $$;

-- The log is append-only (even for its owner), closed to the app's roles.
do $$ begin
  begin update public.hotfix_audit set reason = 'edited'; raise exception 'FAIL: audit row edited';
  exception when insufficient_privilege then null; end;
  begin delete from public.hotfix_audit; raise exception 'FAIL: audit row deleted';
  exception when insufficient_privilege then null; end;
  begin truncate public.hotfix_audit; raise exception 'FAIL: audit truncated';
  exception when insufficient_privilege then null; end;
end $$;
set role authenticated;
do $$ begin
  begin perform 1 from public.hotfix_audit; raise exception 'FAIL: authenticated read the audit log';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set role anon;
do $$ begin
  begin perform 1 from public.hotfix_audit; raise exception 'FAIL: anon read the audit log';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- The reader still reads the log and still can't write.
set role propaganda_reader;
select set_config('request.method', 'GET', false);
select private.reader_guard();
do $$ begin
  perform 1 from public.hotfix_audit;
  begin update public.posts set title = 'x'; raise exception 'FAIL: reader wrote';
  exception when insufficient_privilege or read_only_sql_transaction then null; end;
end $$;
reset role;

select 'hotfix_role ok';
