-- Propaganda on Postgres: the tables. A port of pb/pb_migrations 1758000000 to
-- 1758000007 (the schema PocketBase has today), collection for collection.
--
-- What carries over unchanged:
--   - Record ids. Every id is the 15-char [a-z0-9] string PocketBase used, and
--     the app keeps minting them on the client (lib/ids.ts newId), so the
--     import copies rows with their ids and nothing is re-keyed. Users are the
--     exception: auth.users ids are uuids, and a migrated account keeps its
--     PocketBase id in app_metadata.pb_id.
--   - Empty values. PocketBase stores "" for empty text and 0 for empty
--     numbers; those columns stay NOT NULL with the same defaults, so filters
--     like `slug <> ''` mean what they meant. Dates are the exception: an empty
--     date is NULL here ("" was PocketBase's).
--   - created / updated. Stamped by the server (private.stamp_*), to the
--     millisecond, which is what the app's sync cursors compare against.
--
-- What moved: hooks became triggers and functions (20261002000002), rules
-- became row-level security (20261002000003), routes became RPCs
-- (20261002000004).

-- Helpers live in `private`, which PostgREST doesn't serve. Policies call some
-- of them as the requesting role, hence the usage grant.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

-- ---- helpers ----

/** A PocketBase-shaped id: 15 chars of [a-z0-9]. */
create function private.new_id() returns text
language sql volatile set search_path = '' as $$
  select string_agg(substr('abcdefghijklmnopqrstuvwxyz0123456789', (get_byte(r.b, i) % 36) + 1, 1), '')
  from (select extensions.gen_random_bytes(15) as b) r, generate_series(0, 14) as i
$$;

/**
 * True inside the PocketBase import (supabase/import): a direct connection as
 * the database owner that set propaganda.importing = on. Then rows keep the
 * timestamps, numbers and slugs they had, and no trigger rewrites them. API
 * requests connect as `authenticator`, so they can never be in this mode.
 */
create function private.importing() returns boolean
language sql stable set search_path = '' as $$
  select session_user in ('postgres', 'supabase_admin')
     and coalesce(current_setting('propaganda.importing', true), '') = 'on'
$$;

/** Server time to the millisecond: the precision the app's cursors keep. */
create function private.ms_now() returns timestamptz
language sql volatile set search_path = '' as $$
  select date_trunc('milliseconds', clock_timestamp())
$$;

-- `created` once, `updated` on every write. Clients can't set either.
create function private.stamp_created_updated() returns trigger
language plpgsql set search_path = '' as $$
declare
  t timestamptz := private.ms_now();
begin
  if private.importing() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created := t;
  else
    new.created := old.created;
  end if;
  new.updated := t;
  return new;
end
$$;

create function private.stamp_created() returns trigger
language plpgsql set search_path = '' as $$
begin
  if private.importing() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created := private.ms_now();
  else
    new.created := old.created;
  end if;
  return new;
end
$$;

create function private.stamp_updated() returns trigger
language plpgsql set search_path = '' as $$
begin
  if private.importing() then
    return new;
  end if;
  new.updated := private.ms_now();
  return new;
end
$$;

/** Records never move between sites (PocketBase: the `staysPut` rule). */
create function private.site_stays_put() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.site is distinct from old.site then
    raise exception 'A record can''t move to another site.' using errcode = '42501';
  end if;
  return new;
end
$$;

-- ---- sites and memberships ----

create table public.sites (
  id text primary key default private.new_id() check (id ~ '^[a-z0-9]{15}$'),
  name text not null check (char_length(name) between 1 and 120),
  -- Also the blog's subdomain (<slug>.propaganda.pub): see private.valid_site_slug.
  slug text not null check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$'),
  -- A custom host, set by hand (it has to be configured in Vercel and Caddy too).
  domain text not null default '' check (char_length(domain) <= 253),
  analytics_tenant text not null default '' check (char_length(analytics_tenant) <= 96),
  created timestamptz not null default private.ms_now(),
  updated timestamptz not null default private.ms_now()
);
create unique index sites_slug_key on public.sites (slug);
create unique index sites_domain_key on public.sites (domain) where domain <> '';

-- What PocketBase kept in hidden fields of `sites`: never readable through the
-- API (row-level security on, no policy).
create table private.site_internals (
  site text primary key references public.sites (id) on delete cascade,
  -- The last post number handed out (private.assign_post_number).
  post_counter integer not null default 0,
  created_by uuid references auth.users (id) on delete set null
);

create table public.site_members (
  id text primary key default private.new_id() check (id ~ '^[a-z0-9]{15}$'),
  site text not null references public.sites (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'editor')),
  created timestamptz not null default private.ms_now(),
  updated timestamptz not null default private.ms_now(),
  unique (site, user_id)
);
create index site_members_user_idx on public.site_members (user_id);

