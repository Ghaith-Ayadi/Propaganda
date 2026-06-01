# Verbatim — Plan

A Framer-to-(Next.js + Payload) migrator and a Framer-replacement CMS. **Internal / non-commercial — not a product to sell.**

One site in scope: **[ayadighaith.com](http://ayadighaith.com/)** (Ghaith's personal site). The plan must be valuable for this site alone.

_Drafted 2026-04-25, based on four parallel research streams covering Framer extraction, Payload visual editing, Next.js frontend defaults, and the competitive landscape. Updated 2026-05-06: scoped to Phase 1 only; stack updated to Supabase._

---

## 0. TL;DR (the five decisions that drive everything)

1. **Build the migrator as a Framer Plugin called "Verbatim Migrator."** It's the only ToS-clean, typed, sanctioned path. Hybrid it with a **headless render of the published site** for visual ground truth. Trademark guidelines apply only if the plugin is ever published to Framer's marketplace; for purely local use, the name is flexible.
2. **Stack: Next.js 15 + Payload 3 in one app, Supabase (PostgreSQL), Cloudflare R2 for media, Vercel for hosting.**
3. **Editing model = Payload form-admin + iframe Live Preview + a Sanity-style stega click-to-edit overlay.** Block-based composition only. **Refuse free-form drag-drop pixel positioning** — most important opinionated boundary in the build.
4. **Per-document publish permission is available as a first-party Payload plugin.** For a single-editor site it may be overkill — audit at V0.1 and drop V0.6 if it's just Ghaith.
5. **Never execute editor-authored TSX at runtime.** Blocks live in Git, ship via PR + Vercel preview deploy. "Ship a new block fast" is a CI/CD problem, not a sandbox problem.

---

## 1. What Verbatim is

Two halves welded together:

- **Half A — Migrator.** One-shot Framer site → Next.js codebase + populated Payload collections + redirects + locales + SEO meta + media re-hosted. Lossy by design: Framer's runtime quirks (shader effects, scroll-linked composite animations, smart-component state machines) get rebuilt in our block library or flagged for hand-finish. Ran *once* for the migration.
- **Half B — CMS.** Headless Payload + Next.js with first-class visual editing, granular per-document publish permissions, editor-managed marketing pixels, redirects, forms. What we live in *forever after* on the migrated site.

Why build this rather than just adopt Sanity / Builder.io / stay on Framer? Because the *combination* of (a) a clean dev-editable Next.js codebase, (b) automated Framer migration, and (c) per-document publish permissions doesn't exist off the shelf. Each piece exists in some product; nothing puts them together. If any one of those three doesn't matter to Ghaith, the build-vs-buy answer changes — see §7.

What Verbatim is **not**: a free-form pixel canvas; a runtime-TSX evaluator; a Framer-runtime wrapper (that's unframer's territory and inheriting Framer's private semantics with no maintenance access is a dead end).

---

## 2. Framer extraction — Framer plugin: yes.

Plugin-driven extraction wins on every axis:

| Path | ToS posture | Data fidelity | Maintenance | Verdict |
|---|---|---|---|---|
| **Framer Plugin + Server API** | Sanctioned (the API exists for this) | Typed access to CMS, redirects (since v3.2.0, May 2025), locales (v3.1.0), color/text styles, pages, code files, page-level node tree | Pin to plugin SDK; track Framer's ~6-week release cadence | **Build this.** |
| Pure scrape of published site | ToS §2.4(q) explicitly forbids "page-scrape, robot, spider or other automatic device" | Inherits Framer's runtime tricks (hover styles set via JS, scroll-reveal `opacity:0`, lazy images, CMS hydrated client-side) | Re-implement Framer's private DOM contract by hand, forever | Avoid as primary; only as opt-in fidelity reconciler against the site you own. |
| Wrap unframer | MIT; sanctioned plugin path | Highest visual fidelity | Components are opaque Framer-runtime bundles | Wrong path for "own your codebase." Useful as a same-day stopgap if you ever needed one. |
| LLM-assisted manual rebuild | Clean | Variable | Per-site time blowout | Last-resort fallback for shader/3D-heavy pages. |

### What the plugin can capture (clean)

- Page tree and layout (via `getCanvasRoot()` + `getNodesWithType("FrameNode")`) — supports Design Pages since v3.7.0 (Sep 2025)
- CMS collections + items + slug + draft + locale variants; `formattedText` rich text comes out as **HTML** (or Markdown via `contentType` opt-in) — straight into a Lexical/HTML→AST converter for Payload
- Color styles (light/dark variants) and text styles (4 breakpoints, single font family per style)
- **Redirects**, including wildcards and capture groups (`addRedirects` / `getRedirects` since v3.2.0)
- Locales and localization groups (`getLocales` / `getLocalizationGroups` since v3.1.0)
- Code files (`getCodeFiles` since v3.4.0) — capture as-is, clean up post-migration
- Image and file URLs from `framerusercontent.com` for the asset re-host pipeline

### What the plugin cannot capture (must be reconstructed)

- No full-tree serializer — traverse and read attributes per node type yourself
- Computed style cascade (read `supports*` traits flags but not the resolved style result)
- Hover-effect runtime values (Framer mutates `element.style` via `whileHover`; styles don't exist in any stylesheet)
- Shader / Logo Shader parameters (proprietary GLSL effects, no API)
- Smart-component state machines and per-instance overrides (variants/variables beta requires every override field exposed as a master variable)
- Scroll-linked composite animations (effect bindings readable; runtime behavior is Framer-private)
- Form *logic* (validation rules, integration mappings) — only field structure is reconstructable
- Form **submissions** — must be pulled from whichever destination was wired (HubSpot, Sheets, etc.)

**Therefore: hybrid extractor.** Plugin for semantics, headless-browser render of your *own* domain for visual ground truth. Reconciler diffs the two and surfaces a "needs hand-finish" report per page.

---

## 3. Architecture

### 3.1 Topology (one repo, one app)

```
verbatim/
├── apps/
│   ├── web/                    # Next.js 15 + Payload 3 (single deploy)
│   └── migrator-plugin/        # Framer Plugin (run locally; publishing optional)
├── packages/
│   ├── blocks/                 # TSX block library — registered components
│   ├── visual-editing/         # Stega + overlay runtime
│   ├── permissions/            # Payload plugin: per-doc publish gating
│   ├── migrate-core/           # Plugin output → Payload importer
│   └── render-reconciler/      # Headless-render diff tool (optional fidelity mode)
```

Why monorepo: the migrator's intermediate JSON schema is shared between `migrator-plugin` (producer), `migrate-core` (consumer), and `blocks` (target). Diverging types kill you fast.

### 3.2 Runtime stack

- **Next.js 15** App Router. PPR opt-in per route (`experimental_ppr = true`) for static-shell + streamed personalization.
- **Payload 3** in the same app. Routes mounted under `/admin` and `/api`. Local API for all RSC reads — zero network hop.
- **Supabase (PostgreSQL)** via `@payloadcms/db-postgres`. Supabase provides a managed Postgres instance with connection pooling (PgBouncer) built in — use the pooler connection string for serverless. Schema migrations are handled by Payload's migration runner.
- **Cloudflare R2** via `@payloadcms/storage-s3` (R2's S3-compatible API). Zero egress cost. Supabase Storage is an alternative but R2 is cheaper at scale and keeps media separate from the DB tier.
- **Vercel** for hosting. Serverless functions + Edge middleware. Connect to Supabase via the pooler URL; keep `max` pool size low (e.g., 3) to avoid exhausting Supabase's connection limit on the free/pro tier.
- **Resend** for transactional email; **Cloudflare Turnstile** for forms; **Plausible** as default analytics; **Iubenda** or self-hosted minimal banner for consent (avoid Cookiebot — 2× price hike Aug 2025).
- **Vercel Cron** → `/api/payload-jobs/run` every 5 min for scheduled publishes and revalidation.

### 3.3 Data model (initial collections)

```
pages              { slug, title, layout: blocks[], seo, allowedPublishers, _status }
posts              { slug, title, layout: blocks[], category, author, publishedAt,
                     allowedPublishers, _status }
media              { upload, alt, focalX, focalY, imageSizes[] }
forms              { (plugin-form-builder schema) }
formSubmissions    { (plugin-form-builder schema) }
redirects          { from, to, type: 301|302|307|308, isRegex }
users              { email, name, role: 'admin'|'editor'|'publisher'|'viewer' }

# Globals
header             { nav, ctaButton }
footer             { columns, legalLinks }
seoDefaults        { siteName, defaultOgImage, twitterHandle }
siteScripts        { entries: [{ name, src, inline, position, strategy,
                                 consentCategory, enabled }] }
robotsConfig       { rules, sitemapUrl }
notFoundPage       { layout: blocks[] }
```

### 3.4 Block library v0 (the curated palette)

Twelve blocks cover ~80% of typical Framer marketing pages: `Hero`, `Heading`, `RichText`, `FeatureGrid`, `LogoCloud`, `Testimonial`, `CTA`, `Image`, `Gallery`, `VideoEmbed`, `FAQAccordion`, `PricingTable`. Each is one TSX file + a co-located Payload Block config. New blocks ship via PR → Vercel preview deploy → merge.

### 3.5 Visual editing layer (Sanity-style)

Three pieces that compose:

1. **Stega-encoded field reads in draft mode.** Wrap every Payload field read with a helper: in draft mode it splices a zero-width-Unicode `{docId, fieldPath}` provenance trail into every string. Production mode = pass-through.
2. **Block wrappers emit explicit attributes.** Every block component emits `data-verbatim-doc`, `data-verbatim-field` on its root.
3. **`<VerbatimVisualEditing />` overlay runtime** (client island, draft-only). Decodes stega from the DOM and scans for data attributes. On click: shows a toolbar (Edit field / Move block / Duplicate / Delete) and posts `{intent, docId, fieldPath}` back to the admin iframe via `postMessage`. Admin focuses the matching form field.

Click on the rendered page, edit on the right — without forking Payload's admin or building a free-form canvas. Exactly what Sanity's Presentation tool does, battle-tested for 2+ years. We use `@vercel/stega` (npm-published) rather than rolling our own provenance encoding.

What we **don't** build: free-form drag-drop pixel positioning. Block-level reorder via drag-handle in the overlay is enough; intra-block layout is the block author's responsibility.

### 3.6 Permissions plugin (`@verbatim/permissions`)

Available if needed — only build if V0.1 reveals more than one editor. Three components:

- **Field component**: `allowedPublishers: relationship('users', hasMany)` auto-injected onto any collection that registers with the plugin. Field-level access: only admins or the doc's existing publishers can edit the list (closes the privilege-escalation door).
- **`withPublishGate(updateFn)` helper**: wraps the `update` access fn with the canonical pattern:
  ```ts
  if (data?._status === 'published') {
    return user.role === 'admin' || doc.allowedPublishers.includes(user.id)
  }
  return baseUpdateFn({req, id, data})  // drafts permitted to editors
  ```
- **Admin UI affordance**: a "Publishers" tab on each doc with an autocomplete-add picker; the Publish button hides itself when access denies (Payload's admin already does this via the access fn return value).

### 3.7 Frontend defaults baked into every Verbatim site

- `next/image` with `formats: ['image/avif','image/webp']`; one `priority` LCP image per route
- Self-hosted variable fonts via `next/font/local`, `font-display: swap` with declared fallback metrics
- Animation: CSS / View Transitions API / scroll-driven CSS animations first; `motion/react` only inside `"use client"` islands
- Forms: Server Action handler → Zod schema (shared client/server) + react-hook-form on the client + Turnstile + honeypot + edge rate-limit
- Redirects at scale: Payload `redirects` collection → build step syncs to Vercel Edge Config + a Bloom filter; middleware checks filter, falls back to Edge Config lookup. `next.config.js redirects()` reserved for ≤50 infrastructure-level rules (capped at 1,024 anyway).
- SEO: `@payloadcms/plugin-seo` for editable meta + canonical; `generateMetadata` reads from it; JSON-LD typed with `schema-dts`; OG images via `app/opengraph-image.tsx`
- Sitemap: `app/sitemap.ts` + `generateSitemaps` (sharded above 50k URLs), querying Payload Local API
- Cookies: `denied` Consent Mode v2 defaults, every third-party `<Script>` mounted only after `ConsentGate` resolves
- Marketing pixels: `siteScripts` global edited by marketing → root layout reads it server-side → `<Script>` tags rendered through `ConsentGate`. Adding a pixel = no code deploy
- CSP: nonce-based via middleware for routes that inject editor-managed scripts; static CSP fallback for the rest (avoids breaking PPR everywhere)

---

## 4. Releases — V0.1 → V1.0

The split is **risk-front-loaded**: each release retires a specific risk. If a release fails its acceptance criteria, you stop and replan rather than discovering the failure layered under three more releases.

### V0.1 — Site audit & scope freeze (1 week)

**Goal:** lock scope; know exactly what ayadighaith.com uses so nothing surprises the migration.

- **Audit ayadighaith.com**: page count, CMS collection count, redirects, forms, integrations wired, custom code components, shader/3D/scroll-linked-animation usage, locales, SEO meta coverage
- Define Phase 1 SLOs: ≥80% block-fidelity per page, ≥95% CMS data fidelity, 100% redirect fidelity, 100% SEO meta fidelity
- **Decide:** how many people will use the admin? If it's just Ghaith, V0.6 (permissions plugin) is over-built — drop it and free that release.

**Why first:** if ayadighaith.com is all shader-heavy or uses features we can't migrate, the plan changes shape now.

### V0.2 — Foundation Skeleton (2–3 weeks)

**Goal:** prove the runtime stack works before adding the migrator.

- Monorepo + Next.js 15 + Payload 3 + Supabase + R2 wired in a single app
- Core collections: `pages`, `posts`, `media`, `users`, `redirects`
- 6 blocks shipped (`Hero`, `Heading`, `RichText`, `FeatureGrid`, `Image`, `CTA`)
- Live Preview iframe wired for `pages` and `posts`
- CI: PR → Vercel preview, type-check, eslint, basic Playwright smoke test

**Why second:** every other release runs against this skeleton. Discover Payload-on-Vercel cold-start issues, Lexical converter pain, R2 CORS pain, Supabase pooler config *now*.

### V0.3 — Verbatim Migrator (Framer Plugin), read-only (3–4 weeks)

**Goal:** prove extraction independent of import.

- Framer Plugin scaffold (run locally against the in-scope Framer projects)
- Canvas walker per node type (Frame, Text, Component, Graphic, SVG, CodeComponent, Unknown) → typed JSON in our intermediate schema
- CMS extractor: `getCollections` → `getItems` → flatten by field type (HTML rich text, refs, gallery, etc.)
- Redirects extractor (`getRedirects`)
- Color/text style extractor
- Locales + localization groups
- Output: a downloadable `verbatim-export.zip` (JSON + asset manifest)

**Why split here:** extraction can be validated against the actual Framer project with **no transformation logic**. If the plugin can't faithfully serialize the in-scope site, the rest of the pipeline doesn't matter.

### V0.4 — Migrator → Payload Importer (3 weeks)

**Goal:** intermediate JSON → live Payload site.

- `migrate-core` package: deterministic mapper from intermediate JSON → Payload Local API calls
- Per-Framer-node-type → per-Verbatim-block converters with a "best fit + flag" strategy (unknown nodes → `RichText` block + warning)
- Asset re-host pipeline: download from `framerusercontent.com` → upload to R2 → rewrite URLs in the document tree
- Redirect import → `redirects` collection
- HTML rich text → Lexical AST converter (use the established `rehype-*` family or `@payloadcms/richtext-lexical`'s HTML converter)
- Migration job runs in a Payload Job Queue worker (long-running)
- Per-page fidelity report ("87% migrated, 13% flagged for hand-finish: shader on Hero, scroll-link on Section 3")

**Why split here:** importer brittleness comes from a hundred small Framer-isms. Owning its lifecycle separately means you can patch one converter without redeploying the plugin. Acceptance: ayadighaith.com imports end-to-end with ≥80% block-fidelity.

### V0.5 — Visual Editing Layer (3 weeks)

**Goal:** click-to-edit on the rendered page.

- `@vercel/stega` encoder helper around Payload field reads, gated by `draftMode().isEnabled`
- Block wrappers emit `data-verbatim-*` attributes (refactor the V0.2 blocks)
- `<VerbatimVisualEditing />` overlay runtime with three intents: edit-field, move-block, delete-block
- Admin iframe handler that focuses the matching form field on incoming `postMessage`

**Why split here:** self-contained value layer with zero impact on migration. If it slips, editors can still work in the form admin. Quality-of-life upgrade, not a blocker.

### V0.6 — Permissions Plugin (2–3 weeks) _(drop if single-editor)_

**Goal:** ship per-document publish.

- `@verbatim/permissions` Payload plugin
- `allowedPublishers` field auto-injection
- `withPublishGate` helper
- Admin UI: "Publishers" tab + autocomplete-add picker + audit trail of publish events
- Internal docs: "How to give someone publish access to one specific blog post"

**Why split here:** distinctive feature, deserves its own release for UX iteration. Skip entirely if V0.1 confirms it's a single-editor site.

### V0.7 — Forms, Redirects at Scale, SEO Polish (2 weeks)

**Goal:** publishing-surface table stakes.

- `@payloadcms/plugin-form-builder` wired with Server Actions, Zod validation, Turnstile, Resend
- Bloom-filter redirect middleware + Edge Config sync job
- `@payloadcms/plugin-seo` defaults; `app/sitemap.ts` + `generateSitemaps`; `opengraph-image.tsx` template; JSON-LD per template
- `siteScripts` global + `ConsentGate` runtime + nonce-based CSP middleware
- Iubenda or self-hosted consent banner (pick once)

**Why bundled:** these are integrations more than inventions; they share the same release surface (the published front-end) and benefit from shared QA.

### V0.8 — Hybrid Render Reconciler (2 weeks, optional)

**Goal:** "high fidelity" mode for shader-heavy / animation-heavy pages.

- Playwright-based crawler that renders the published Framer site, captures DOM + computed styles + final hover/scroll states
- Diff tool that compares the rendered output against the V0.4 import; surfaces `style-delta` / `missing-animation` / `missing-asset` warnings
- "Apply override" affordance: emit per-page CSS overrides to a Payload-stored stylesheet collection so the migrated site can match the original pixel-perfect when needed

**Why last:** optimization on top of the migration, not a foundation. Skip entirely if V0.4 hits fidelity SLOs without it.

### V0.9 — Cutover: ayadighaith.com goes live (2–3 weeks)

**Goal:** ayadighaith.com runs on Verbatim.

Pre-cutover:
- Lower DNS TTL on ayadighaith.com to 300s **at least 48 hours before** cutover
- Run final import on a staging URL (e.g., `staging.ayadighaith.com` or a Vercel preview); manual page-by-page review
- All redirects loaded into Edge Config + verified with a list crawler
- Forms tested end-to-end — submission lands where it should
- Sitemap generated, OG images render, Core Web Vitals baseline captured for comparison post-cutover

Cutover:
- Content freeze on Framer side during the window
- Final import (incremental on top of staging — no cold rerun)
- DNS swap to Vercel
- Smoke test: top 20 pages, all forms, all redirects (use a curl-based check script)

Post-cutover:
- 14-day 404 monitor with auto-suggest from Vercel logs
- Search Console sitemap re-submission; index status check at 24h / 7d / 14d
- Core Web Vitals regression check (LCP/INP/CLS deltas)
- Keep the Framer site alive as instant rollback for 30 days (don't cancel the subscription yet)
- Ghaith publishes one new post end-to-end via Verbatim before declaring V0.9 done

### V1.0 — Stable

**Goal:** ayadighaith.com has been live, stable, and editor-validated.

- Internal runbook ("how to migrate a Framer site to Verbatim") — written from V0.9's lived experience
- "Why we don't do shaders" doc — explicit scope guardrail
- Block library catalog with screenshots
- Backup / restore / DR runbook for the live deployment
- Short retrospective: what we'd do differently
- **Set a freeze date.** Before V1.0 ships, decide: "I will stop building new Verbatim features after [date]." Internal projects die from indefinite iteration; this is the single most effective antidote.

### Why this split

- **Risk retired in monotonic order.** V0.1 retires scope risk. V0.2 retires stack risk. V0.3 retires extraction risk. V0.4 retires transformation risk. V0.5 retires editing-UX risk. V0.6 retires permissions-UX risk. V0.7 retires integration risk. V0.8 retires fidelity risk. V0.9 retires real-world risk.
- **Demo-able value at every release ≥V0.4.** From V0.4 onward, you have a working migration. Visual editing, permissions, forms, and reconciler are additive — defer any one without blocking cutover.
- **Permissions plugin gets its own release** because its UX needs isolated attention. **If V0.1 reveals only 1 editor, drop V0.6 entirely** and reclaim the time.
- **Reconciler ships last** because it's a perfectionist optimization that's easy to over-invest in early.

---

## 5. Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| **R1** | Payload ships per-document publish UX natively | Medium — known roadmap item | Low — not a moat to lose; we'd just swap our plugin for theirs and save maintenance | Watch Payload changelog. If it ships before V0.6, skip the plugin and adopt theirs. |
| **R2** | Framer breaks/renames Plugin API (10+ minor releases in 14 months) | High — Framer's cadence is ~6 weeks | Medium — migrator goes stale | CI job that runs the plugin against a fixture Framer project on every Framer SDK release; alert on type-check breaks. Pin SDK; bump deliberately. Once the in-scope site is migrated, the migrator's lifecycle effectively ends — accept staleness post-cutover. |
| **R3** | Block-based reconstruction fails to hit 80% fidelity on ayadighaith.com | Medium — depends on which features it uses | Critical — migration premise broken | V0.1 scope-freeze surfaces shader/animation-heavy pages early; abort or rescope individual pages to V0.8 reconciler / hand-rebuild. |
| **R4** | Visual-editing iframe contract drifts with Next.js / React upgrades | Medium | Medium — ongoing tax | Lock to one major Next.js per Verbatim major; integration-test the postMessage contract. |
| **R5** | Payload-on-Vercel cold starts exhaust Supabase connection pool | Medium | Medium | Use Supabase's PgBouncer pooler URL (transaction mode) in the connection string; keep `max` connections low (≤3 per function). Upgrade Supabase tier if needed. |
| **R6** | Visual editor maintenance burden across React versions | Medium | Medium — ongoing tax | Lean on stega (Sanity-proven, `@vercel/stega`); minimal custom DOM contract; treat overlay as a small surface, not a full canvas. |
| **R7** | Scope creep into "rebuild the entire CMS" (forms engine, A/B, DAM, analytics surface, etc.) | High — the genre's classic failure mode | Critical — single biggest reason internal projects die | Strict charter: anything not in V0.1–V1.0 is post-V1. Decline by default. Re-read this row monthly. |
| **R8** | Hand-rolled HTML→Lexical rich-text converter loses formatting | Medium | Medium — editor frustration | Use `@payloadcms/richtext-lexical`'s HTML converter as primary; supplement with a custom tag map for Framer-specific tags. Test against real Framer rich text fixtures in CI. |
| **R9** | `siteScripts` feature becomes an XSS vector | Low if scoped | High | Validate `src` against an allowlist of known providers; sanitize `inline` script blocks via CSP nonce + a curated provider registry; require admin role to add new providers. |
| **R10** | Trademark exposure if the migrator plugin is ever published to Framer's marketplace | Low (we may never publish it) | Medium | Plugin name "Verbatim Migrator" is fine. Only matters if we publish; keep private until then. |

---

## 6. Tips, opportunities, leverage points

- **Reuse Sanity's stega pattern verbatim** via `@vercel/stega`. Two years deployed, well-understood. Don't invent your own provenance encoding.
- **Vercel preview deployments per PR is the "ship a block fast" story.** Ten minutes from PR open to staging URL editors can preview against. Frames the dev-vs-editor relationship correctly: editors propose, devs ship blocks.
- **Build the migrator's extractor as a pluggable interface anyway.** Trivially small extra design effort, and if Verbatim ever ingests another platform's export, the architecture is ready.
- **Use Payload Job Queue for everything async.** Migration runs, reconciler renders, scheduled publishes, image regeneration, sitemap refresh. Keeps the request path fast and stateless.
- **`unstable_cache` + tag-based revalidation, ruthlessly.** RSC pages should hit Supabase only on first miss after publish. Tag every read; revalidate on `afterChange`.
- **The 14-day post-launch 404 monitor is high-leverage and easy.** Auto-suggest redirects from real traffic logs. Catch the SEO regression that always happens on a CMS migration.
- **Lean opinionated on the block library.** Twelve good blocks beats fifty mediocre ones. The block library is the visual identity of every Verbatim site.
- **Consent Mode v2 default-correct setup matters.** GDPR fines are real for EU sites. Get it right at V0.7, don't bolt it on later.
- **Set a "freeze date."** After V0.9 cutover, give yourself permission to stop building Verbatim. The temptation to keep iterating on an internal tool past the point of utility is real and the costliest scope-creep mode.
- **Supabase connection pooling is the one infra gotcha.** Transaction-mode pooler (port 6543) for serverless; session-mode pooler (port 5432) for Payload's migration runner. Don't mix them up — migrations will hang in transaction mode.

---

## 7. Build vs buy — the honest check

**Verbatim is only worth the time if these are simultaneously true:**

1. **You want to migrate off Framer.** If staying on Framer handles the actual pain, that's faster and cheaper. Framer's Pro/Business tiers add team workflows, redirect management, and SEO features — re-check whether their 2026 feature set already covers your gaps before committing.
2. **You want a clean, dev-editable Next.js codebase.** If you'd be just as happy in Sanity Studio, Builder.io, Storyblok, or Webflow CMS — those are weeks of work, not months. Sanity Presentation gives you the click-to-edit overlay for free; Builder.io's Visual Copilot does Figma→registered components.
3. **The engineering exercise itself is the point.** Building the Framer-replacement stack on your own site is a form of R&D. That's a legitimate reason to build.

For a single-editor site, criterion 3 is the only one that needs to hold concretely. The permissions plugin (V0.6) is unnecessary at scale 1 — drop it if V0.1 confirms this.

Two kill conditions inside the build:

- **If, after V0.3, fidelity on ayadighaith.com comes in < 70%** without bundling Framer's runtime, the migration premise is broken. Pivot to "rebuild ayadighaith.com by hand on the V0.2 skeleton" — Verbatim becomes just the Next.js + Payload + visual editing stack, with no migrator.
- **If V0.5 visual editing turns out to be too brittle** (postMessage / stega / overlay bugs eat weeks), drop V0.5 and ship the form-admin Live Preview only. Editing in Payload's form admin is fine; the overlay is icing.

---

## 8. Open questions before V0.1

- **Site scope detail:** ayadighaith.com — page count, CMS collection count, redirect count, forms wired, integrations (analytics, comment system, etc.), any custom Framer code components, locales.
- **Editor count:** ayadighaith.com is 1 editor (you), so V0.6 permissions plugin is over-built. Confirm at V0.1 — if confirmed single-editor, drop V0.6 permanently.
- **Timeline pressure:** is there a Framer subscription renewal date, a brand refresh, or some other deadline driving cutover? If yes, decide early which optional releases (V0.5 visual editing, V0.8 reconciler) get cut.

---

## Appendix — research sources by stream

### Framer extraction
- [Framer Developers Reference](https://www.framer.com/developers/reference) · [Concepts](https://www.framer.com/developers/concepts) · [Nodes](https://www.framer.com/developers/nodes) · [CMS](https://www.framer.com/developers/cms) · [Styles](https://www.framer.com/developers/styles) · [Changelog](https://www.framer.com/developers/changelog)
- [Plugins 3.2 — Redirect APIs](https://www.framer.com/updates/plugins-3-2) · [Server API](https://www.framer.com/updates/server-api)
- [Framer ToS](https://www.framer.com/legal/terms-of-service/) · [Trademark guidelines](https://www.framer.com/legal/trademark-guidelines/)
- [unframer (Tommy D. Rossi / @remorses)](https://github.com/remorses/unframer) · [Framer marketplace listing](https://www.framer.com/marketplace/plugins/react-export/)
- [ConvertFramer](https://convertframer.com/) · [BrowserCat: Migrate Framer to Next.js](https://www.browsercat.com/post/migrate-framer-to-nextjs)
- [Reverse-engineering Framer's React runtime (Ankur Khandelwal)](https://dev.to/ankur_khandlwal/i-reverse-engineered-framers-react-runtime-to-export-sites-as-static-html-b75)

### Payload visual editing
- [Payload 3.0 announcement](https://payloadcms.com/posts/blog/payload-30-the-first-cms-that-installs-directly-into-any-nextjs-app)
- [Live Preview](https://payloadcms.com/docs/live-preview/overview) · [Server-side Live Preview](https://payloadcms.com/docs/live-preview/server)
- [Drafts](https://payloadcms.com/docs/versions/drafts) · [Versions overview](https://payloadcms.com/docs/versions/overview) · [Autosave](https://payloadcms.com/docs/versions/autosave)
- [Rich Text overview](https://payloadcms.com/docs/rich-text/overview) · [Blocks Field](https://payloadcms.com/docs/fields/blocks) · [Localization](https://payloadcms.com/docs/configuration/localization)
- [Access Control overview](https://payloadcms.com/docs/access-control/overview) · [Collection Access Control](https://payloadcms.com/docs/access-control/collections) · [Field-level Access](https://payloadcms.com/docs/access-control/fields)
- [Build Your Own RBAC](https://payloadcms.com/posts/blog/build-your-own-rbac) · [Discussion #1009 — Publish access](https://github.com/payloadcms/payload/discussions/1009)
- [Form Builder](https://payloadcms.com/docs/plugins/form-builder) · [Redirects](https://payloadcms.com/docs/plugins/redirects) · [SEO](https://payloadcms.com/docs/plugins/seo) · [Storage Adapters](https://payloadcms.com/docs/upload/storage-adapters)
- [Sanity Visual Editing — Next.js App Router](https://www.sanity.io/docs/visual-editing/visual-editing-with-next-js-app-router) · [Sanity Presentation tool](https://www.sanity.io/docs/visual-editing/configuring-the-presentation-tool)
- [next-mdx-remote RCE (Socket)](https://socket.dev/blog/high-severity-rce-vulnerability-disclosed-in-next-mdx-remote)
- [Vercel Sandbox for AI-generated code](https://vercel.com/kb/guide/running-ai-generated-code-sandbox)

### Next.js frontend defaults
- [Next.js Image](https://nextjs.org/docs/app/api-reference/components/image) · [Partial Prerendering](https://nextjs.org/docs/15/app/getting-started/partial-prerendering) · [Fonts](https://nextjs.org/docs/app/getting-started/fonts) · [Script](https://nextjs.org/docs/app/api-reference/components/script) · [redirects config](https://nextjs.org/docs/app/api-reference/config/next-config-js/redirects)
- [Vercel dynamic redirects KB](https://vercel.com/kb/guide/dynamic-redirects-with-edge-config-and-next-js-proxy) · [Vercel Image cost management](https://vercel.com/docs/image-optimization/managing-image-optimization-costs) · [OG image generation](https://vercel.com/docs/og-image-generation)
- [Next.js JSON-LD guide](https://nextjs.org/docs/app/guides/json-ld) · [generateSitemaps](https://nextjs.org/docs/app/api-reference/functions/generate-sitemaps) · [CSP guide](https://nextjs.org/docs/app/guides/content-security-policy)
- [Core Web Vitals 2026](https://www.corewebvitals.io/core-web-vitals) · [LCP preload guide](https://www.panstag.com/2026/04/how-to-preload-lcp-image.html)
- [AVIF browser support 2026](https://orquitool.com/en/blog/avif-browser-support-2026-compatibility-webp-switch/)
- [Cloudflare Turnstile vs hCaptcha](https://www.websyro.com/blogs/hcaptcha-vs-cloudflare-turnstile-2026-comparison) · [Resend vs Postmark](https://xmit.sh/versus/resend-vs-postmark)
- [Consent Mode v2 (Termly)](https://termly.io/resources/articles/what-is-google-consent-mode-v2/) · [Cookie consent trends 2026](https://secureprivacy.ai/blog/global-cookie-consent-trends-2026)
- [Plausible vs Fathom vs PostHog](https://f3fundit.com/the-solopreneur-analytics-stack-2026-posthog-vs-plausible-vs-fathom-analytics-and-why-you-should-ditch-google-analytics/)

### Competitive / alternatives reality check
- [unframer GitHub](https://github.com/remorses/unframer) · [ConvertFramer](https://convertframer.com/) · [BrowserCat: Migrate Framer to Next.js](https://www.browsercat.com/post/migrate-framer-to-nextjs) · [framer-to-html](https://github.com/shafanaura/framer-to-html)
- [Builder.io pricing](https://www.builder.io/m/pricing) · [Plasmic GitHub](https://github.com/plasmicapp/plasmic) · [TinaCMS](https://tina.io/) · [React Bricks](https://www.reactbricks.com/) · [Storyblok pricing](https://www.storyblok.com/pricing)
- [Webstudio](https://github.com/webstudio-is/webstudio) · [Wagtail 7.1](https://wagtail.org/blog/wagtail-71/) · [Directus visual editor](https://directus.io/toolkit/editor) · [Puck](https://github.com/puckeditor/puck)
- [Payload Visual Editor (enterprise)](https://payloadcms.com/enterprise/visual-editor) · [pemedia/payload-visual-editor](https://github.com/pemedia/payload-visual-editor)
- [Vercel Toolbar Edit Mode](https://vercel.com/docs/edit-mode) · [v0.app docs](https://v0.app/docs)
- [Indie Hackers: "the export button"](https://www.indiehackers.com/post/framer-doesnt-let-you-export-your-own-website-s-code-so-i-built-the-export-button-e44de515c3) · [HackMD: migrating from Framer to React](https://hackmd.io/@micha-roon/SJzI4cmDJx)
