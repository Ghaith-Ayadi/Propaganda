-- Article subtitle: short standfirst line shown below the title.
-- Populated for existing posts by the notion-backfill-subtitle script.

alter table public.posts add column if not exists subtitle text;
