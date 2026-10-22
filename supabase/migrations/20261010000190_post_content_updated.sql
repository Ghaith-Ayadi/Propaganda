-- A post's "updated" date for readers: when its content last changed.
--
-- `posts.updated` moves on every write (a publish, a favourite, a collection
-- move, a sync), so the date a blog page, its sitemap, feed, JSON-LD and
-- Markdown copy show as "updated" moved too, and search engines were told a
-- post had changed when nothing a reader sees had. `content_updated` moves
-- only when the title, subtitle, excerpt or body changes. Clients never set
-- it: the trigger below decides, like the stamps.
--
-- Additive only: one column with a default, backfilled from `updated`, and
-- one trigger. No existing column, policy or row changes. Anyone who can read
-- a post (the published-posts policy) can read it.

alter table public.posts
  add column content_updated timestamptz not null default private.ms_now();

update public.posts set content_updated = updated;

create function private.stamp_content_updated() returns trigger
language plpgsql set search_path = '' as $$
begin
  if private.importing() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.content_updated := private.ms_now();
  elsif new.title is distinct from old.title
     or new.subtitle is distinct from old.subtitle
     or new.excerpt is distinct from old.excerpt
     or new.content_md is distinct from old.content_md then
    new.content_updated := private.ms_now();
  else
    new.content_updated := old.content_updated;
  end if;
  return new;
end
$$;

-- Fires after "stamp" (before triggers run in name order), so `updated` is set first.
create trigger stamp_content before insert or update on public.posts
  for each row execute function private.stamp_content_updated();
