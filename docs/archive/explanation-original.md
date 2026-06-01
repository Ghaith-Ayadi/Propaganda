# Verbatim

A local-first writing app. Built in two phases.

## What this folder contains

```
verbatim/
├── explanation.md        ← this file
├── single-tenant/        ← Phase 1: for Ghaith only
│   └── PRD.md
├── multi-tenant/         ← Phase 2: public Verbatim (medium.com-style)
│   └── PRD.md
└── old/                  ← original plan (Framer migrator, superseded)
```

## What Verbatim is now

A writing tool that replaces the Payload admin in [the existing blog repo](https://github.com/Ghaith-Ayadi/blog). Local-first: every keystroke writes to IndexedDB, sync to the cloud happens on idle. Notion-class block editor (BlockNote on TipTap on ProseMirror). Keyboard-first. Cmd+K palette. Always-open tab.

The pitch is **speed**, not AI. Slack/Linear/Raycast-class responsiveness in a publishing tool. AI editing exists but is a footnote, not the headline.

## Why two phases

The single-tenant build proves the architecture on a real workload (Ghaith's own writing) without the complexity of signups, billing, abuse, and multi-tenant routing. Once the editor and sync engine are battle-tested, the multi-tenant build is the same code with: an additional `users` namespace, RLS isolation, a `/@user` routing layer, custom-domain support, and a billing surface.

Architecture decisions in single-tenant are made with multi-tenant in mind, so the lift to public Verbatim is mostly *adding* code, not *rewriting*.

## What stays the same across both phases

- **Frontend:** Vite + React + TanStack Router + TanStack Query + BlockNote
- **Local store:** Dexie (IndexedDB), source of UI reads
- **Cloud store:** Supabase Postgres (single-tenant: existing project; multi-tenant: same or new project with RLS)
- **Storage format:** Markdown text in `posts.content`
- **Sync model:** event-driven (idle push, publish push, focus pull, WS notify)
- **Versioning:** `post_versions` table, event-driven snapshots (publish, MCP edit, manual save, extended idle)
- **Editor host:** static SPA, served from CDN, lives behind the API server

## What differs

| | Single-tenant | Multi-tenant |
|---|---|---|
| Hosting | Vercel (existing) or Render | Render + Cloudflare |
| Domain | blog-plum-three-17.vercel.app | verbatim.com + customer-owned domains |
| Auth | Supabase magic link (Ghaith only) | Supabase Auth: Google OAuth + email/password |
| Routing | Single user, no namespace | `/@user/...` path-based + custom domains via Caddy SSL |
| Blog renderer | Existing Next.js (kept) | Fastify SSR + Cloudflare cache (Next.js dropped) |
| Payload | Kept as schema/admin fallback | Dropped — schema managed via Drizzle/raw SQL migrations |
| MCP server | Standalone npm package, single user, file-based token | Remote MCP service (paid tier) + local MCP package (free with steps) |
| Moderation | Not needed | AI pre-publish (cheap model via Cerebras/Groq) |
| Pricing | Free (it's mine) | Free tier + Pro tier ($/mo for custom domain + MCP credits) |

## How to read these PRDs

`single-tenant/PRD.md` is **buildable now**. Concrete enough to scaffold and ship.

`multi-tenant/PRD.md` is **directional**. Sketches the path to public Verbatim with enough detail to validate that single-tenant decisions don't paint us into a corner — but specifics like billing flow, abuse tooling, and admin dashboards will be filled in closer to the build.

Build single-tenant first. Run it for ≥3 months as the daily driver. *Then* decide if multi-tenant is worth the work.
