-- Comments on a post or a pitch, Google Docs style (Ayadi, 2026-10-15).
--
-- A contextual comment is anchored to a passage: it keeps the quoted words and
-- a little of the text around them, and the app finds them again in the text
-- (the same way the Review tab's highlights do), so nothing is written into the
-- post and the markdown stays clean. A general comment has no quote. A reply
-- points at the comment that opened its thread. 'submitted' is null while a
-- comment is a draft that waits to be sent with the rest (the pitch dialog sends
-- them in one batch); the editor submits at once.
--
-- Additive only: one new table. Members of the site read and write; nobody else.

create table public.comments (
  id text primary key default private.new_id() check (id ~ '^[a-z0-9]{15}$'),
  site text not null references public.sites (id),
  -- What it is about: a post or a pitch (brief). Not foreign keys: the app
  -- removes a target's comments with it.
  target_kind text not null check (target_kind in ('post', 'brief')),
  target_id text not null check (target_id ~ '^[a-z0-9]{15}$'),
  parent text references public.comments (id) on delete cascade,
  -- The highlighted words and the text before and after them; null for a general comment.
  quote text check (quote is null or char_length(quote) between 1 and 2000),
  context_before text not null default '' check (char_length(context_before) <= 200),
  context_after text not null default '' check (char_length(context_after) <= 200),
  body text not null check (char_length(body) between 1 and 10000),
  resolved boolean not null default false,
  author uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author_name text not null default '' check (char_length(author_name) <= 200),
  submitted timestamptz,
  created timestamptz not null default private.ms_now(),
  updated timestamptz not null default private.ms_now(),
  constraint comments_reply_is_general check (parent is null or quote is null)
);
create index comments_target_idx on public.comments (site, target_kind, target_id);
create index comments_parent_idx on public.comments (parent) where parent is not null;

create trigger stamp before insert or update on public.comments
  for each row execute function private.stamp_created_updated();
create trigger site_stays_put before update of site on public.comments
  for each row execute function private.site_stays_put();

alter table public.comments enable row level security;
revoke all on public.comments from anon, authenticated;
grant select, insert, update, delete on public.comments to authenticated;
grant all on public.comments to service_role;

create policy "members read" on public.comments for select to authenticated
  using (site in (select private.my_sites()));
create policy "members insert as themselves" on public.comments for insert to authenticated
  with check (site in (select private.my_sites()) and author = auth.uid());
-- Anyone on the site may resolve a thread; the app only rewrites its own comments.
create policy "members update" on public.comments for update to authenticated
  using (site in (select private.my_sites()))
  with check (site in (select private.my_sites()));
create policy "author deletes" on public.comments for delete to authenticated
  using (site in (select private.my_sites()) and author = auth.uid());

alter publication supabase_realtime add table public.comments;
