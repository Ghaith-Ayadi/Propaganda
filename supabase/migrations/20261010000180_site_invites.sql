-- Real invites and roles for a site's people (Settings > People).
--
-- Until now an invite lived in the browser's memory, other members showed as
-- "Member xxxxxx" (their names are in auth.users, which no browser reads) and
-- nobody could change a role. This adds:
--
--   private.site_invites  an owner's invite: an email address and the role it
--                         joins with. Private (emails are personal data); the
--                         app reads it only through site_people().
--   site_people(site)     the members with their name and email, and, for an
--                         owner, the pending invites.
--   invite_member / revoke_invite        owner only.
--   set_member_role / remove_member      owner only; a member may remove
--                         themselves. A site always keeps one owner.
--   accept_invites()      run by the app after every sign-in: the invites for
--                         the signed-in account's confirmed email become
--                         memberships.
--
-- No email goes out from here: an invited person joins by signing in (Google or
-- an emailed code) with the invited address. Additive only: one private table
-- and six functions; no existing table, policy or row changes.

create table private.site_invites (
  id text primary key default private.new_id() check (id ~ '^[a-z0-9]{15}$'),
  site text not null references public.sites (id) on delete cascade,
  email text not null check (email = lower(email) and char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  role text not null default 'editor' check (role in ('owner', 'editor')),
  invited_by uuid references auth.users (id) on delete set null,
  created timestamptz not null default private.ms_now(),
  unique (site, email)
);
create index site_invites_email_idx on private.site_invites (email);

alter table private.site_invites enable row level security;
-- Only the functions below (security definer) and the service role touch it.
revoke all on private.site_invites from anon, authenticated;
grant all on private.site_invites to service_role;

/** The site's members with names and emails, and (owners only) its pending invites. */
create function public.site_people(p_site text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
begin
  if not exists (select 1 from public.site_members m where m.site = p_site and m.user_id = uid) then
    raise exception 'You are not on this site.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id,
        'role', m.role,
        'email', coalesce(u.email, ''),
        'name', coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), nullif(u.raw_user_meta_data ->> 'name', ''), ''),
        'avatar', coalesce(nullif(u.raw_user_meta_data ->> 'avatar_url', ''), nullif(u.raw_user_meta_data ->> 'picture', ''), '')
      ) order by m.created, m.id)
      from public.site_members m join auth.users u on u.id = m.user_id
      where m.site = p_site), '[]'::jsonb),
    'invites', case when private.is_owner(p_site, uid) then coalesce((
      select jsonb_agg(jsonb_build_object('email', i.email, 'role', i.role, 'created', i.created) order by i.created, i.id)
      from private.site_invites i where i.site = p_site), '[]'::jsonb)
      else '[]'::jsonb end
  );
end
$$;

/** Invite an email address to the site. Owners only. Inviting again changes the role. */
create function public.invite_member(p_site text, p_email text, p_role text default 'editor') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  e text := lower(btrim(coalesce(p_email, '')));
  r text := coalesce(p_role, 'editor');
  inv private.site_invites;
begin
  if not private.is_owner(p_site, uid) then
    raise exception 'Only an owner can invite people.' using errcode = '42501';
  end if;
  if r not in ('owner', 'editor') then
    raise exception 'A person is an owner or an editor.' using errcode = '22023';
  end if;
  if char_length(e) > 254 or e !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That doesn''t look like an email address.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.site_members m join auth.users u on u.id = m.user_id
    where m.site = p_site and lower(u.email) = e
  ) then
    raise exception 'They are already on this site.' using errcode = '22023';
  end if;
  if not exists (select 1 from private.site_invites i where i.site = p_site and i.email = e)
     and (select count(*) from private.site_invites i where i.site = p_site) >= 50 then
    raise exception 'This site has 50 invites waiting. Remove some first.' using errcode = '22023';
  end if;
  insert into private.site_invites (site, email, role, invited_by) values (p_site, e, r, uid)
  on conflict (site, email) do update set role = excluded.role, invited_by = excluded.invited_by
  returning * into inv;
  return jsonb_build_object('email', inv.email, 'role', inv.role, 'created', inv.created);
