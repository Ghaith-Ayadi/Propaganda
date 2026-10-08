// The Scout's reads and writes in the app's database. It connects as
// propaganda_scout (worker/sql/scout.draft.sql), a role that can write the
// Scout's own tables and nothing else: a bug here can't touch a post.

import pg from "pg";
import { config } from "../config.js";
import type { PageLink } from "./pages.js";

let pool: pg.Pool | null = null;

export function scoutDb(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: config.appDatabaseUrl, max: 2, options: "-c role=propaganda_scout" });
    pool.on("error", (err) => console.error("scout database:", err.message));
  }
  return pool;
}

export async function closeScoutDb(): Promise<void> {
  await pool?.end();
  pool = null;
}

export interface TargetSearch {
  query: string;
  prompt: string;
  topic: string;
  locationCode: number;
  languageCode: string;
}

export interface WatchedSite {
  id: string;
  url: string;
  topic: string;
  why: string;
  lastItems: PageLink[] | null;
}

export interface Plan {
  site: string;
  name: string;
  /** The tenant's own domains: a result on any of them (or a subdomain) is "us". */
  domains: string[];
  quarter: string;
  searches: TargetSearch[];
  watched: WatchedSite[];
  /** The focus topics: from the searches and the watched sites, in that order. */
  topics: string[];
}

/** '2026-Q4' for a day 'YYYY-MM-DD'. */
export function quarterOf(day: string): string {
  const [y, m] = day.split("-").map(Number) as [number, number];
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
}

/**
 * The tenant's domains: the custom host, its parent (blog.kontra.run counts
 * kontra.run too, the company's own site), and the propaganda.pub subdomain.
 */
export function domainsOf(slug: string, domain: string): string[] {
  const out = new Set<string>([`${slug}.propaganda.pub`]);
  const d = domain.trim().toLowerCase().replace(/^www\./, "");
  if (d) {
    out.add(d);
    const labels = d.split(".");
    // Not for two-part public suffixes like co.uk: three labels there is the registrable name.
    if (labels.length >= 3 && !/^(co|com|org|net|ac|gov)\.[a-z]{2}$/.test(labels.slice(-2).join("."))) {
      out.add(labels.slice(1).join("."));
    }
  }
  return [...out];
}

export function isOurs(domains: string[], host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  return domains.some((d) => h === d || h.endsWith(`.${d}`));
}

/** Tenants with something to follow this quarter. */
export async function tenantsToScout(day: string): Promise<string[]> {
  const { rows } = await scoutDb().query<{ site: string }>(
    `select site from public.scout_searches where active and quarter = $1
     union
     select site from public.watched_sites where active
     order by 1`,
    [quarterOf(day)],
  );
  return rows.map((r) => r.site);
}

export async function readPlan(site: string, day: string): Promise<Plan | null> {
  const db = scoutDb();
  const quarter = quarterOf(day);
  const s = await db.query<{ name: string; slug: string; domain: string }>(
    "select name, slug, domain from public.sites where id = $1",
    [site],
  );
  if (!s.rows[0]) return null;
  const searches = await db.query<{ query: string; prompt: string; topic: string; location_code: number; language_code: string }>(
    `select query, prompt, topic, location_code, language_code from public.scout_searches
     where site = $1 and quarter = $2 and active order by created limit 10`,
    [site, quarter],
  );
  const watched = await db.query<{ id: string; url: string; topic: string; why: string; last_items: PageLink[] | null }>(
    "select id, url, topic, why, last_items from public.watched_sites where site = $1 and active order by created limit 20",
    [site],
  );
  const topics = [...new Set([...searches.rows.map((r) => r.topic), ...watched.rows.map((r) => r.topic)].filter(Boolean))];
  return {
    site,
    name: s.rows[0].name,
    domains: domainsOf(s.rows[0].slug, s.rows[0].domain),
    quarter,
    searches: searches.rows.map((r) => ({
      query: r.query,
      prompt: r.prompt || r.query,
      topic: r.topic,
      locationCode: r.location_code,
      languageCode: r.language_code,
    })),
    watched: watched.rows.map((r) => ({ id: r.id, url: r.url, topic: r.topic, why: r.why, lastItems: r.last_items })),
    topics: topics.slice(0, 6),
  };
}

/** Of these links, the ones the Scout hasn't looked at before for this tenant. */
export async function unseen(site: string, urls: string[]): Promise<string[]> {
  if (urls.length === 0) return [];
  const { rows } = await scoutDb().query<{ url: string }>(
    "select url from public.scout_seen where site = $1 and url = any($2::text[])",
    [site, urls],
  );
  const seen = new Set(rows.map((r) => r.url));
  return urls.filter((u) => !seen.has(u));
}

export interface Evidence {
  url: string;
  title: string;
  published?: string;
  volume?: number;
  position?: number | null;
}

export interface Finding {
  kind: "search" | "ai" | "news" | "watched" | "reddit";
  title: string;
  why: string;
  topic: string;
  evidence: Evidence[];
  expiresAt: string | null;
  /** For a search gap: the target search it's about. */
  targetSearch?: string;
  dedupeKey: string;
}

export interface Snapshot {
  id: string;
  items: PageLink[] | null;
  error: string | null;
}

export interface DayWrite {
  site: string;
  day: string;
  facts: { kind: string; value: unknown }[];
  snapshots: Snapshot[];
  seen: string[];
}

/** The day's facts, page snapshots and seen links, in one transaction. (Ideas go to the Pitcher: agents/ideas.ts.) */
export async function saveDay(w: DayWrite): Promise<void> {
  const c = await scoutDb().connect();
  try {
    await c.query("begin");
    for (const fact of w.facts) {
      await c.query(
        `insert into public.daily_facts (site, day, kind, value) values ($1, $2, $3, $4)
         on conflict (site, day, kind) do update set value = excluded.value, updated = now()`,
        [w.site, w.day, fact.kind, JSON.stringify(fact.value)],
      );
    }
    for (const s of w.snapshots) {
      // A failed check keeps the last good links, so the next one still compares.
      await c.query(
        `update public.watched_sites set last_checked_at = now(), last_error = $3,
           last_items = coalesce($2::jsonb, last_items)
         where id = $1 and site = $4`,
        [s.id, s.items ? JSON.stringify(s.items) : null, s.error?.slice(0, 1000) ?? null, w.site],
      );
    }
    if (w.seen.length) {
      await c.query(
        `insert into public.scout_seen (site, url, first_seen)
         select $1, u, $2 from unnest($3::text[]) as u where char_length(u) <= 2000
         on conflict do nothing`,
        [w.site, w.day, w.seen],
      );
    }
    await c.query("commit");
  } catch (err) {
    await c.query("rollback").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}
