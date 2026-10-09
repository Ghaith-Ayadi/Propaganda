-- DRAFT: moves to supabase/migrations only after Ayadi's own yes in the thread.
--
-- Admin > Arena (worker/src/arena.ts, app/src/components/admin/ArenaPage.tsx):
-- Ayadi's blind votes between models on the same real agent task. One row per
-- vote, with every answer as it was shown and what each one cost.
--
-- Additive only: one new table. Superadmins read and write it; nobody else
-- sees it (no policy for anyone else, grants only to authenticated).

create table public.arena_votes (
  id text primary key default private.new_id() check (id ~ '^[a-z0-9]{15}$'),
  agent text not null check (agent in ('pitcher', 'listener')),
  -- The tenant whose real task it was. Kept if the tenant goes: it's a benchmark.
  site text not null check (site ~ '^[a-z0-9]{15}$'),
  task text not null default '' check (char_length(task) <= 500),
  models text[] not null check (cardinality(models) between 2 and 3),
  -- The model picked; null when none was good enough.
  winner text check (winner is null or winner = any (models)),
  -- [{model, answer, raw, problem, error, costUsd, inputTokens, outputTokens, ms}] in the order shown.
  entries jsonb not null check (jsonb_typeof(entries) = 'array'),
  -- What each answer cost, in the order of models.
  costs numeric(12, 6)[] not null check (cardinality(costs) = cardinality(models)),
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  note text not null default '' check (char_length(note) <= 2000),
  voted_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created timestamptz not null default private.ms_now()
);
create index arena_votes_agent on public.arena_votes (agent, created desc);

alter table public.arena_votes enable row level security;
revoke all on public.arena_votes from anon, authenticated;
grant select, insert on public.arena_votes to authenticated;
grant all on public.arena_votes to service_role;

create policy "superadmins read votes" on public.arena_votes
  for select to authenticated using (public.is_superadmin());
create policy "superadmins vote as themselves" on public.arena_votes
  for insert to authenticated with check (public.is_superadmin() and voted_by = auth.uid());
