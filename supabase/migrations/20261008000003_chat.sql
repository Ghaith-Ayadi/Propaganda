-- On Ayadi's go in the Chat thread (2026-10-08 21:41Z). Additive only.
-- Needs the cost log (20261007000002) first; migrate.sh applies it by version, so it runs even though later numbers are already in.
--
-- Chat (Propaganda 0.2): conversations with the agents, and the cost log
-- learning about replies stopped mid-stream. Additive only.
--
-- Each conversation belongs to one tenant (site) and one account: people see
-- their own conversations, never a co-member's. Only the server writes
-- (api/chat/*, with the service role), so a browser can't forge an
-- assistant's message; browsers read their own rows.

create table public.chat_conversations (
  id text primary key check (id ~ '^[a-z0-9]{15}$'),
  site text not null references public.sites (id) on delete cascade,
  user_id uuid not null,
  title text not null default 'New chat' check (char_length(title) between 1 and 200),
  created timestamptz not null default private.ms_now(),
  updated timestamptz not null default private.ms_now(),
  unique (site, id)
);
create index chat_conversations_owner on public.chat_conversations (site, user_id, updated desc);

-- A message is the Chat page's shape, the Vercel AI SDK's UIMessage
-- (app/src/lib/chat/types.ts): its parts (text, data-handoff, data-citation,
-- data-action) and its metadata ({ costUsd, stopped }). A person's message
-- keeps the id useChat gave it; a reply's id is the server's.
create table public.chat_messages (
  id text not null check (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  site text not null references public.sites (id) on delete cascade,
  conversation text not null,
  user_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  parts jsonb not null default '[]' check (jsonb_typeof(parts) = 'array' and octet_length(parts::text) <= 200000),
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 2000),
  created timestamptz not null default private.ms_now(),
  primary key (conversation, id),
  foreign key (site, conversation) references public.chat_conversations (site, id) on delete cascade
);
create index chat_messages_conversation on public.chat_messages (conversation, created);

alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;
revoke all on public.chat_conversations, public.chat_messages from anon, authenticated;
grant all on public.chat_conversations, public.chat_messages to service_role;
grant select on public.chat_conversations, public.chat_messages to authenticated;
create policy "own, in my sites" on public.chat_conversations for select to authenticated
  using (user_id = auth.uid() and site in (select private.my_sites()));
create policy "own, in my sites" on public.chat_messages for select to authenticated
  using (user_id = auth.uid() and site in (select private.my_sites()));

-- A reply the reader stopped never reports its usage; the gateway logs the
-- call in flight as 'stopped', with tokens estimated from what had streamed.
-- Widening the check keeps every existing row valid.
alter table public.model_calls drop constraint model_calls_status_check;
alter table public.model_calls add constraint model_calls_status_check
  check (status in ('ok', 'error', 'stopped'));

-- The Chat agent's model (api/_chat/agent.ts; the AI Gateway's id, which
-- #45's anthropicModelId turns into Anthropic's claude-sonnet-5-5 on a
-- tenant's own key), at Anthropic's API prices on 2026-10-08: $2 input, $10 output, $0.20 cache reads per million tokens;
-- cache writes at 1.25x input (5-minute cache).
insert into public.model_prices (model, input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok)
values ('anthropic/claude-sonnet-5.5', 2.00, 10.00, 0.20, 2.50);
