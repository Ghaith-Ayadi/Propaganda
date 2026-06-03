-- 0014_briefs.sql — Planning: briefs.
-- A brief is a task to write a post. The post it produces is created in the
-- brief's target collection (collection_name) and links back via post_id; the
-- brief itself is not in the collection.

create extension if not exists "pgcrypto";

create table if not exists public.briefs (
  id              uuid primary key default gen_random_uuid(),
  title           text not null default '',
  status          text not null default 'backlog',   -- backlog|todo|in_progress|in_review|done|cancelled
  assignee_ids    text[] not null default '{}',       -- interim freeform; real users land with multitenancy
  planned_date    date,                               -- due / projected publish date; null = unscheduled
  tags            text[] not null default '{}',
  template_id     uuid,
  collection_name text,                               -- target collection for the produced post
  body            text not null default '',
  checks          jsonb not null default '{}',        -- structured compliance constraints (later)
  post_id         integer references public.posts(id) on delete set null,
  user_id         integer not null default 1,         -- tenant scope (=1 today)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists briefs_planned_date_idx on public.briefs(planned_date);
create index if not exists briefs_status_idx on public.briefs(status);
create index if not exists briefs_collection_idx on public.briefs(collection_name);
create index if not exists briefs_post_id_idx on public.briefs(post_id);
