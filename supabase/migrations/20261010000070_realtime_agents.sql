-- Live in the app without a refresh: what the agents write. The Strategist's
-- proposals and approved goals, the Pitcher's pitches and the Writer's drafts
-- in review (briefs), and the content batches. Events only say "this row
-- changed" and reach members of the row's site (row-level security applies);
-- the app re-reads (lib/realtime.ts, lib/serverChanges.ts).
--
-- Only adds tables to the publication: no data is touched.
alter publication supabase_realtime add table
  public.strategy_proposals, public.goal_versions, public.content_batches, public.briefs;
