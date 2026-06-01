-- Hidden collections: keep the row + posts, but the public blog hides the
-- tab and refuses to render articles inside (shows a "private" failure page).
-- Local-only "drafts at the collection level" — author still sees them.

alter table public.collections
  add column if not exists is_hidden boolean not null default false;
