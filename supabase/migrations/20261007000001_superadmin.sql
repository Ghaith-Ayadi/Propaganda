-- Superadmin flag (Propaganda 0.2, Admin in the command menu).
--
-- Additive only: one new table and one new function. Nothing existing changes,
-- so clients on older builds are unaffected.
--
-- A superadmin is an auth user listed in private.superadmins. The table is in
-- the private schema (no grants to API roles), so the only way to learn the
-- flag is public.is_superadmin(), which answers for the caller alone. Every
-- Admin function added later must start with private.require_superadmin(), so
-- the server checks the flag on every request, whatever the client believes.

create table private.superadmins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created timestamptz not null default now()
);

revoke all on private.superadmins from anon, authenticated;

/** Raises unless the caller is a superadmin. Admin functions call this first. */
create function private.require_superadmin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
begin
  if not exists (select 1 from private.superadmins where user_id = uid) then
    raise exception 'Superadmins only.' using errcode = '42501';
  end if;
  return uid;
end
$$;

revoke all on function private.require_superadmin() from public;

/** Whether the caller is a superadmin. False for anyone else, and when signed out. */
create function public.is_superadmin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.superadmins where user_id = auth.uid())
$$;

revoke all on function public.is_superadmin() from public;
grant execute on function public.is_superadmin() to authenticated;

-- Ayadi's account. A no-op where the account doesn't exist yet (laptop stacks).
insert into private.superadmins (user_id)
select id from auth.users where lower(email) = 'alaarabi16@gmail.com'
on conflict do nothing;
