-- Who may read and write what: the PocketBase API rules as row-level security,
-- keyed on `site`. Same outcome, rule for rule:
--
--   sites, collections, app_settings, post_redirects   anyone may read
--   posts            anyone may read published ones; members read the rest
--   everything else  members of the record's site only
--   writes           members of the record's site; sites, memberships,
--                    writing activity and redirects only through the
--                    functions in 20261002000004 and the address triggers
--
-- `service_role` bypasses all of it (the import, admin scripts); it never
-- reaches a browser.

/** Every site the signed-in user belongs to. Security definer: site_members' own policy reads it. */
create function private.my_sites() returns setof text
language sql stable security definer set search_path = '' as $$
  select m.site from public.site_members m where m.user_id = auth.uid()
$$;
grant execute on function private.my_sites() to anon, authenticated;

alter table public.sites enable row level security;
alter table public.site_members enable row level security;
alter table private.site_internals enable row level security;
alter table public.posts enable row level security;
alter table public.post_versions enable row level security;
alter table public.collections enable row level security;
alter table public.brief_templates enable row level security;
alter table public.briefs enable row level security;
alter table public.app_settings enable row level security;
alter table public.writing_activity enable row level security;
alter table public.post_redirects enable row level security;

-- Start from nothing, then grant exactly what each role needs. (Supabase's
-- default privileges hand every new table to anon and authenticated.)
revoke all on all tables in schema public from anon, authenticated;
revoke all on private.site_internals from anon, authenticated, service_role;
grant all on all tables in schema public to service_role;

-- ---- public reads ----

grant select on public.sites, public.collections, public.app_settings, public.post_redirects, public.posts
  to anon, authenticated;

-- The blog resolves sites by slug and domain anonymously.
create policy "anyone reads sites" on public.sites for select using (true);
create policy "anyone reads collections" on public.collections for select using (true);
create policy "anyone reads settings" on public.app_settings for select using (true);
create policy "anyone reads redirects" on public.post_redirects for select using (true);
create policy "published posts, or members" on public.posts for select
  using (status = 'published' or site in (select private.my_sites()));

-- ---- members only ----

grant select on public.site_members, public.post_versions, public.briefs, public.brief_templates,
  public.writing_activity to authenticated;
grant insert, update, delete on public.posts, public.post_versions, public.collections, public.briefs,
  public.brief_templates, public.app_settings to authenticated;
grant delete on public.post_redirects to authenticated;

-- Your own memberships, and the other members of sites you belong to.
create policy "own and co-members" on public.site_members for select to authenticated
  using (user_id = auth.uid() or site in (select private.my_sites()));

create policy "members read" on public.post_versions for select to authenticated
  using (site in (select private.my_sites()));
create policy "members read" on public.briefs for select to authenticated
  using (site in (select private.my_sites()));
create policy "members read" on public.brief_templates for select to authenticated
  using (site in (select private.my_sites()));
create policy "members read" on public.writing_activity for select to authenticated
  using (site in (select private.my_sites()));

-- Writes: the row's site must be one of yours, before and after. Moving a row
-- to another site is refused by private.site_stays_put as well.
do $$
declare
  t text;
begin
  foreach t in array array['posts', 'post_versions', 'collections', 'briefs', 'brief_templates', 'app_settings'] loop
    execute format(
      'create policy "members insert" on public.%I for insert to authenticated
         with check (site in (select private.my_sites()))', t);
    execute format(
      'create policy "members update" on public.%I for update to authenticated
         using (site in (select private.my_sites()))
         with check (site in (select private.my_sites()))', t);
    execute format(
      'create policy "members delete" on public.%I for delete to authenticated
         using (site in (select private.my_sites()))', t);
  end loop;
end
$$;

-- A member may drop a redirect, e.g. to free an old address for another post.
create policy "members delete" on public.post_redirects for delete to authenticated
  using (site in (select private.my_sites()));