-- ---- content ----

create table public.posts (
  id text primary key default private.new_id() check (id ~ '^[a-z0-9]{15}$'),
  site text not null references public.sites (id),
  -- The Supabase-era integer id of the posts migrated to PocketBase; audit only.
  legacy_id integer not null default 0,
  -- Per-site counter, assigned on insert, never changed (20261002000002).
  number integer not null default 0,
  title text not null default '',
  slug text not null default '',
  post_id text not null default '',
  -- The collection, by name.
  type text not null default '',
  status text not null default '' check (status in ('', 'draft', 'done', 'published')),
  subtitle text not null default '',
  done_at timestamptz,
  published_at timestamptz,
  excerpt text not null default '',
  category text not null default '',
  tags jsonb check (tags is null or octet_length(tags::text) <= 4000),
  content_md text not null default '' check (char_length(content_md) <= 2000000),
  notion_id text not null default '',
  favorited boolean not null default false,
  collection_seq integer not null default 0,
  word_count integer not null default 0,
  shareable_quotes jsonb check (shareable_quotes is null or octet_length(shareable_quotes::text) <= 20000),
  created timestamptz not null default private.ms_now(),
  updated timestamptz not null default private.ms_now()
);
create unique index posts_legacy_id_key on public.posts (legacy_id) where legacy_id <> 0;
create unique index posts_site_number_key on public.posts (site, number) where number > 0;
create index posts_slug_idx on public.posts (slug);
create index posts_post_id_idx on public.posts (post_id);
create index posts_type_seq_idx on public.posts (type, collection_seq);
create index posts_status_updated_idx on public.posts (status, updated);
create index posts_site_slug_idx on public.posts (site, slug);
create index posts_site_updated_idx on public.posts (site, updated);

create table public.post_versions (
  id text primary key default private.new_id() check (id ~ '^[a-z0-9]{15}$'),
  site text not null references public.sites (id),
  post text not null references public.posts (id) on delete cascade,
  version integer not null,
  content text not null default '' check (char_length(content) <= 2000000),
  attributes jsonb check (attributes is null or octet_length(attributes::text) <= 50000),
  created_by text not null check (created_by in ('user', 'mcp:claude-code', 'migration')),
  message text not null default '',
  -- When the snapshot was taken on the author's device; `created` is when the
  -- server received it, which can be much later for one made offline.
  authored timestamptz,
  legacy_id text not null default '' check (char_length(legacy_id) <= 64),
  created timestamptz not null default private.ms_now(),
  constraint post_versions_post_version_key unique (post, version)
);
create index post_versions_authored_idx on public.post_versions (authored);
create index post_versions_site_created_idx on public.post_versions (site, created);

create table public.collections (
  id text primary key default private.new_id() check (id ~ '^[a-z0-9]{15}$'),
  site text not null references public.sites (id),
  name text not null check (name <> ''),
  -- From the name, unique in the site; clients never set it (20261002000002).
  slug text not null default '' check (char_length(slug) <= 80),
  emoji text not null default '',
  description text not null default '',
  position integer not null default 0,
  is_hidden boolean not null default false,
  created timestamptz not null default private.ms_now(),
  updated timestamptz not null default private.ms_now(),
  constraint collections_site_name_key unique (site, name)
);
create unique index collections_site_slug_key on public.collections (site, slug) where slug <> '';

create table public.brief_templates (
  id text primary key default private.new_id() check (id ~ '^[a-z0-9]{15}$'),
  site text not null references public.sites (id),
  name text not null default '',
  body text not null default '' check (char_length(body) <= 500000),
  checks jsonb check (checks is null or octet_length(checks::text) <= 20000),
  tenant text not null default '',
  created timestamptz not null default private.ms_now(),
  updated timestamptz not null default private.ms_now()
);
create index brief_templates_site_idx on public.brief_templates (site);

create table public.briefs (
  id text primary key default private.new_id() check (id ~ '^[a-z0-9]{15}$'),
  site text not null references public.sites (id),
  title text not null default '',
  status text not null check (status in ('backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled')),
  assignee_ids jsonb check (assignee_ids is null or octet_length(assignee_ids::text) <= 4000),
  planned_date text not null default '',
  tags jsonb check (tags is null or octet_length(tags::text) <= 4000),
  -- PocketBase cleared a non-cascading relation when its target went.
  template text references public.brief_templates (id) on delete set null,
  collection_name text not null default '',
  body text not null default '' check (char_length(body) <= 500000),
  checks jsonb check (checks is null or octet_length(checks::text) <= 20000),
  post text references public.posts (id) on delete set null,
  tenant text not null default '',
  created timestamptz not null default private.ms_now(),
  updated timestamptz not null default private.ms_now()
);
create index briefs_status_idx on public.briefs (status);
create index briefs_planned_idx on public.briefs (planned_date);
create index briefs_post_idx on public.briefs (post);
create index briefs_site_idx on public.briefs (site);

