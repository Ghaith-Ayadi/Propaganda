-- A blog's Search Console queries, once a week (Propaganda 0.5). Approved by Ayadi in the
-- Strategist thread, 2026-10-24 (file 20261010000210_search_console_snapshots.sql).
-- Additive only: one new table, nothing existing is renamed, dropped or rewritten, and no
-- client syncs it.
--
-- Search Console keeps 16 months and answers only the last 90 days per read; a trend
-- ("this search moved from position 31 to 14") needs the old reads kept. The Scout writes
-- the week's read (worker/src/scout/store.ts saveSearchConsole) as propaganda_scout, the
-- role that already writes the Scout's own tables. Members read their site's rows.

create table public.search_console_snapshots (
  site text not null references public.sites (id) on delete cascade,
  day date not null,
  query text not null check (char_length(query) between 1 and 500),
  clicks integer not null check (clicks >= 0),
  impressions integer not null check (impressions >= 0),
  -- Average position over the 90 days ending at the read.
  position numeric(7,2) not null check (position >= 0),
  primary key (site, day, query)
);

alter table public.search_console_snapshots enable row level security;

revoke all on public.search_console_snapshots from anon, authenticated;
grant all on public.search_console_snapshots to service_role;
grant select on public.search_console_snapshots to authenticated;
grant select, insert, update on public.search_console_snapshots to propaganda_scout;

create policy "members read" on public.search_console_snapshots for select to authenticated
  using (site in (select private.my_sites()));
create policy "scout" on public.search_console_snapshots for all to propaganda_scout using (true) with check (true);
