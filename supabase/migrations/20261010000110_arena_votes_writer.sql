-- Arena writing and Chat rounds: votes for the Writer and Chat.
-- Approved by Ayadi ("Yes", 2026-10-18 15:50Z, for 20261010000110_arena_votes_writer.sql).
--
-- arena_votes (20261009000090) allows only the agents 'pitcher' and 'listener' and
-- two or three models, so a writing vote (four rivals) or a Chat replay vote (five)
-- cannot be saved; the Arena keeps those votes in the browser until this ships.
-- This widens both checks. No row changes, no column or table added or removed, so
-- every existing row still satisfies the new checks and the grants and policies
-- (superadmins only, anon and authenticated otherwise revoked) are untouched.

alter table public.arena_votes drop constraint arena_votes_agent_check;
alter table public.arena_votes add constraint arena_votes_agent_check check (agent in ('pitcher', 'listener', 'writer', 'chat'));

alter table public.arena_votes drop constraint arena_votes_models_check;
alter table public.arena_votes add constraint arena_votes_models_check check (cardinality(models) between 2 and 5);
