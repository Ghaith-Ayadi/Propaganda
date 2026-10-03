-- Bookkeeping for the PocketBase import (supabase/import/pb_to_pg.py).
--
--   import_runs   one row per load: when, from which export, how many rows.
--   import_lock   a row here means the cutover happened: this database is the
--                 real one now, and the loader refuses to replace its content.
--                 Inserted by hand at cutover (docs in supabase/README.md).
create table private.import_runs (
  id bigint generated always as identity primary key,
  loaded_at timestamptz not null default now(),
  exported_at timestamptz not null,
  counts jsonb not null
);

create table private.import_lock (
  locked_at timestamptz primary key default now(),
  note text not null default ''
);

alter table private.import_runs enable row level security;
alter table private.import_lock enable row level security;
revoke all on private.import_runs, private.import_lock from anon, authenticated;

/**
 * Which load of the content this database holds: the last import run's id (0
 * before any). A load replaces rows with older `updated` stamps than a
 * device's sync cursors, and drops rows outright, so the app compares this
 * with the epoch it last synced against and, when it changed, re-reads the
 * site from scratch (lib/sync.ts reconcileEpoch). Rows still waiting to be
 * pushed are never touched.
 */
create function public.data_epoch() returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(max(id), 0) from private.import_runs
$$;
revoke execute on function public.data_epoch() from public;
grant execute on function public.data_epoch() to anon, authenticated;
