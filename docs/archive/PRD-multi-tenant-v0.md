# Verbatim — Multi-tenant PRD

> Phase 2. Public Verbatim. Anyone signs up, gets a blog at `verbatim.com/@user`, optionally upgrades to a custom domain. Built only **after** single-tenant has been a daily driver for ≥3 months and the architecture has held up.

This document is **directional**, not buildable as-is. It exists to make sure the single-tenant build doesn't paint us into a corner.

---

## 1. Product

### What it is

A medium.com-class hosted blog platform with a Notion-class editor, built for speed.

- Anyone signs up at `verbatim.com`
- They get a blog at `verbatim.com/@user`, with posts at `/@user/post-slug`
- They write in the Verbatim editor (web app, same one as single-tenant, with a `/@user` namespace prepended)
- Posts publish instantly to their public blog
- Optionally, they buy a Pro subscription, plug their own domain, and the blog is served at `myname.com` instead — same content, different host
- Optional MCP credits add Claude editing without local setup (or they self-host MCP, free)

### What it isn't

- Not a newsletter platform (no email-out)
- Not a social network (no follows, no feed)
- Not a CMS for someone else's site (you can't headlessly use Verbatim as a backend)
- Not WordPress with themes (single fixed theme; sideload your own if you're a power user)

### Pitch

> "Notion-quality writing. Linear-quality interactions. Yours, in five seconds."

Speed is the differentiator. AI editing is a footnote.

---

## 2. Pricing

| Tier | Price | What you get |
|---|---|---|
| **Free** | $0 | `verbatim.com/@user` blog, unlimited posts, BYO MCP |
| **Pro** | ~$8/mo or $80/yr | Custom domain, hosted MCP credits (~30 sessions/mo), priority support |

That's it. No tiered storage limits, no post counts, no "team" plan in v1.

Note: the cost of running each free user is fractions of a cent per month. Free users are marketing. The Pro tier covers infra + a small margin. Don't optimize the free tier into uselessness.

---

## 3. Architecture

```
                   ┌──────────────────────────┐
                   │  Cloudflare              │
                   │  (DDoS, CDN, cache,      │
                   │   custom-domain SSL via  │
                   │   Cloudflare for SaaS)   │
                   └────────────┬─────────────┘
                                │
     ┌──────────────────────────┴──────────────────────────┐
     │                                                     │
     │ /editor*       (the SPA)                            │
     │ /api/*         (Fastify)                            │
     │ /@user[/post]  (Fastify SSR for blog pages)         │
     │ user.com/...   (same Fastify, different host       │
     │                 header — looks up user_id, renders) │
     │                                                     │
     │ ──────────────────────────────────────────────────  │
     │                                                     │
     │  Render (Node app, persistent process)              │
     │  ┌─ Fastify                                         │
     │  ├─ Vite-built SPA static files at /editor          │
     │  ├─ Postgres LISTEN/NOTIFY → WS hub                 │
     │  ├─ Background jobs: image processing, moderation,  │
     │  │   sitemap generation                             │
     │  └─ OpenAPI 3.1 spec generated from routes          │
     │                                                     │
     └──────────────────────────┬──────────────────────────┘
                                │
                                ▼
     ┌────────────────────────────────────────────────────┐
     │  Supabase (data plane)                             │
     │  - Postgres                                        │
     │      users, posts, post_versions, collections,     │
     │      domains, subscriptions, usage_events, etc.    │
     │      RLS policies enforce per-user isolation       │
     │  - Auth (Google OAuth + email/password)            │
     │  - Realtime channels (per-user post updates)       │
     │  - Storage (or use R2 — see below)                 │
     └────────────────────────────────────────────────────┘
                                │
                                ▼
     ┌────────────────────────────────────────────────────┐
     │  Cloudflare R2                                     │
     │  - User-uploaded images                            │
     │  - Zero egress, $0.015/GB-mo                       │
     │  - Cloudflare Image Resizing in front for variants │
     └────────────────────────────────────────────────────┘
                                │
                                ▼
     ┌────────────────────────────────────────────────────┐
     │  mcp.verbatim.com (Pro tier only)                  │
     │  - Hosted MCP server, HTTP transport               │
     │  - Claude Code config: paste a one-liner           │
     │  - Bills tokens against user's credit balance      │
     │  - Same Render app or separate small one           │
     └────────────────────────────────────────────────────┘

     ┌────────────────────────────────────────────────────┐
     │  blog-mcp (npm package, free path for self-host)   │
     │  - Same as single-tenant                           │
     │  - User installs locally, uses own Claude API key  │
     │  - Authenticates to Verbatim API with user token   │
     └────────────────────────────────────────────────────┘
```

### Stack summary

- **Editor:** Vite + React + TanStack Router + TanStack Query + BlockNote (same as single-tenant)
- **API + blog SSR:** Fastify on Render
- **DB / Auth / Realtime:** Supabase
- **Images:** Cloudflare R2
- **Edge:** Cloudflare (free for the standard product, paid Cloudflare for SaaS for custom domains at scale)
- **Email:** AWS SES via SMTP relay (cheap and reliable)
- **Moderation:** Cerebras/Groq Qwen 2.5 inference, ~$0.20/M tokens
- **Backups:** nightly logical dump from Supabase → R2

---

## 4. Multi-tenancy

### Routing

```
verbatim.com/                        landing
verbatim.com/editor                  the SPA (any signed-in user)
verbatim.com/api/v1/*                public API
verbatim.com/@ghaith                 Ghaith's blog index (SSR)
verbatim.com/@ghaith/on-ux-engineers Ghaith's post (SSR)
ghaith.com/                          if Ghaith bought Pro + bound domain
ghaith.com/on-ux-engineers           same content, different host
```

Fastify reads the host header. If host = `verbatim.com`, parse `/@user` from path. If host = anything else, look up `domains.host = host` to find user_id. Either way, fetch posts where `user_id = ?`, render Markdown to HTML, return.

### Schema additions vs single-tenant

```sql
-- existing posts table gains:
alter table posts add column user_id uuid not null references users(id);

-- domain bindings
create table domains (
  user_id     uuid primary key references users(id) on delete cascade,
  host        text unique not null,
  verified_at timestamptz,
  ssl_status  text  -- pending | active | failed
);

-- subscription state (could also be Stripe-managed externally)
create table subscriptions (
  user_id          uuid primary key references users(id),
  tier             text not null check (tier in ('free','pro')),
  stripe_customer  text,
  stripe_sub       text,
  current_period_end timestamptz,
  mcp_credits      int not null default 0
);

-- usage tracking
create table usage_events (
  id            bigserial primary key,
  user_id       uuid not null,
  event_type    text not null,  -- mcp.tool_call | publish | login | ...
  metadata      jsonb,
  created_at    timestamptz not null default now()
);
```

### RLS

Every user-scoped table gets:

```sql
alter table posts enable row level security;

create policy "users see own posts"
on posts for select
using (auth.uid() = user_id);

create policy "users modify own posts"
on posts for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
```

Plus the **public read** policy for blog rendering: published posts are world-readable.

```sql
create policy "world reads published posts"
on posts for select
using (status = 'published' and deleted_at is null);
```

The Fastify SSR routes use a separate Postgres role (`anon`) that has only the public-read policy — never the authenticated role. RLS bugs can't leak drafts because the rendering server literally can't see them.

**Test plan:** automated test that creates two users, signs in as user A, attempts to read user B's draft, asserts denial. Must pass in CI on every commit. Forever.

---

## 5. Custom domains

### User flow

1. User upgrades to Pro
2. Settings → Custom Domain → enters `mywriting.com`
3. We show them the required DNS records:
   - `A @ → 76.76.21.21` (Cloudflare for SaaS edge)
   - or `CNAME @ → custom.verbatim.com`
4. We poll their DNS until it resolves
5. We provision an SSL cert (Cloudflare for SaaS handles this automatically)
6. We mark the domain `verified_at = now()` and `ssl_status = active`
7. Their blog now serves at `mywriting.com`

### Implementation

Two paths:

- **Cloudflare for SaaS** — designed for exactly this. Up to 100 hostnames free, then $0.10/hostname/mo. Handles SSL provisioning, edge routing, certificate renewal. Recommended.
- **Caddy** — self-hosted ACME via Let's Encrypt. Free, more ops. Use only if Cloudflare for SaaS pricing doesn't work.

Cloudflare for SaaS is the answer until you have ~10K paid customers (~$1K/mo). At that point, the alternative is "deploy Caddy on a VPS in front of Render."

### Verification

Customer adds a TXT record `_verbatim.mywriting.com → <random-token>`. We resolve it. If match, we accept the domain. This proves they control DNS at that root.

---

## 6. Sync model

Same as single-tenant, scaled:

- Per-user Supabase Realtime channel: `posts:user_id=eq.<id>`
- WebSocket hub on Fastify pushes notifications to connected editor clients
- Each user's editor is unaware of other users' presence (no cross-user channels)

For ~10K concurrent connections, Supabase Realtime free tier supports 200, paid tier 10K+. Cost-effective.

If we ever outgrow Supabase Realtime, the fallback is **Postgres LISTEN/NOTIFY → Fastify WS hub → clients**. Already a known pattern. Migration is invisible to clients.

---

## 7. Public API + MCP

### Public API

OpenAPI 3.1 spec, generated from Fastify route schemas. Authentication via personal access tokens (settings page, "Generate new token"). 

Endpoints:

```
GET    /api/v1/posts
GET    /api/v1/posts/:slug
POST   /api/v1/posts
PATCH  /api/v1/posts/:slug
DELETE /api/v1/posts/:slug
POST   /api/v1/posts/:slug/publish
GET    /api/v1/posts/:slug/versions
POST   /api/v1/posts/:slug/revert
GET    /api/v1/collections
POST   /api/v1/collections
... etc
```

Rate limited per token. Free tier: 100 req/hour. Pro: 1000 req/hour. Adjustable.

### Hosted MCP (Pro)

`mcp.verbatim.com` — HTTP MCP transport. User adds to Claude config:

```json
{
  "mcpServers": {
    "verbatim": {
      "url": "https://mcp.verbatim.com/mcp?token=<personal-access-token>"
    }
  }
}
```

Each MCP tool call is metered against `subscriptions.mcp_credits`. When credits run low, top-up flow.

### Self-host MCP (free)

The same `blog-mcp` package from single-tenant, with auth swapped to use a personal access token + `verbatim.com/api/v1/*` instead of direct Supabase calls. User installs npm package, configures Claude with the local path, brings their own Claude Pro/API key.

The two MCP paths share ~95% of code — they're the same tools, different transports/auth.

---

## 8. Moderation

Pre-publish hook on `POST /api/v1/posts/:slug/publish`:

1. Send post body to Cerebras Qwen 2.5
2. Prompt: "Classify this content. Output JSON with fields: spam (bool), illegal (bool), nsfw (bool), reasoning (string)."
3. If spam=true or illegal=true → block publish, return error to user with reasoning
4. If nsfw=true → publish but flag in `posts.flags` for human review
5. Otherwise → publish

Cost per check: ~$0.00005. Free for free users.

**Manual review queue:** flagged posts appear in an admin dashboard. Take action: ignore, hide (`status = 'hidden'`), delete user (`status = 'banned'`).

**Image moderation:** every R2 upload runs through PhotoDNA hash check (NCMEC requirement) + a separate vision model for adult content. CSAM hash match → refuse upload + report.

**Abuse / DMCA:**

- `abuse@verbatim.com` and `dmca@verbatim.com` aliases
- Documented takedown process
- 10-business-day SLA on DMCA notices
- Three-strikes account suspension for repeated violations

---

## 9. Auth

Supabase Auth: Google OAuth + email/password.

- Google OAuth: 95% of signups will use this. One click.
- Email/password: fallback. Magic link is also available but email/password is more familiar.
- Personal access tokens: separate from session auth, used by API and MCP. Generated in settings, scoped to a user, revocable.

Email transactional flow uses AWS SES via SMTP. Custom templates rendered server-side.

---

## 10. Backups + DR

- **Hourly:** WAL archiving (Supabase handles this on paid tier)
- **Nightly:** logical dump (`pg_dump`) → R2, encrypted
- **Weekly:** restore drill — spin up a fresh Supabase project, restore from R2, verify a known query returns expected data, tear down. Automated.

If Supabase becomes unavailable, recovery is: provision a new Postgres anywhere, restore from R2, point the app at the new connection string. ~30 minutes if practiced.

---

## 11. Operational concerns

### Cost projection

For 1,000 active users (mix of free and ~10% paid):

- Render: $25/mo (Standard plan, single instance)
- Supabase Pro: $25/mo (handles up to ~50K weekly active for our load)
- Cloudflare for SaaS: ~$10/mo (100 free hostnames, then $0.10/each)
- R2 storage: ~$5/mo (assume avg 100MB images per user, 100 paid users with images)
- AWS SES: ~$1/mo (transactional volume is tiny)
- Cerebras: ~$5/mo (moderation only — small volume)
- Domain, monitoring: ~$5/mo

**Total: ~$75/mo.** With 100 paid at $8 → $800 MRR. Healthy margin.

### Monitoring

- Uptime: UptimeRobot or Better Stack (free tier)
- App errors: Sentry (free tier)
- DB metrics: Supabase dashboard
- Custom: log shipping from Render → Axiom or similar (free tier)

### Single point of failure

The Fastify server on Render is one process. If it crashes:

- Render auto-restarts in <30s
- Cloudflare cache continues serving most blog HTML during the gap
- The editor app (already loaded in tabs) keeps working locally; sync queues up
- Total user-perceptible downtime for a typical Render restart: <30s

For real high availability, run two Render instances behind a load balancer ($50/mo). Defer until needed.

---

## 12. Phases of public launch

### Phase 2.0 — Migration prep (1 week)

- [ ] Single-tenant code refactored to know about `user_id` (already in schema by then)
- [ ] Move Verbatim from "ghaith's existing Supabase" to a fresh Supabase project for multi-tenant
- [ ] Stripe integration for Pro tier billing

### Phase 2.1 — Public alpha (4–6 weeks)

- [ ] Signup flow (Google + email/password)
- [ ] `/@user` routing in Fastify
- [ ] Blog SSR with Cloudflare cache
- [ ] Pro tier paywall (custom domain feature gated)
- [ ] Cloudflare for SaaS integration for custom domains
- [ ] Public API with personal access tokens
- [ ] OpenAPI docs page

### Phase 2.2 — Moderation + Trust (2 weeks)

- [ ] Pre-publish moderation pipeline
- [ ] Image hash check on upload
- [ ] Abuse alias + admin dashboard for flagged content
- [ ] DMCA takedown process documented
- [ ] Privacy policy, ToS, GDPR data export

### Phase 2.3 — Hosted MCP (2 weeks)

- [ ] `mcp.verbatim.com` HTTP MCP server
- [ ] Per-user credit metering
- [ ] Stripe top-up flow

### Phase 2.4 — Closed beta (4 weeks)

- [ ] Invite ~50 writers (existing audience, friends)
- [ ] Daily driver use, weekly bug fixes
- [ ] Iterate on signup flow + onboarding

### Phase 2.5 — Public launch

- [ ] Show HN, Product Hunt, etc.
- [ ] Watch error rates, scale Render up if needed
- [ ] Don't add features for 30 days post-launch — fix what surfaces

---

## 13. Open questions

To answer before scaffolding Phase 2.0:

1. **Themes.** Single fixed design (Substack model) or "sideload a template" (power user)? Sideload sounds simple but is a massive surface area.
2. **Comments.** Build them, integrate (Disqus / Hyvor / Cusdis), or skip entirely? Recommend skip — keeps scope small, blogs that want comments can embed third-party widgets.
3. **RSS / Atom feeds.** Auto-generate per-user. Trivial. Yes.
4. **Sitemaps.** Auto-generate per-user, expose at `/@user/sitemap.xml`. Trivial. Yes.
5. **OpenGraph images.** Render per-post via `@vercel/og` or similar at request time, cache. Yes.
6. **Analytics for users.** Show writers their post views? Build (cheap, helpful) or skip (privacy-first stance)? Probably build a simple counter per post, no third-party tracking.
7. **Migration tooling.** Build importers for Substack / Medium / Ghost from launch? Recommend yes — drives signups significantly.
8. **Mobile authoring.** Editor on phone — does it work in the same SPA, or build a separate mobile flow? If BlockNote is mobile-friendly, we get this free. Test early.

---

## 14. Why this PRD is directional, not buildable

Two reasons:

1. **Single-tenant must validate the architecture first.** The decisions in single-tenant — idle-driven sync, Markdown storage, BlockNote, MCP local path — could be wrong. We won't know until we live with it for ≥3 months. Building Phase 2 on unvalidated decisions risks rebuilding when reality hits.

2. **The hard parts of multi-tenant aren't engineering, they're product.** Pricing, moderation policy, theming, signup conversion, billing edge cases, support process — these need real users to inform them, not a PRD.

So this document captures: the architecture is *coherent and reachable* from single-tenant. It does not claim every product decision is final.

If single-tenant works as a daily driver and you still want public Verbatim 3 months in, this PRD is the starting point — not the spec.
