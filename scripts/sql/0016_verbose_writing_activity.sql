-- Verbose module (optional, personal): daily writing activity for the
-- GitHub-contributions-style heatmap.
--
-- This table belongs to the Verbose feature module. It is tenant-scoped from
-- day one so it can move to per-tenant config when real multi-tenancy lands.
-- If Propaganda is distributed without the Verbose module, this table is simply
-- unused; dropping it is safe.

create table if not exists public.writing_activity (
  tenant      text not null,
  day         date not null,
  words       integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (tenant, day)
);

-- Atomic per-day increment so concurrent edits (or multiple devices) accumulate
-- instead of clobbering each other. Counts gross words added; callers clamp
-- negative deltas to zero (we reward writing, GitHub-style, and never go red).
create or replace function public.increment_writing_activity(
  p_tenant text,
  p_day    date,
  p_delta  integer
) returns void
language plpgsql as $$
begin
  insert into public.writing_activity (tenant, day, words)
  values (p_tenant, p_day, greatest(p_delta, 0))
  on conflict (tenant, day) do update
    set words = public.writing_activity.words + greatest(p_delta, 0),
        updated_at = now();
end$$;

-- Realtime so the heatmap updates live across open tabs/devices.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='writing_activity'
  ) then
    execute 'alter publication supabase_realtime add table public.writing_activity';
  end if;
end$$;
