-- A read-only role for operators' queries over the public API, so a cloud
-- session can read production without a port on Postgres, an SSH key or the
-- service key (Ayadi, 2026-10-10: "you can read the db directly").
--
-- `propaganda_reader` reads every table in `public` except the secrets table
-- (model_keys) and nothing in private, auth or any other schema. PostgREST
-- switches to it for a request whose JWT carries role = propaganda_reader;
-- Bedrock's scripts/propaganda-reader-key.sh mints that token with the
-- stack's JWT secret, and it lives only in the cloud environment's secrets.
--
-- Read-only is enforced twice: the role has no insert, update, delete or
-- execute grants of its own, and PostgREST's pre-request hook
-- (private.reader_guard, PGRST_DB_PRE_REQUEST in the compose files) marks
-- the transaction read-only whenever the role is propaganda_reader, which
-- also stops an rpc() call to a function that PUBLIC may execute from
-- writing. Row-level security is bypassed on purpose: the whole point is to
-- read what the app shows nobody.
--
-- A later migration that adds a table holding secrets must
-- `revoke all on <table> from propaganda_reader`, as it does for anon.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'propaganda_reader') then
    create role propaganda_reader nologin bypassrls;
  end if;
end $$;

-- PostgREST connects as authenticator and `set role`s to the token's role.
grant propaganda_reader to authenticator;

grant usage on schema public to propaganda_reader;
grant select on all tables in schema public to propaganda_reader;
revoke all on public.model_keys from propaganda_reader;
-- Tables later migrations create (they run as postgres, like this one).
alter default privileges in schema public grant select on tables to propaganda_reader;

-- The guard. PostgREST calls it at the start of every request, as the
-- request's role, so every API role may execute it; it only acts for the
-- reader. Switching a transaction to read-only is allowed at any point.
create or replace function private.reader_guard() returns void
language plpgsql as $$
begin
  if current_user = 'propaganda_reader' then
    perform set_config('transaction_read_only', 'on', true);
  end if;
end $$;
grant usage on schema private to propaganda_reader;
grant execute on function private.reader_guard() to anon, authenticated, service_role, propaganda_reader;
