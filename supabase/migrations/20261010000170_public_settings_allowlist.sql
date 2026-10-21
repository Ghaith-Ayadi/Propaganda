-- Site settings: only the public ones are readable without a key (Ayadi,
-- 2026-10-21).
--
-- 20261002000003 let anyone read every app_settings row, because the blog
-- reads its design and author line anonymously. But the table also holds what
-- only members should see: the voice guide, the plan size, onboarding answers,
-- the unpublished design draft, hosting choices. So reading is split in two:
--
--   public   the keys the public blog renders (site identity, author, the
--            published design and the site's own themes, the AI crawler
--            rule the server-rendered blog applies): anyone
--   the rest members of the row's site only
--
-- Writes are unchanged (members, from 20261002000003). Realtime follows the
-- same policies, so an anonymous blog hears only the public keys. The Design
-- panel hands its draft to the preview frame by message, not through this
-- table.
--
-- No data change: it replaces one read policy and adds two.

drop policy "anyone reads settings" on public.app_settings;

create policy "public settings" on public.app_settings for select
  to anon, authenticated
  using (key in (
    'site.title', 'site.tagline', 'site.manifesto', 'favicon.url',
    'author.name', 'author.tagline', 'author.location', 'author.avatar', 'author.bio', 'author.links',
    'blog.design', 'blog.themes', 'blog.ai_crawlers'
  ));

create policy "members read settings" on public.app_settings for select
  to authenticated
  using (site in (select private.my_sites()));
