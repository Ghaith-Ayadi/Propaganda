-- PocketBase's custom routes as functions, called through PostgREST
-- (`supabase.rpc(...)`, i.e. POST /rest/v1/rpc/<name>):
--
--   POST   /api/propaganda/sites           -> create_site(site_name, site_slug)
--   PATCH  /api/propaganda/sites/{id}      -> update_site(site_id, site_name, site_slug)
--   DELETE /api/propaganda/sites/{id}      -> delete_site(site_id)
--   POST   /api/verbose/increment          -> increment_writing_activity(p_site, p_day, p_delta)
--   GET    /api/propaganda/tls-check       -> tls_check(domain)   (Caddy's on-demand TLS)
--
-- Errors carry the same messages, and PostgREST turns their codes into the
-- same statuses: 42501 -> 401 signed out / 403 signed in, 22023 -> 400,
-- PT404 -> 404.

/**
 * A site slug is also its subdomain (<slug>.propaganda.pub): lowercase letters,
 * digits and dashes, 2 to 40 chars, no leading or trailing dash, not IDN-style
 * ("xn--...", or any "--" in third and fourth place), and not one of the
 * platform's own hosts. Same list as pb/pb_hooks/lib/tenancy.js.
 */
create function private.valid_site_slug(s text) returns boolean
language sql immutable set search_path = '' as $$
  select s ~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$'
     and substr(s, 3, 2) <> '--'
     and not s = any (array[
       -- in use: the editor and API, the marketing site, the custom-domain target
       'app', 'www', 'api', 'domains',
       -- mail and DNS
       'mail', 'email', 'smtp', 'imap', 'pop', 'mx', 'ns', 'ns1', 'ns2', 'dns',
       -- hosts a platform tends to need
       'admin', 'assets', 'static', 'cdn', 'media', 'images', 'files', 'uploads',
       'blog', 'docs', 'help', 'support', 'status', 'community', 'developers', 'dev',
       'staging', 'preview', 'test', 'demo', 'beta', 'sandbox',
       'auth', 'login', 'logout', 'signup', 'signin', 'sso', 'oauth', 'account',
       'accounts', 'billing', 'pay', 'settings', 'dashboard', 'analytics',
       -- from the path-based addresses
       'about', 'new', 'site', 'sites', '_'])
$$;

create function private.require_user() returns uuid
language plpgsql stable set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  return uid;
end
$$;

create function private.is_owner(p_site text, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.site_members m
    where m.site = p_site and m.user_id = p_user and m.role = 'owner')
$$;

-- ---- sites ----

/** A new site owned by the caller. The site and its owner membership appear together. */
create function public.create_site(site_name text, site_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  n text := left(btrim(coalesce(site_name, '')), 120);
  s text := lower(btrim(coalesce(site_slug, '')));
  created public.sites;
  membership public.site_members;
begin
  if n = '' then
    raise exception 'A site needs a name.' using errcode = '22023';
  end if;
  if not private.valid_site_slug(s) then
    raise exception 'That address isn''t available: use 2 to 40 lowercase letters, digits or dashes.'
      using errcode = '22023', detail = 'slug: invalid';
  end if;
  if exists (select 1 from public.sites x where x.slug = s) then
    raise exception 'That address is taken.' using errcode = '22023', detail = 'slug: taken';
  end if;
  -- Soft cap so an open sign-up can't mint sites in a loop.
  if (select count(*) from public.site_members m where m.user_id = uid) >= 20 then
    raise exception 'You already belong to 20 sites.' using errcode = '22023';
  end if;

  insert into public.sites (name, slug, analytics_tenant) values (n, s, s) returning * into created;
  update private.site_internals set created_by = uid where site = created.id;
  insert into public.site_members (site, user_id, role) values (created.id, uid, 'owner') returning * into membership;
  return jsonb_build_object('site', to_jsonb(created), 'membership', to_jsonb(membership));
end
$$;

/**
 * Rename a site or change its address. Owners only. `domain` isn't editable
 * here: mapping a hostname is done by hand (it has to be configured in Vercel
 * and Caddy too).
 */
create function public.update_site(site_id text, site_name text default null, site_slug text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  n text;
  s text;
  updated_site public.sites;
begin
  if not private.is_owner(site_id, uid) then
    raise exception 'Only the site''s owner can change it.' using errcode = '42501';
  end if;
  select * into updated_site from public.sites where id = site_id for update;

  if site_name is not null then
    n := left(btrim(site_name), 120);
    if n = '' then
      raise exception 'A site needs a name.' using errcode = '22023';
    end if;
    updated_site.name := n;
  end if;

  if site_slug is not null then
    s := lower(btrim(site_slug));
    if s <> updated_site.slug then
      if not private.valid_site_slug(s) then
        raise exception 'That address isn''t available.' using errcode = '22023', detail = 'slug: invalid';
      end if;
      if exists (select 1 from public.sites x where x.slug = s and x.id <> site_id) then
        raise exception 'That address is taken.' using errcode = '22023', detail = 'slug: taken';
      end if;
      updated_site.slug := s;
    end if;
  end if;

  update public.sites set name = updated_site.name, slug = updated_site.slug
    where id = site_id returning * into updated_site;
  return jsonb_build_object('site', to_jsonb(updated_site));
end
$$;

/**
 * Delete a site, from its settings. Owners only, and refused while the site has
 * any post, drafts included: a real blog can't go this way, and a site made to
 * try onboarding (collections and settings, no posts) goes cleanly, its slug
 * free again. Memberships, redirects and internals follow the site (cascade);
 * the other site-scoped records go first, in the same transaction.
 */
create function public.delete_site(site_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
begin
  if not private.is_owner(site_id, uid) then
    raise exception 'Only the site''s owner can delete it.' using errcode = '42501';
  end if;
  if exists (select 1 from public.posts p where p.site = site_id) then
    raise exception 'This site has posts. Only a site without posts can be deleted.'
      using errcode = '22023', detail = 'site: has_posts';
  end if;
  delete from public.post_versions where site = site_id;
  delete from public.briefs where site = site_id;
  delete from public.brief_templates where site = site_id;
  delete from public.collections where site = site_id;
  delete from public.app_settings where site = site_id;
  delete from public.writing_activity where site = site_id;
  delete from public.sites where id = site_id;
  return jsonb_build_object('deleted', site_id);
end
$$;

-- ---- writing activity ----

/**
 * Add `p_delta` words to a site's day, creating the day if needed. One
 * statement, so concurrent increments add up. Members only. (The Supabase-era
 * function had this name; PocketBase had it as POST /api/verbose/increment.)
 */
create function public.increment_writing_activity(p_site text, p_day text, p_delta integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  tenant text;
  total integer;
begin
  if coalesce(p_day, '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'day (YYYY-MM-DD) is required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.site_members m where m.site = p_site and m.user_id = uid) then
    raise exception 'Not a member of that site.' using errcode = '42501';
  end if;
  select s.analytics_tenant into tenant from public.sites s where s.id = p_site;

  insert into public.writing_activity (site, tenant, day, words)
    values (p_site, tenant, p_day, greatest(0, coalesce(p_delta, 0)))
    on conflict (site, day) do update set words = public.writing_activity.words + excluded.words
    returning words into total;
  return jsonb_build_object('site', p_site, 'tenant', tenant, 'day', p_day, 'words', total);
end
$$;

-- ---- hosts ----

/**
 * Caddy's on-demand TLS check (Bedrock: `on_demand_tls { ask ... }`). Before
 * issuing a certificate for a host it hasn't seen, Caddy asks
 *
 *   GET <postgrest>/rpc/tls_check?domain=<host>
 *
 * and goes ahead only on a 200: the app host (app.<platform>) and the
 * subdomain of an existing site. Anything else is a 404, so nobody can point
 * hostnames at the box and make Caddy request certificates for them. Site slugs
 * are public already, so the answer reveals nothing new.
 */
create function public.tls_check(domain text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  d text := regexp_replace(lower(btrim(coalesce(domain, ''))), '\.$', '');
  suffix text := '.' || coalesce(nullif(current_setting('propaganda.platform_domain', true), ''), 'propaganda.pub');
  label text;
begin
  if d = 'app' || suffix then
    return 'ok';
  end if;
  if length(d) > length(suffix) and right(d, length(suffix)) = suffix then
    label := left(d, length(d) - length(suffix));
    if position('.' in label) = 0 and exists (select 1 from public.sites s where s.slug = label) then
      return 'ok';
    end if;
  end if;
  raise exception 'unknown host' using errcode = 'PT404';
end
$$;

revoke execute on function public.create_site(text, text) from public, anon;
revoke execute on function public.update_site(text, text, text) from public, anon;
revoke execute on function public.delete_site(text) from public, anon;
revoke execute on function public.increment_writing_activity(text, text, integer) from public, anon;
grant execute on function public.create_site(text, text) to authenticated;
grant execute on function public.update_site(text, text, text) to authenticated;
grant execute on function public.delete_site(text) to authenticated;
grant execute on function public.increment_writing_activity(text, text, integer) to authenticated;
grant execute on function public.tls_check(text) to anon, authenticated;

-- ---- realtime ----

-- The tables the app watches. Events only say "this row changed"; the app
-- re-reads the row (lib/realtime.ts), because a change event leaves out large
-- values that didn't change, and a post's body is one of those.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;
alter publication supabase_realtime add table
  public.posts, public.post_versions, public.collections, public.app_settings, public.writing_activity;
