-- Decouple Post ID from URL slug.
-- post_id: system-managed {PREFIX}·{SEQ}, changes when collection is renamed.
-- slug: URL-friendly, editable by the author, does not auto-change after publish.
--
-- Migration: backfill post_id from the existing slug column (they had the same value).

alter table public.posts add column if not exists post_id text;

-- Backfill: existing rows get post_id = their current slug value.
update public.posts set post_id = slug where post_id is null;

create index if not exists posts_post_id_idx on public.posts (post_id);
