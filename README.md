# Propaganda

Multi-tenant blogging platform. Currently runs a single tenant: **Verbatim** ([verbatim-rho.vercel.app](https://verbatim-rho.vercel.app)), which is the daily driver and acts as the testbed.

The multi-tenant work is the medium-term direction. The current PRD is being rewritten from scratch. Old PRDs are preserved in [docs/archive/](docs/archive/) for reference, not authority.

## Stack

Vite + React 19 + TanStack Router/Query, BlockNote editor on TipTap, Dexie (IndexedDB) as the source-of-truth UI store, Supabase (Postgres + Storage) for cloud sync, Vercel for hosting.

**Infra constraint:** minimize providers. Vercel + Supabase is the entire stack target — adding a third provider needs justification. Specifically: no Next.js (we keep Vite even when hosted on Vercel).

## Layout

| Path | What |
|---|---|
| `app/` | Editor SPA |
| `blog/` | Public blog renderer (Next.js, marked for replacement) |
| `api/` | Vercel functions |
| `mcp-server/` | Standalone MCP package for agent integration |
| `scripts/` | Maintenance and migration scripts |
| `docs/` | Docs, screenshots |
| `docs/archive/` | Old planning artifacts |

## Tenant model

In the multi-tenant build, Verbatim becomes a tenant row — content + brand + domain + theme overrides as data, not code. The platform code lives here; tenants live in the database.

Today the codebase hardcodes the single-tenant assumption in most places. Discipline going forward: every new feature decision passes the "would this still work with 100 tenants?" check. If the answer requires a tenant column, fine. If it only works because it's one user, log it in PPG as known debt to repay at promotion time.

## Known migration debt

- **`blog/` is Next.js** — has to be replaced (still Vercel-hostable, just not Next.js). Schedule with the platform migration.
- **Notion migration code** in `scripts/` is Verbatim-specific seed import. Long-term it becomes a tenant migration plugin.

## Work tracking

Active issues in Plane project **Propaganda (PPG)**. Historical issues in the archived **Verbatim (VST)** project.

---

© Ghaith Ayadi. Personal IP.