create table public.app_settings (
  id text primary key default private.new_id() check (id ~ '^[a-z0-9]{15}$'),
  site text not null references public.sites (id),
  key text not null check (key <> ''),
  -- May be false, 0, "" or null (feature flags, cleared bios).
  value jsonb check (value is null or octet_length(value::text) <= 200000),
  updated timestamptz not null default private.ms_now(),
  constraint app_settings_site_key_key unique (site, key)
);

-- day is "YYYY-MM-DD" text on purpose: the app keys on the calendar day, and a
-- date type would drag time zones into equality checks.
create table public.writing_activity (
  id text primary key default private.new_id() check (id ~ '^[a-z0-9]{15}$'),
  site text not null references public.sites (id),
  tenant text not null,
  day text not null check (day ~ '^\d{4}-\d{2}-\d{2}$'),
  words integer not null default 0 check (words >= 0),
  updated timestamptz not null default private.ms_now(),
  constraint writing_activity_site_day_key unique (site, day)
);
create index writing_activity_tenant_day_idx on public.writing_activity (tenant, day);

-- An old address of a post: written by the address triggers when a post that
-- has been published changes slug or collection.
create table public.post_redirects (
  id text primary key default private.new_id() check (id ~ '^[a-z0-9]{15}$'),
  site text not null references public.sites (id) on delete cascade,
  collection text not null check (collection <> '' and char_length(collection) <= 80),
  slug text not null check (slug <> '' and char_length(slug) <= 200),
  post text not null references public.posts (id) on delete cascade,
  created timestamptz not null default private.ms_now(),
  constraint post_redirects_address_key unique (site, collection, slug)
);
create index post_redirects_post_idx on public.post_redirects (post);

-- ---- stamps ----

create trigger stamp before insert or update on public.sites
  for each row execute function private.stamp_created_updated();
create trigger stamp before insert or update on public.site_members
  for each row execute function private.stamp_created_updated();
create trigger stamp before insert or update on public.posts
  for each row execute function private.stamp_created_updated();
create trigger stamp before insert or update on public.post_versions
  for each row execute function private.stamp_created();
create trigger stamp before insert or update on public.collections
  for each row execute function private.stamp_created_updated();
create trigger stamp before insert or update on public.brief_templates
  for each row execute function private.stamp_created_updated();
create trigger stamp before insert or update on public.briefs
  for each row execute function private.stamp_created_updated();
create trigger stamp before insert or update on public.app_settings
  for each row execute function private.stamp_updated();
create trigger stamp before insert or update on public.writing_activity
  for each row execute function private.stamp_updated();
create trigger stamp before insert or update on public.post_redirects
  for each row execute function private.stamp_created();

-- ---- records stay in their site ----

create trigger site_stays_put before update of site on public.site_members
  for each row execute function private.site_stays_put();
create trigger site_stays_put before update of site on public.posts
  for each row execute function private.site_stays_put();
create trigger site_stays_put before update of site on public.post_versions
  for each row execute function private.site_stays_put();
create trigger site_stays_put before update of site on public.collections
  for each row execute function private.site_stays_put();
create trigger site_stays_put before update of site on public.brief_templates
  for each row execute function private.site_stays_put();
create trigger site_stays_put before update of site on public.briefs
  for each row execute function private.site_stays_put();
create trigger site_stays_put before update of site on public.app_settings
  for each row execute function private.site_stays_put();
create trigger site_stays_put before update of site on public.writing_activity
  for each row execute function private.site_stays_put();
create trigger site_stays_put before update of site on public.post_redirects
  for each row execute function private.site_stays_put();

/** A version always lives in its post's site (pb_hooks/tenancy.pb.js). */
create function private.version_in_post_site() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  post_site text;
begin
  select p.site into post_site from public.posts p where p.id = new.post;
  -- No such post: the foreign key reports it, which the app reads as "push
  -- the post first, retry the version later".
  if post_site is not null and post_site <> new.site then
    raise exception 'A version must be in its post''s site.' using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger version_in_post_site before insert or update of site, post on public.post_versions
  for each row execute function private.version_in_post_site();

-- Every site has its internals row, from the start.
create function private.site_internals_row() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.site_internals (site) values (new.id) on conflict do nothing;
  return new;
end
$$;
create trigger site_internals_row after insert on public.sites
  for each row execute function private.site_internals_row();
