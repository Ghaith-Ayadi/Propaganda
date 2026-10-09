-- The waitlist on propaganda.pub ("Join the waitlist", the marketing site).
--
-- Additive only: one private table and two functions. Nothing existing changes.
--
-- Anyone, signed in or not, can join through public.join_waitlist(); nobody can
-- read the list through the API except a superadmin, through
-- public.admin_waitlist() (Admin > Waitlist). The table lives in the private
-- schema, so the API roles have no grant on it at all. Joining twice with the
-- same email keeps one row and fills in what's new.

create table private.waitlist (
  id bigint generated always as identity primary key,
  email text not null check (length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name text not null default '' check (length(name) <= 200),
  website text not null default '' check (length(website) <= 300),
  note text not null default '' check (length(note) <= 2000),
  created timestamptz not null default now(),
  updated timestamptz not null default now()
);

create unique index waitlist_email on private.waitlist (lower(email));

revoke all on private.waitlist from anon, authenticated;

/** Adds the caller to the waitlist (or updates their row). Open to everyone. */
create function public.join_waitlist(p_email text, p_name text default '', p_website text default '', p_note text default '')
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  e text := btrim(coalesce(p_email, ''));
begin
  if e !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(e) > 254 then
    raise exception 'That email address doesn''t look right.' using errcode = '22023';
  end if;
  insert into private.waitlist (email, name, website, note)
  values (e, left(btrim(coalesce(p_name, '')), 200), left(btrim(coalesce(p_website, '')), 300), left(btrim(coalesce(p_note, '')), 2000))
  on conflict (lower(email)) do update set
    name = coalesce(nullif(excluded.name, ''), private.waitlist.name),
    website = coalesce(nullif(excluded.website, ''), private.waitlist.website),
    note = coalesce(nullif(excluded.note, ''), private.waitlist.note),
    updated = now();
end
$$;

revoke all on function public.join_waitlist(text, text, text, text) from public;
grant execute on function public.join_waitlist(text, text, text, text) to anon, authenticated;

/** Everyone on the waitlist, newest first. Superadmins only. */
create function public.admin_waitlist()
returns table (id bigint, email text, name text, website text, note text, created timestamptz, updated timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_superadmin();
  return query
    select w.id, w.email, w.name, w.website, w.note, w.created, w.updated
    from private.waitlist w order by w.created desc;
end
$$;

revoke all on function public.admin_waitlist() from public;
grant execute on function public.admin_waitlist() to authenticated;
