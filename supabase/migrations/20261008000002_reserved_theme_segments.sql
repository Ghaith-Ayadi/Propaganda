-- Blog themes (docs/blog-themes.md). Approved by Ayadi 2026-10-08.
-- Blog themes add /author and keep feed, rss, search and tags for later, so no
-- new collection may take those slugs. Same list as app/src/lib/slug.ts.
-- Additive: an existing collection that already has one of these slugs keeps it
-- (its page would be shadowed by the themed blog's route; check before deploying:
--   select site, name, slug from public.collections
--   where slug in ('author', 'feed', 'rss', 'search', 'tags');
create or replace function private.reserved_collection_slugs() returns text[]
language sql immutable set search_path = '' as $$
  select array['admin', 'api', 'assets', 'author', 'cards', 'feed', 'p', 'rss', 'search', 'tags']
$$;
