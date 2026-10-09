-- The PPGD tenant: Propaganda's own site, with Ayadi as its owner. Its
-- published posts are the marketing site's blog (propaganda.pub/blog, which
-- reads them anonymously like any blog) and also live at ppgd.propaganda.pub.
-- Ayadi then runs two tenants: Verbatim (Propaganda Lite) and PPGD (the full
-- product).
--
-- Data only, additive: one new site and one membership, as create_site() makes
-- them. Nothing existing is read or changed. A no-op where Ayadi's account
-- doesn't exist (laptop stacks) or where the slug is already taken.

do $$
declare
  uid uuid;
  sid text := 'ppgdsite0000000';
begin
  select id into uid from auth.users where lower(email) = 'alaarabi16@gmail.com' limit 1;
  if uid is null or exists (select 1 from public.sites where slug = 'ppgd' or id = sid) then
    return;
  end if;
  insert into public.sites (id, name, slug, analytics_tenant) values (sid, 'Propaganda', 'ppgd', 'ppgd');
  update private.site_internals set created_by = uid where site = sid;
  insert into public.site_members (site, user_id, role) values (sid, uid, 'owner');
end
$$;
