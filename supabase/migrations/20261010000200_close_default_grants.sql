-- Close the table grants that 20261008000030 meant to narrow.
--
-- That migration granted members only some columns (update (state) on
-- content_batches; insert (site, notes) and update (notes) on taste_profiles)
-- and only some verbs on the rest. But Supabase's default privileges had already
-- granted every new table to anon and authenticated in full, and a column grant
-- adds to a table grant, it doesn't replace it. So a member could also write
-- columns the grants were written to keep out: a batch's quota, the Pitcher's
-- taste summary, and so on. Row-level security still held every write to the
-- member's own site; this removes the rest.
--
-- Each table is revoked from anon and authenticated, then given back exactly
-- what 20261008000030 listed. No data changes; nothing the app does today
-- needs more than that.

revoke all on public.agent_ideas, public.voice_guides, public.agent_settings,
  public.content_batches, public.taste_log, public.taste_profiles
  from anon, authenticated;

grant select on public.agent_ideas to authenticated;
grant select, insert, update on public.voice_guides to authenticated;
grant select, insert, update on public.agent_settings to authenticated;
grant select on public.content_batches to authenticated;
grant update (state) on public.content_batches to authenticated;
grant select, insert on public.taste_log to authenticated;
grant select on public.taste_profiles to authenticated;
grant insert (site, notes), update (notes) on public.taste_profiles to authenticated;
