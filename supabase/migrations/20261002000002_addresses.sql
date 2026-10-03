-- Post numbers and addresses: pb_hooks/addresses.pb.js and pb_hooks/lib/addresses.js
-- as triggers. Behaviour is the same, rule for rule:
--
--   number    handed out from the site's counter when a post is created: never
--             reused, even after a delete, and never changed afterwards.
--             Whatever a client sends is ignored.
--   address   /<collection slug>/<post slug>. The app keeps the slug in step
--             with the title until the post is first published; after that only
--             an explicit edit changes it. A post that has been published keeps
--             an address unique in its collection (a clash gets -2, -3, ...), and
--             moving it, to another slug or another collection, leaves a
--             post_redirects row at the old address so old links keep working.
--             "Has been published" is private.has_address: published now, or
--             published_at set (never cleared, so unpublishing doesn't free the
--             address).
--   collection slug   the collection's URL segment: from its name, unique in
--             its site, following the name when the collection is renamed.
--
-- PocketBase ran one write at a time; Postgres doesn't, so address changes in
-- one (site, collection) take a transaction-scoped advisory lock first.

/** First path segments the app or the edge already own. Keep in step with app/src/lib/slug.ts. */
create function private.reserved_collection_slugs() returns text[]
language sql immutable set search_path = '' as $$
  select array['admin', 'api', 'assets', 'cards', 'p']
$$;

/** "Café au lait!" -> "cafe-au-lait". Empty when nothing usable is left. Same as app/src/lib/slug.ts. */
create function private.slugify(input text) returns text
language sql stable set search_path = '' as $$
  select regexp_replace(
    left(
      btrim(
        regexp_replace(
          regexp_replace(
            lower(regexp_replace(normalize(coalesce(input, ''), NFKD), '[̀-ͯ]', '', 'g')),
            '[''’`]', '', 'g'),
          '[^a-z0-9]+', '-', 'g'),
        '-'),
      80),
    '-+$', '')
$$;

create function private.has_address(status text, published_at timestamptz) returns boolean
language sql immutable set search_path = '' as $$
  select status = 'published' or published_at is not null
$$;

/** URL segment of the collection called `name` in `site`: its slug, else its name slugified. */
create function private.collection_slug(p_site text, p_name text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    nullif((select c.slug from public.collections c where c.site = p_site and c.name = p_name), ''),
    nullif(private.slugify(p_name), ''),
    'collection')
$$;

/**
 * Whether /<p_col>/<p_slug> in `p_site` belongs to anyone but `p_post`: a post
 * of the collection `p_type` that has been published, or a redirect.
 */
create function private.address_taken(p_site text, p_type text, p_col text, p_slug text, p_post text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
      select 1 from public.posts p
      where p.site = p_site and p.type = p_type and p.slug = p_slug
        and private.has_address(p.status, p.published_at) and p.id <> p_post)
    or exists (
      select 1 from public.post_redirects r
      where r.site = p_site and r.collection = p_col and r.slug = p_slug and r.post <> p_post)
$$;

/** base, base-2, base-3, ...: the first free one. */
create function private.free_post_slug(p_site text, p_type text, p_col text, p_base text, p_post text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  candidate text := p_base;
  n integer := 2;
begin
  while private.address_taken(p_site, p_type, p_col, candidate, p_post) loop
    candidate := p_base || '-' || n;
    n := n + 1;
  end loop;
  return candidate;
end
$$;

create function private.collection_slug_taken(p_site text, p_slug text, p_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_slug = any (private.reserved_collection_slugs())
      or exists (select 1 from public.collections c where c.site = p_site and c.slug = p_slug and c.id <> p_id)
$$;

create function private.free_collection_slug(p_site text, p_base text, p_id text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  candidate text := p_base;
  n integer := 2;
begin
  while private.collection_slug_taken(p_site, candidate, p_id) loop
    candidate := p_base || '-' || n;
    n := n + 1;
  end loop;
  return candidate;
end
$$;

create function private.lock_addresses(p_site text, p_type text) returns void
language sql volatile set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended('propaganda.address:' || p_site || ':' || coalesce(p_type, ''), 0))
$$;

-- ---- posts ----

create function private.post_addresses() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  had boolean;
  col text;
  old_col text;
  base text;
begin
  if private.importing() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- One statement, so two creates at once can't draw the same number.
    update private.site_internals set post_counter = post_counter + 1
      where site = new.site
      returning post_counter into new.number;
    -- No such site: leave it to the foreign key to say so.
    new.number := coalesce(new.number, 0);

    if private.has_address(new.status, new.published_at) then
      -- Created already published (an import, a copy): its address must be free.
      perform private.lock_addresses(new.site, new.type);
      col := private.collection_slug(new.site, new.type);
      base := coalesce(nullif(private.slugify(new.slug), ''), nullif(private.slugify(new.title), ''), 'untitled');
      new.slug := private.free_post_slug(new.site, new.type, col, base, new.id);
    end if;
    return new;
  end if;

  -- A post's number never changes.
  new.number := old.number;

  had := private.has_address(old.status, old.published_at);
  -- Most updates are content saves: nothing to do unless the address changes.
  if not private.has_address(new.status, new.published_at)
     or (had and new.type is not distinct from old.type and new.slug is not distinct from old.slug) then
    return new;
  end if;

  perform private.lock_addresses(new.site, new.type);
  col := private.collection_slug(new.site, new.type);
  base := coalesce(nullif(private.slugify(new.slug), ''), nullif(private.slugify(new.title), ''), 'untitled');
  new.slug := private.free_post_slug(new.site, new.type, col, base, new.id);

  if had and old.slug <> '' and (new.type <> old.type or new.slug <> old.slug) then
    -- The old address now points here. Looked up before a renamed collection
    -- takes its new name (the app moves the posts first), so it's the old slug.
    old_col := private.collection_slug(new.site, old.type);
    insert into public.post_redirects (site, collection, slug, post)
      values (new.site, old_col, old.slug, new.id)
      on conflict (site, collection, slug) do update set post = excluded.post
        where public.post_redirects.post <> excluded.post;
  end if;

  -- Back at one of its old addresses: that redirect has nothing left to do.
  delete from public.post_redirects r
    where r.site = new.site and r.collection = col and r.slug = new.slug and r.post = new.id;
  return new;
end
$$;

-- After `stamp`, so the address logic sees the row as it will be stored.
create trigger zz_addresses before insert or update on public.posts
  for each row execute function private.post_addresses();

-- ---- collections ----

create function private.collection_addresses() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  base text;
  cur text;
begin
  if private.importing() then
    return new;
  end if;
  base := coalesce(nullif(private.slugify(new.name), ''), 'collection');
  perform private.lock_addresses(new.site, null);

  if tg_op = 'INSERT' then
    new.slug := private.free_collection_slug(new.site, base, new.id);
    return new;
  end if;

  -- Clients don't set the slug; it follows the name.
  cur := old.slug;
  new.slug := cur;
  if new.name is distinct from old.name or cur = '' then
    -- Keep the slug when the new name still gives it ("Essays" -> "ESSAYS").
    if cur <> '' and regexp_replace(cur, '-\d+$', '') = base
       and not private.collection_slug_taken(new.site, cur, new.id) then
      new.slug := cur;
    else
      new.slug := private.free_collection_slug(new.site, base, new.id);
    end if;
  end if;
  return new;
end
$$;

create trigger zz_addresses before insert or update on public.collections
  for each row execute function private.collection_addresses();
