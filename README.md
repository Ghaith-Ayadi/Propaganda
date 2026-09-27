# Propaganda

Multi-tenant blogging platform. Currently runs a single tenant: **Verbatim** ([verbatim.ayadighaith.com](https://verbatim.ayadighaith.com), editor at `/admin`), which is the daily driver and acts as the testbed.

The multi-tenant work is the medium-term direction. The current PRD is being rewritten from scratch. Old PRDs are preserved in [docs/archive/](docs/archive/) for reference, not authority.

## Stack

Vite + React 19 + TanStack Router/Query, BlockNote editor on TipTap, Dexie (IndexedDB) as the source-of-truth UI store, PocketBase on Bedrock ([Ghaith-Ayadi/Bedrock](https://github.com/Ghaith-Ayadi/Bedrock)) for cloud sync and Google sign-in, Vercel Blob for images, Vercel for hosting.

**Infra constraint:** minimize providers. Vercel + Bedrock (one self-hosted PocketBase per app) is the entire stack target — adding a third provider needs justification. Be cautious about Next.js: Vite is the default, and "Vercel hosting" doesn't automatically mean "Next.js framework." Reach for Next.js only when there's a real reason that holds up off-Vercel too.

## Layout

| Path | What |
|---|---|
| `app/` | Editor SPA and public blog (`app/src/blog`), one Vite build |
| `api/` | Vercel functions: `upload.ts` (images to Vercel Blob), `analytics.ts` (dashboard analytics proxy), `extract-quotes.ts` |
| `pb/` | PocketBase schema (`pb_migrations`), server hooks (`pb_hooks`) and the migration rehearsal |
| `blog/` | Design handoff bundle for the blog (HTML prototypes), not code that runs |
| `scripts/` | Supabase-era one-off admin and Notion import tools; legacy since the move to Bedrock |
| `docs/screenshots/` | Screenshots |
| `docs/archive/` | Old planning artifacts, Supabase-era; reference, not authority |

The schema and hooks live here in `pb/`; the instance itself (compose, Caddy,
backups) is in the Bedrock repo, whose
[docs/apps.md](https://github.com/Ghaith-Ayadi/Bedrock/blob/main/docs/apps.md)
is the reference for how this app talks to it.

## Tenant model

Propaganda is multi-tenant. A **site** is a tenant: its posts, collections, briefs,
settings (author, manifesto, favicon) and writing activity, plus a slug and an optional
custom domain. People reach sites through **memberships** (owner or editor). Verbatim is
the first site. New accounts are onboarded into a new site (name, address, author,
collections).

- Public blog: `/@<slug>/` on any host; a site with a custom `domain` is served at that
  domain's root (Verbatim at verbatim.ayadighaith.com). Mapping a domain is a superuser
  action today (the `domain` field, plus the domain in Vercel and Caddy).
- One browser holds several accounts and switches between their sites instantly.
- Every new feature passes the "would this still work with 100 sites?" check: filter by
  `site`, keep per-site state out of module globals (or reset it with `onScopeReset`).

## Known migration debt

- **`scripts/src/*`** still target Supabase (seed, backfill, Notion import). They stop working when the Supabase project is deleted after 2026-10-16; port the ones worth keeping to the PocketBase API or drop them.
- **Post ids** changed from Postgres integers to PocketBase record ids (strings) in September 2026. `posts.legacy_id` keeps the old number for the 317 migrated posts; nothing should depend on it.
- **Notion import code** in `scripts/` is Verbatim-specific seed import. Long-term it becomes a tenant migration plugin.

## Work tracking

Propaganda is tracked in **Notion** (the Propaganda page: Tasks database plus a Knowledge base). See `CLAUDE.md` for the rules that apply to every work session. The old Plane projects **Propaganda (PPG)** and **Verbatim (VST)** hold historical issues only.

---

© Ghaith Ayadi. Personal IP.
