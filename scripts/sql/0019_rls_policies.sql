-- RLS policies.
--
-- RLS was switched on for every public table, which with no policies present
-- denies everything to the anon key: the reader rendered an empty site and the
-- editor could not INSERT ("new row violates row-level security policy").
--
-- The split below is the whole model:
--   anon          — the public reader. Published posts and the site chrome it
--                   needs to render them. No writes, ever.
--   authenticated — the author, signed in through Supabase Auth. Full CRUD.
--   service_role  — scripts and the MCP server. Bypasses RLS by definition,
--                   so it needs no policy here.
--
-- Legacy Payload tables (payload_*, users, users_sessions) and posts_tags are
-- deliberately left with zero policies: nothing in the app reads them through
-- the anon key, so they stay reachable only by service_role.
--
-- Single-tenant assumption: `authenticated` means "the author". When Propaganda
-- grows a second tenant these become per-tenant predicates rather than true.

-- posts ─────────────────────────────────────────────────────────────────────
-- The reader only ever queries status='published'; anything else stays private.
-- Posts in a hidden collection are still returned here and gated by the reader,
-- exactly as before this migration.
drop policy if exists posts_public_read on public.posts;
create policy posts_public_read on public.posts
  for select to anon
  using (status = 'published');

drop policy if exists posts_author_all on public.posts;
create policy posts_author_all on public.posts
  for all to authenticated
  using (true) with check (true);

-- collections ───────────────────────────────────────────────────────────────
-- Names, emoji and position drive the public nav, and the reader resolves
-- is_hidden itself, so the row is readable while the bodies behind a hidden
-- collection are not.
drop policy if exists collections_public_read on public.collections;
create policy collections_public_read on public.collections
  for select to anon
  using (true);

drop policy if exists collections_author_all on public.collections;
create policy collections_author_all on public.collections
  for all to authenticated
  using (true) with check (true);

-- app_settings ──────────────────────────────────────────────────────────────
-- Site title, tagline, author bio, favicon: all of it is rendered publicly.
drop policy if exists app_settings_public_read on public.app_settings;
create policy app_settings_public_read on public.app_settings
  for select to anon
  using (true);

drop policy if exists app_settings_author_all on public.app_settings;
create policy app_settings_author_all on public.app_settings
  for all to authenticated
  using (true) with check (true);

-- Author-only tables ────────────────────────────────────────────────────────
-- Version history, planning briefs and writing stats are editor-side only.
drop policy if exists post_versions_author_all on public.post_versions;
create policy post_versions_author_all on public.post_versions
  for all to authenticated
  using (true) with check (true);

drop policy if exists briefs_author_all on public.briefs;
create policy briefs_author_all on public.briefs
  for all to authenticated
  using (true) with check (true);

drop policy if exists brief_templates_author_all on public.brief_templates;
create policy brief_templates_author_all on public.brief_templates
  for all to authenticated
  using (true) with check (true);

drop policy if exists writing_activity_author_all on public.writing_activity;
create policy writing_activity_author_all on public.writing_activity
  for all to authenticated
  using (true) with check (true);
