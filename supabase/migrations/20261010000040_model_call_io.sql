-- Everything every model call got and gave back (Ayadi, 2026-10-10), for
-- Propaganda Labs: read a past answer, change a prompt, replay the same input
-- and compare. Additive only: one new table, nothing existing changes.
--
-- One row per model_calls row (api/_ai/capture.ts, written by the gateway right
-- after the call's cost-log row). A streamed Chat reply is one row per step,
-- sharing a turn: the first step holds the request, later ones continue it.
--
-- It holds tenants' drafts, call transcripts and knowledge base claims, so it is
-- superadmin only: written with the service role, read by superadmins, by no
-- member and never anonymously. Deleting a site deletes its rows, as the cost
-- log does.

create table public.model_call_io (
  call text primary key references public.model_calls (id) on delete cascade,
  site text not null references public.sites (id) on delete cascade,
  turn text check (turn is null or turn ~ '^[a-z0-9]{15}$'),
  step integer not null default 1 check (step >= 1),
  -- What the model got: model, system, prompt or messages, tools, settings.
  request jsonb not null,
  -- What came back: text, reasoning, tool calls and results, why it stopped; or the error.
  response jsonb not null,
  -- True when either side was longer than the gateway keeps (MODEL_CAPTURE_MAX_CHARS) and was cut.
  truncated boolean not null default false,
  created timestamptz not null default private.ms_now()
);
create index model_call_io_site_created on public.model_call_io (site, created desc);
create index model_call_io_turn on public.model_call_io (turn, step) where turn is not null;

alter table public.model_call_io enable row level security;
revoke all on public.model_call_io from anon, authenticated;
grant all on public.model_call_io to service_role;
grant select on public.model_call_io to authenticated;
create policy "superadmins read" on public.model_call_io for select to authenticated
  using (public.is_superadmin());
