-- 0015_brief_templates.sql — Planning: brief templates.
-- A template pre-fills a new brief: its body seeds the brief's writing guidance
-- and its checks seed the brief's compliance constraints. Briefs reference a
-- template loosely via briefs.template_id (uuid, no FK; templates can be
-- deleted without orphaning the brief).

create extension if not exists "pgcrypto";

create table if not exists public.brief_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default '',
  body        text not null default '',           -- markdown skeleton seeded into a new brief
  checks      jsonb not null default '{}',        -- default compliance constraints
  user_id     integer not null default 1,         -- tenant scope (=1 today)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