end
$$;

/** Withdraw an invite. Owners only. Withdrawing one that isn't there is fine. */
create function public.revoke_invite(p_site text, p_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
begin
  if not private.is_owner(p_site, uid) then
    raise exception 'Only an owner can withdraw an invite.' using errcode = '42501';
  end if;
  delete from private.site_invites i where i.site = p_site and i.email = lower(btrim(coalesce(p_email, '')));
  return jsonb_build_object('ok', true);
end
$$;

/** Change a member's role. Owners only. The site keeps at least one owner. */
create function public.set_member_role(p_site text, p_user uuid, p_role text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  was text;
begin
  if not private.is_owner(p_site, uid) then
    raise exception 'Only an owner can change roles.' using errcode = '42501';
  end if;
  if p_role not in ('owner', 'editor') then
    raise exception 'A person is an owner or an editor.' using errcode = '22023';
  end if;
  -- Serialise changes to the owners so two demotions can't both pass the count below.
  perform 1 from public.site_members m where m.site = p_site and m.role = 'owner' for update;
  select m.role into was from public.site_members m where m.site = p_site and m.user_id = p_user;
  if was is null then
    raise exception 'That person is not on this site.' using errcode = '22023';
  end if;
  if was = 'owner' and p_role <> 'owner'
     and (select count(*) from public.site_members m where m.site = p_site and m.role = 'owner') < 2 then
    raise exception 'A site needs at least one owner.' using errcode = '22023';
  end if;
  update public.site_members m set role = p_role where m.site = p_site and m.user_id = p_user;
  return jsonb_build_object('user_id', p_user, 'role', p_role);
end
$$;

/** Take someone off the site (owners), or leave it yourself (anyone on it). The last owner can't go. */
create function public.remove_member(p_site text, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  was text;
begin
  if p_user <> uid and not private.is_owner(p_site, uid) then
    raise exception 'Only an owner can remove someone else.' using errcode = '42501';
  end if;
  perform 1 from public.site_members m where m.site = p_site and m.role = 'owner' for update;
  select m.role into was from public.site_members m where m.site = p_site and m.user_id = p_user;
  if was is null then
    raise exception 'That person is not on this site.' using errcode = '22023';
  end if;
  if was = 'owner' and (select count(*) from public.site_members m where m.site = p_site and m.role = 'owner') < 2 then
    raise exception 'A site needs at least one owner.' using errcode = '22023';
  end if;
  delete from public.site_members m where m.site = p_site and m.user_id = p_user;
  return jsonb_build_object('ok', true);
end
$$;

/**
 * Turn the invites for the signed-in account's confirmed email into
 * memberships. Returns the site ids joined. Safe to call on every sign-in.
 */
create function public.accept_invites() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  mail text;
  joined jsonb;
begin
  select lower(u.email) into mail from auth.users u where u.id = uid and u.email_confirmed_at is not null;
  if mail is null or mail = '' then
    return '[]'::jsonb;
  end if;
  with taken as (
    delete from private.site_invites i where i.email = mail returning i.site, i.role
  ), added as (
    insert into public.site_members (site, user_id, role)
    select t.site, uid, t.role from taken t
    on conflict (site, user_id) do nothing
    returning site
  )
  select coalesce(jsonb_agg(a.site), '[]'::jsonb) into joined from added a;
  return joined;
end
$$;

revoke execute on function public.site_people(text) from public, anon;
revoke execute on function public.invite_member(text, text, text) from public, anon;
revoke execute on function public.revoke_invite(text, text) from public, anon;
revoke execute on function public.set_member_role(text, uuid, text) from public, anon;
revoke execute on function public.remove_member(text, uuid) from public, anon;
revoke execute on function public.accept_invites() from public, anon;
grant execute on function public.site_people(text) to authenticated;
grant execute on function public.invite_member(text, text, text) to authenticated;
grant execute on function public.revoke_invite(text, text) to authenticated;
grant execute on function public.set_member_role(text, uuid, text) to authenticated;
grant execute on function public.remove_member(text, uuid) to authenticated;
grant execute on function public.accept_invites() to authenticated;
