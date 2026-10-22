-- content_updated (20261010000190_post_content_updated.sql). Each check raises
-- on failure. Run by supabase/tests/sql/run.sh.
\set ON_ERROR_STOP on
set client_min_messages = warning;

insert into public.sites (id, name, slug) values ('sitecontent0001', 'Content tenant', 'content-tenant');
insert into public.posts (id, site, title, content_md, status) values ('postcontent0001', 'sitecontent0001', 'First', 'Body.', 'draft');

do $$
declare
  p public.posts;
  before_content timestamptz;
begin
  select * into p from public.posts where id = 'postcontent0001';
  if p.content_updated is null or p.content_updated > p.updated then raise exception 'FAIL: not stamped on insert'; end if;
  before_content := p.content_updated;

  perform pg_sleep(0.01);
  update public.posts set status = 'published', published_at = now(), favorited = true, type = 'Essays' where id = 'postcontent0001';
  select * into p from public.posts where id = 'postcontent0001';
  if p.updated <= before_content then raise exception 'FAIL: updated did not move on publish'; end if;
  if p.content_updated <> before_content then raise exception 'FAIL: content_updated moved on a publish'; end if;

  -- A client can't set it.
  update public.posts set content_updated = '2000-01-01' where id = 'postcontent0001';
  select * into p from public.posts where id = 'postcontent0001';
  if p.content_updated <> before_content then raise exception 'FAIL: a client set content_updated'; end if;

  perform pg_sleep(0.01);
  update public.posts set content_md = 'Body, revised.' where id = 'postcontent0001';
  select * into p from public.posts where id = 'postcontent0001';
  if p.content_updated <= before_content then raise exception 'FAIL: content_updated did not move on a body change'; end if;
  if p.content_updated <> p.updated then raise exception 'FAIL: content_updated differs from updated on a content write'; end if;
  before_content := p.content_updated;

  perform pg_sleep(0.01);
  update public.posts set title = 'First, retitled' where id = 'postcontent0001';
  select * into p from public.posts where id = 'postcontent0001';
  if p.content_updated <= before_content then raise exception 'FAIL: content_updated did not move on a title change'; end if;
end $$;

-- Anyone reads it on a published post.
set role anon;
do $$ begin
  if (select content_updated from public.posts where id = 'postcontent0001') is null then raise exception 'FAIL: anon cannot read content_updated'; end if;
end $$;
reset role;
delete from public.posts where id = 'postcontent0001';
delete from public.sites where id = 'sitecontent0001';
select 'ok: content_updated' as result;
