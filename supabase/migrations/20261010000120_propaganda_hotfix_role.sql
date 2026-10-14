-- A scoped write role for hotfixes to production data, so a cloud session
-- never needs the service key (Ayadi, 2026-10-14: "Yes" to this file).
--
-- `propaganda_hotfix` is the reader's sibling. PostgREST switches to it for a
-- request whose JWT carries role = propaganda_hotfix; Bedrock's
-- scripts/propaganda-hotfix-key.sh mints that token with the stack's JWT
-- secret, good for 7 days. It is used only when Ayadi asks for a specific
-- fix, and it lives only in the cloud environment's secrets.
--
-- What it can do
--   * read every table in `public` but model_keys (what propaganda_reader sees);
--   * insert and update the content, agent and chat tables listed below;
--   * nothing else: no delete anywhere, no write to sites, site_members,
--     settings, keys, model calls or prices, no access to private, auth or any
--     other schema, no rpc() call to any function.
--
-- What it leaves behind
--   * Every write needs a reason: the request header `X-Hotfix-Reason`
--     (at least 10 characters). The pre-request hook (private.reader_guard,
--     PGRST_DB_PRE_REQUEST) rejects a write without one, and an after-trigger
--     on each writable table copies the reason, the old row and the new row
--     into public.hotfix_audit. The trigger runs in the same transaction, so
--     a write that can't be logged doesn't happen. With no delete grant, the
--     old row of every update is kept there too.
--   * hotfix_audit is append-only and closed to anon and authenticated.
--
-- Switch it off at once: `revoke propaganda_hotfix from authenticator;`
-- (grant it back to switch it on). Tokens also expire on their own.
--
-- A later migration that adds a table holding secrets must
-- `revoke all on <table> from propaganda_hotfix`, as it does for the reader.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'propaganda_hotfix') then
    create role propaganda_hotfix nologin bypassrls;
  end if;
end $$;

-- PostgREST connects as authenticator and `set role`s to the token's role.
grant propaganda_hotfix to authenticator;

grant usage on schema public to propaganda_hotfix;
grant select on all tables in schema public to propaganda_hotfix;
revoke all on public.model_keys from propaganda_hotfix;
-- Tables later migrations create (they run as postgres, like this one).
alter default privileges in schema public grant select on tables to propaganda_hotfix;

-- The log. Rows come only from private.hotfix_audit_row() (security definer).
create table public.hotfix_audit (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  reason     text not null,
  table_name text not null,
  op         text not null check (op in ('INSERT', 'UPDATE')),
  site       text not null default '',
  row_key    text not null default '',
  old_row    jsonb,
  new_row    jsonb not null
);
create index hotfix_audit_at on public.hotfix_audit (at desc);
create index hotfix_audit_row on public.hotfix_audit (table_name, row_key);
alter table public.hotfix_audit enable row level security;
revoke all on public.hotfix_audit from anon, authenticated;

create function private.hotfix_audit_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'hotfix_audit is append-only' using errcode = '42501';
end $$;
create trigger append_only before update or delete on public.hotfix_audit
  for each row execute function private.hotfix_audit_append_only();
create trigger no_truncate before truncate on public.hotfix_audit
  for each statement execute function private.hotfix_audit_append_only();

-- Copies a hotfix write into the log. The guard sets propaganda.hotfix_reason
-- for the hotfix role only, so writes by anyone else pass through unlogged.
create function private.hotfix_audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  reason text := coalesce(current_setting('propaganda.hotfix_reason', true), '');
  n jsonb := to_jsonb(new);
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
begin
  if reason = '' then
    return null;
  end if;
  insert into public.hotfix_audit (reason, table_name, op, site, row_key, old_row, new_row)
  values (reason, tg_table_name, tg_op,
          coalesce(n ->> 'site', n ->> 'scope', ''),
          coalesce(n ->> 'id', n ->> 'scope', ''),
          o, n);
  return null;
end $$;

-- The writable tables: content, agent and chat. Not sites, site_members,
-- app_settings, post_redirects (the address triggers write those), model_*,
-- cost_kill, arena_votes, the Scout's own tables, or anything in private.
do $$
declare
  t text;
  tables text[] := array[
    'posts', 'post_versions', 'collections', 'briefs', 'brief_templates',
    'content_batches',
    'agent_ideas', 'agent_settings', 'voice_guides', 'taste_profiles', 'taste_log',
    'drift_notes', 'tenant_profile', 'goal_versions', 'strategy_proposals',
    'kb_agent_sites', 'kb_changes', 'kb_checks', 'kb_claim_topics', 'kb_claims',
    'kb_decisions', 'kb_evidence', 'kb_flags', 'kb_people', 'kb_policies',
    'kb_post_claims', 'kb_proposals', 'kb_relationships', 'kb_sources',
    'kb_topic_owners', 'kb_topics',
    'chat_conversations', 'chat_messages',
    'cost_limits'
  ];
begin
  foreach t in array tables loop
    execute format('grant insert, update on public.%I to propaganda_hotfix', t);
    -- zz_ runs after the stamp and address triggers, so it logs the final row.
    execute format('create trigger zz_hotfix_audit after insert or update on public.%I
                    for each row execute function private.hotfix_audit_row()', t);
  end loop;
end $$;
-- Identity columns, if any of those tables has one.
grant usage on all sequences in schema public to propaganda_hotfix;

-- The guard. PostgREST calls it at the start of every request, as the
-- request's role, so every API role may execute it; it only acts for the
-- reader (read-only transaction) and the hotfix role (reason required for
-- writes, no rpc, reason handed to the audit trigger).
create or replace function private.reader_guard() returns void
language plpgsql as $$
declare
  method text := coalesce(current_setting('request.method', true), '');
  reason text;
begin
  if current_user = 'propaganda_reader' then
    perform set_config('transaction_read_only', 'on', true);
  elsif current_user = 'propaganda_hotfix' then
    if coalesce(current_setting('request.path', true), '') like '/rpc/%' then
      raise exception 'propaganda_hotfix can not call functions' using errcode = 'PT403';
    end if;
    if method not in ('GET', 'HEAD', 'OPTIONS') then
      select btrim(h.value) into reason
        from json_each_text(coalesce(nullif(current_setting('request.headers', true), '')::json, '{}'::json)) h
        where lower(h.key) = 'x-hotfix-reason';
      if length(coalesce(reason, '')) < 10 then
        raise exception 'A hotfix write needs an X-Hotfix-Reason header (10+ characters)' using errcode = 'PT400';
      end if;
      perform set_config('propaganda.hotfix_reason', left(reason, 500), true);
    end if;
  end if;
end $$;
grant usage on schema private to propaganda_hotfix;
grant execute on function private.reader_guard() to propaganda_hotfix;
