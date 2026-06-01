# Verbatim — Single-tenant PRD

> Phase 1. The writing tool Ghaith uses to replace the Payload admin on his existing blog. Built first, run as the daily driver for ≥3 months, then validates the architecture for the multi-tenant build.

---

## 1. Goal

Replace `blog-plum-three-17.vercel.app/admin` (Payload's web admin) with a local-first desktop-class web app at `verbatim.ayadighaith.com` (or local) that:

- Loads the post list in <50ms after the first cold visit
- Lets Ghaith open a post and start typing with <16ms keystroke latency
- Auto-saves to local IndexedDB on every keystroke; syncs to Supabase on idle
- Publishes to the existing blog with one keyboard shortcut
- Supports a Cmd+K palette for navigation, search, new-post, and new-collection
- Has a Notion-style block editor with slash commands and Markdown shortcuts (`###` for h3, `>` for quote, `- ` for bullet, etc.)
- Supports an attribute side panel that hides into "author mode" for full-screen writing
- Persists version history, viewable and revertible from inside the editor
- Exposes an MCP server (separate package) for Claude Code integration

Non-goals (Phase 1):

- No signups; the app authenticates as Ghaith only
- No multi-tenant routing or custom domains
- No moderation, billing, public API, or abuse tooling
- No Tauri/native desktop wrapper (web app only; can be installed as PWA)

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Verbatim (web app)                                      │
│  Vite + React 19 + TS                                    │
│  ┌─ TanStack Router (type-safe nav, prefetch on hover)   │
│  ├─ TanStack Query (server-state cache)                  │
│  ├─ BlockNote editor                                     │
│  ├─ Untitled UI components (ported from Genesis)         │
│  └─ Tailwind v4                                          │
│                                                          │
│  Local data:                                             │
│  ├─ Dexie (IndexedDB): posts, versions, drafts, search   │
│  └─ MiniSearch index (in-memory, rebuilt on change)      │
│                                                          │
│  Service Worker: caches the app shell                    │
└──────────────────────┬───────────────────────────────────┘
                       │ supabase-js (postgrest + auth + realtime)
                       ▼
┌──────────────────────────────────────────────────────────┐
│  Supabase (existing project, ref in .env.local)          │
│  ┌─ public.posts             (existing, content → MD)    │
│  ├─ public.post_versions     (new, append-only)          │
│  ├─ public.collections       (new, sidebar groups)       │
│  └─ public.users             (Payload-managed; only you) │
│                                                          │
│  Realtime: posts + post_versions subscribed by client    │
└──────────────────────────────────────────────────────────┘
                       ▲
                       │ Payload Local API at build time
                       │
┌──────────────────────┴───────────────────────────────────┐
│  Existing blog (Next.js + Payload)                       │
│  - SSG rendering kept as-is                              │
│  - Reads Markdown directly via remark instead of Lexical │
│  - /admin route stays as fallback                        │
└──────────────────────────────────────────────────────────┘
                       ▲
                       │ Supabase JS via service-role token
                       │
┌──────────────────────┴───────────────────────────────────┐
│  blog-mcp (separate npm package)                         │
│  Standalone Node MCP server, configured in ~/.claude.json│
│  Tools: list_posts, read_post, update_post, publish, ... │
│  Token in ~/.config/blog-mcp/token (chmod 600)           │
└──────────────────────────────────────────────────────────┘
```

---

## 3. Data model

Three tables, two new + one modified:

### `posts` (modify existing)

Change `content` field type from Lexical JSON → Markdown text.

```sql
alter table posts alter column content type text;
-- Run scripts/lexical-to-markdown.ts to migrate existing 217 posts
```

In Payload config: change `{ name: 'content', type: 'richText' }` to `{ name: 'content', type: 'textarea' }`. Optionally add a custom `admin.components.Field` that mounts BlockNote so the Payload admin renders posts properly too.

### `post_versions` (new)

```sql
create table post_versions (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references posts(id) on delete cascade,
  version     int not null,
  content     text not null,
  attributes  jsonb not null,
  created_at  timestamptz not null default now(),
  created_by  text not null check (created_by in ('user','mcp:claude-code','migration')),
  message     text,
  unique (post_id, version)
);

create index post_versions_by_post on post_versions (post_id, version desc);
```

### `collections` (new)

Sidebar groups. A post belongs to zero or one collection.

```sql
create table collections (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  name        text not null,
  position    int not null default 0,
  created_at  timestamptz not null default now()
);

alter table posts add column collection_id uuid references collections(id) on delete set null;
```

In single-tenant, `user_id` is always Ghaith's. Keeping it on the schema now means zero migration when going multi-tenant.

---

## 4. Sync engine

Ported nearly verbatim from Anderson (`code/Personal/Anderson/src/lib/sync.ts`). Differences:

- The cloud table is `posts` (not `watchlist_items`)
- `updated_at` cursor remains the pull mechanism
- Realtime channel subscribes to `posts` and `post_versions` for cross-device

**Push triggers:**

| Trigger | When | Latency target |
|---|---|---|
| Local save | every keystroke (debounced 100ms) | sub-millisecond (IDB only) |
| Cloud sync | 2s of idle after last edit | <500ms |
| Version snapshot | publish, manual Cmd+Shift+S, MCP edit | immediate |
| Force flush | window blur or before unload | within ms |

**Pull triggers:**

- App focus → check `updated_at > lastPullIso`
- Realtime channel `INSERT/UPDATE` on posts → pull just that row

The user can be offline indefinitely. Local IDB works. On reconnect, sync runs once, conflicts resolve last-write-wins by server clock (server-managed `updated_at` via trigger).

---

## 5. Editor

**BlockNote** wrapping TipTap/ProseMirror. Why BlockNote: Notion-class slash menu, drag handles, block transforms — out of the box. Markdown shortcuts (`###`, `> `, `- `, `1. `, ` ``` `, `**`, `_`, etc.) work natively.

Storage format: BlockNote's `.toMarkdown()` on save. Round-trips cleanly.

**Custom extensions** to add over BlockNote defaults:

- Wikilink (`[[other-post]]`) → resolves to internal link, autocompletes from MiniSearch index
- Tag input (`#tag`) → adds to post's tags array, not body
- Image paste / drag → uploads to Supabase Storage, inserts MD `![](...)`
- Cmd+/ shortcuts: bold, italic, link, h1/h2/h3, quote, bullet, code, horizontal rule

The editor instance is **kept alive across post navigation** — clicking a different post in the sidebar swaps the document via `editor.replaceContent(newMD)` rather than unmounting. ~5ms switch.

---

## 6. UI layout

```
┌─────────────────────────────────────────────────────────────┐
│  ⌘K palette (overlay, opens on Cmd+K)                       │
├─────────┬─────────────────────────────────────┬─────────────┤
│         │                                     │             │
│ SIDEBAR │  EDITOR                             │ ATTRIBUTES  │
│         │                                     │             │
│ Recent  │  # Post title (h1, plain text)      │ slug        │
│ Favs    │                                     │ type        │
│         │  Post body (BlockNote)              │ status      │
│ ── ── ──│                                     │ tags        │
│         │  ## Subheading                      │ publishedAt │
│ Hokum▸  │  paragraph text...                  │ collection  │
│ Journ▸  │  - bullet                           │ category    │
│ Briefs▸ │  - bullet                           │             │
│         │                                     │ ── history  │
│ + new   │                                     │ v3 2h ago   │
│   coll  │                                     │ v2 1d ago   │
│         │                                     │ v1 publsh'd │
└─────────┴─────────────────────────────────────┴─────────────┘
   200px              fluid                        260px
```

**Author mode** (`Cmd+\` toggle): hides sidebar + attributes. Editor centers at ~720px. Pure writing.

**Sidebar virtualization:** TanStack Virtual. Even with 1000+ posts in a collection, only ~30 rows mount.

---

## 7. Cmd+K palette

Single component. Built on `@tanstack/router` + `cmdk` (or hand-rolled). Modes:

| Trigger | Mode | Result |
|---|---|---|
| (default) | Search | MiniSearch over title + body + tags |
| `>` | Commands | New post, new collection, toggle author mode, publish, ... |
| `@` | People | n/a in single-tenant |
| `#` | Tags | Filter by tag |

Search is in-memory (MiniSearch). 217 posts → index builds in <10ms on app load, queries in <2ms. Fuzzy + prefix + BM25 ranking.

Hover any result → live preview pane on the right side of the palette.

---

## 8. MCP server

Separate npm package: `blog-mcp`. Lives in its own folder:

```
verbatim/single-tenant/
├── app/                  Vite editor app
├── mcp-server/           Node MCP server
└── PRD.md
```

`mcp-server` is a thin Node process that exposes MCP tools over stdio (or HTTP if configured). Claude Code config:

```json
{
  "mcpServers": {
    "blog": {
      "command": "node",
      "args": ["/Users/.../verbatim/mcp-server/dist/index.js"],
      "env": {"BLOG_TOKEN_FILE": "/Users/.../.config/blog-mcp/token"}
    }
  }
}
```

**Tools:**

```
list_posts({ type?, status?, q?, limit? })
get_post({ slug })
create_post({ type, title, content?, attributes? })
update_post({ slug, content?, attributes?, message? })
delete_post({ slug })
publish({ slug })
unpublish({ slug })
list_versions({ slug })
get_version({ slug, version })
revert({ slug, version })
search({ q, limit? })
```

Every write tool snapshots a version with `created_by: 'mcp:claude-code'` and an optional commit message.

When Claude edits via MCP and the Verbatim app is open: Supabase Realtime fires → app pulls the row → editor updates without losing cursor (if the post being edited isn't the one open). If it *is* open, show a toast: *"Claude updated this post"* with revert/keep buttons.

---

## 9. Auth

Single-tenant: re-use the Supabase project's existing auth (the one Payload set up). Magic link via Supabase Auth, sent through whatever email provider Supabase uses by default (or Resend if we wire it up later — not blocking for v1).

Token in `localStorage` (Supabase JS handles it). MCP server reads a long-lived service-role token from `~/.config/blog-mcp/token` (manually set on install).

---

## 10. Build / deploy

**Editor app:**
- Vite build → static SPA bundle
- Hosted on Vercel (free) at `verbatim.ayadighaith.com` (or as a subpath of the existing blog)
- Service Worker pre-caches the shell

**MCP server:**
- `npm publish` to private registry (or just `npm link` locally)
- Plain Node, no fancy bundler

**Existing blog:**
- Stays as-is on Vercel
- Update content rendering: replace `@payloadcms/richtext-lexical/react` with `react-markdown` + `remark-gfm`
- One-time migration script: Lexical → Markdown for all 217 posts

---

## 11. Phases

### Phase 1.0 — Foundation (1–2 weeks)

- [ ] Run Lexical → Markdown migration on existing posts
- [ ] Update Payload `content` field to `textarea` (text storage)
- [ ] Update existing blog frontend to render Markdown (drop Lexical dependency)
- [ ] Verify the existing blog still works
- [ ] Add `post_versions` and `collections` tables via Payload migration

### Phase 1.1 — Editor MVP (3–4 weeks)

- [ ] Vite scaffold (port from Anderson's structure)
- [ ] Dexie schema, Supabase client, sync engine ported from Anderson
- [ ] BlockNote integrated; Markdown round-trip working
- [ ] Sidebar with Recent / Favorites / Collections (virtualized)
- [ ] Cmd+K palette: search + nav + new-post + new-collection
- [ ] Auth: Supabase magic link
- [ ] Save / publish flow

### Phase 1.2 — Polish (2 weeks)

- [ ] Author mode toggle
- [ ] Image paste/upload to Supabase Storage
- [ ] Wikilinks `[[...]]` extension
- [ ] Service Worker shell caching
- [ ] PWA manifest

### Phase 1.3 — Versioning (1–2 weeks)

- [ ] `post_versions` writes on triggers
- [ ] History UI in attributes panel
- [ ] Revert flow with confirmation
- [ ] Diff view

### Phase 1.4 — MCP server (1 week)

- [ ] Node package scaffold
- [ ] Tools wired to Supabase via service-role token
- [ ] Auth via token file
- [ ] Test with Claude Code end-to-end
- [ ] Realtime → app refresh works

### Phase 1.5 — Daily driver (3 months minimum)

- [ ] Use it as primary writing tool
- [ ] Fix issues that surface
- [ ] Don't add features
- [ ] Decide if multi-tenant is worth building

---

## 12. Success criteria

- Cold load (cache cleared): <1.5s to interactive
- Warm load (SW cache): <300ms to interactive
- In-app post navigation: <50ms
- Keystroke → glyph: <16ms
- Cloud sync after idle: <500ms p95
- Publish-to-live-on-blog: <10s end-to-end
- Zero data loss across 3 months of single-user use
- Cmd+K → results visible: <30ms

---

## 13. Decisions to validate during single-tenant

These are choices we made for single-tenant that need to hold up under multi-tenant load:

1. **Markdown storage.** Does it round-trip cleanly through BlockNote? Any features lost vs. Lexical that matter?
2. **Idle-driven sync.** Does it feel right? Or do users want a visible "save now" indicator?
3. **MCP via Claude Code.** Is the local MCP UX acceptable, or so painful that the remote MCP becomes mandatory for public Verbatim?
4. **No Tauri.** Does the web app actually feel fast enough as a daily driver, or does the lack of native window/tray bother you?
5. **MiniSearch sufficiency.** Are 217 posts enough to stress-test, or do we need a worker / postgres-fts plan ready before multi-tenant?

If any of these fail, multi-tenant changes shape. Don't skip the daily-driver phase.
