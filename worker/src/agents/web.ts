// The agents' internet: a web search (DataForSEO's Google results, already our
// pick for SEO data, pay per request) and a page reader. Both run as their own
// steps in a workflow, so a restart never searches or fetches twice. A search
// that fails on DataForSEO's side is asked again: by the Pitcher and the Writer
// after durable waits (search.ts), by the Strategist twice within its step.
//
// DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD from the stack's .env. Without them
// searching returns nothing and says so in the log; the agents still work from
// what they were given. Each search goes through the gateway's callPaidApi(),
// so it is charged to the tenant's budget and logged with what DataForSEO
// says it cost, next to the model calls.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { callPaidApi } from "../../../api/_ai/gateway";

export interface SearchHit {
  url: string;
  title: string;
  snippet: string;
  position: number;
}

export interface Page {
  url: string;
  title: string;
  /** Plain text, trimmed to a budget. */
  text: string;
}

type Fetch = typeof fetch;
let fetchImpl: Fetch = (...a) => fetch(...a);

/** For tests. */
export function setWebFetch(f: Fetch): void {
  fetchImpl = f;
}

export function searchConfigured(): boolean {
  return Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
}

export interface SearchOptions {
  /** The tenant the search is charged to. */
  site: string;
  /** What asked, as in the cost log: 'pitcher', 'scout', ... */
  job: string;
  language?: string;
  /** DataForSEO location code; 2840 is the United States. */
  location?: number;
}

/**
 * A search that failed on DataForSEO's side or on the way there: a 5xx or 429,
 * a task status of 50000 and up ("Internal SE Server Error."), a timeout or a
 * dropped connection. Worth asking again; anything else (a bad request, an
 * empty account) is not.
 */
export class SearchUnavailableError extends Error {
  override name = "SearchUnavailableError";
}

/** What DataForSEO said a refused task cost, for the cost log (callPaidApi reads `costUsd`). */
function withCost<E extends Error>(err: E, cost: unknown): E {
  if (typeof cost === "number" && Number.isFinite(cost)) Object.assign(err, { costUsd: cost });
  return err;
}

/** Waits between attempts, in ms. One try plus these. */
const RETRY_AFTER = [2_000, 6_000];
let sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** For tests. */
export function setSearchSleep(f: (ms: number) => Promise<void>): void {
  sleep = f;
}

/**
 * Google's organic results for `query` (top `limit`), for code that runs
 * inside one step (the Strategist's gather). A failure on the provider's side
 * is asked again twice, a few seconds apart; each attempt is its own logged
 * request. After that it throws SearchUnavailableError.
 */
export async function searchWeb(query: string, limit: number, opts: SearchOptions): Promise<SearchHit[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await searchOnce(query, limit, opts);
    } catch (err) {
      if (!(err instanceof SearchUnavailableError) || attempt >= RETRY_AFTER.length) throw err;
      console.warn(`web search "${query.slice(0, 80)}" failed (${err.message}), asking again`);
      await sleep(RETRY_AFTER[attempt]);
    }
  }
}

/**
 * One request, no retries: for workflows, which wait between attempts
 * durably (search.ts) instead of sleeping inside a step.
 */
export async function searchOnce(query: string, limit: number, opts: SearchOptions): Promise<SearchHit[]> {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    console.warn("web search skipped: DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD are not set");
    return [];
  }
  return callPaidApi(
    { site: opts.site, job: opts.job, service: "dataforseo/serp-organic", background: true },
    async () => {
      let res: Response;
      try {
        res = await fetchImpl("https://api.dataforseo.com/v3/serp/google/organic/live/regular", {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify([
            {
              keyword: query.slice(0, 700),
              language_code: opts.language ?? "en",
              location_code: opts.location ?? 2840,
              depth: Math.max(10, limit),
            },
          ]),
          signal: AbortSignal.timeout(30_000),
        });
      } catch (err) {
        throw new SearchUnavailableError(`web search didn't answer: ${(err as Error).message}`);
      }
      if (!res.ok) {
        const msg = `web search answered ${res.status}`;
        throw res.status >= 500 || res.status === 429 ? new SearchUnavailableError(msg) : new Error(msg);
      }
      const body = (await res.json()) as {
        cost?: number;
        tasks?: { cost?: number; status_code?: number; status_message?: string; result?: { items?: Record<string, unknown>[] }[] }[];
      };
      const task = body.tasks?.[0];
      if (!task || (task.status_code && task.status_code >= 40000)) {
        const msg = `web search failed: ${task?.status_message ?? "no task"}`;
        // DataForSEO reports "Internal SE Server Error." under more than one code: that is its side, so ask again.
        const err = !task || (task.status_code ?? 0) >= 50000 || /internal.*error/i.test(task.status_message ?? "") ? new SearchUnavailableError(msg) : new Error(msg);
        throw withCost(err, body.cost ?? task?.cost);
      }
      const items = task.result?.[0]?.items ?? [];
      const value = items
        .filter((i) => i.type === "organic" && typeof i.url === "string")
        .slice(0, limit)
        .map((i) => ({
          url: String(i.url),
          title: String(i.title ?? ""),
          snippet: String(i.description ?? ""),
          position: Number(i.rank_absolute ?? i.rank_group ?? 0),
        }));
      return { value, costUsd: Number(body.cost ?? task.cost ?? 0) };
    },
  );
}

// ---- reading a page ----

const MAX_BYTES = 2_000_000;

function privateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80")) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    return mapped ? privateAddress(mapped[1]) : false;
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

/** Refuses anything but http(s) on a public address: the worker sits next to the database. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`not a URL: ${raw}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`not http(s): ${raw}`);
  if (url.username || url.password) throw new Error("URLs with credentials are not fetched");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (addresses.length === 0 || addresses.some(privateAddress)) throw new Error(`not a public address: ${url.hostname}`);
  return url;
}

/** Fetches a page and returns its readable text (at most `maxChars`). Follows up to 4 redirects, each checked. */
export async function readPage(raw: string, maxChars = 12_000): Promise<Page> {
  return (await readPageWithHtml(raw, maxChars)).page;
}

/** readPage plus the raw HTML, for the links a site's home page carries. */
async function readPageWithHtml(raw: string, maxChars: number): Promise<{ page: Page; html: string }> {
  let url = await assertPublicUrl(raw);
  let res: Response | null = null;
  for (let hop = 0; hop < 5; hop++) {
    res = await fetchImpl(url, {
      redirect: "manual",
      headers: { "User-Agent": "PropagandaBot/0.2 (+https://propaganda.pub)", Accept: "text/html,text/plain;q=0.9,*/*;q=0.5" },
      signal: AbortSignal.timeout(20_000),
    });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!next) break;
    url = await assertPublicUrl(new URL(next, url).toString());
  }
  if (!res || !res.ok) throw new Error(`${url.hostname} answered ${res?.status ?? "nothing"}`);
  const type = res.headers.get("content-type") ?? "";
  if (!/text\/html|text\/plain|application\/xhtml/.test(type)) throw new Error(`not a text page (${type || "no type"})`);
  const body = (await res.text()).slice(0, MAX_BYTES);
  if (type.includes("text/plain")) return { page: { url: url.toString(), title: url.hostname, text: tidy(body).slice(0, maxChars) }, html: "" };
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1] ?? url.hostname).trim();
  return { page: { url: url.toString(), title, text: htmlToText(body).slice(0, maxChars) }, html: body };
}

/**
 * Good enough for reading: the main text, paragraphs kept, scripts and chrome
 * dropped. Decoration goes too: anything hidden from assistive tech
 * (aria-hidden, role img/presentation), figures, pictures, and elements whose
 * class or id says they are an illustration, a mockup, a screenshot or a
 * testimonial. Those are what a page *shows*, written as HTML; read as text
 * they become the company's words (propaganda.pub's demo of a fictional
 * company was 68% of what the Strategist read as "their website", 2026-10-12).
 * Headings keep their level as Markdown (`## Why`), so a model sees a heading
 * where a reader does, instead of a bare sentence standing alone.
 */
export function htmlToText(html: string): string {
  let h = html.replace(/<!--[\s\S]*?-->/g, " ");
  h = h.replace(/<(script|style|noscript|svg|nav|footer|header|aside|form|iframe|template|dialog|select|picture|figure)\b[\s\S]*?<\/\1>/gi, " ");
  h = dropDecoration(h);
  const main = /<(article|main)\b[\s\S]*?<\/\1>/i.exec(h)?.[0];
  if (main && main.length > 500) h = main;
  h = h.replace(/<h([1-6])\b[^>]*>/gi, (_, n) => `\n${"#".repeat(Number(n))} `);
  h = h.replace(/<\/(p|div|section|li|h[1-6]|tr|blockquote|pre)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n");
  h = h.replace(/<li\b[^>]*>/gi, "- ");
  h = h.replace(/<[^>]+>/g, " ");
  return tidy(decode(h));
}

/** An opening tag whose attributes mark the element as decoration. */
const DECORATION = /\baria-hidden\s*=\s*["']?true|\brole\s*=\s*["']?(img|presentation|none)\b|\b(class|id|data-slot|data-role)\s*=\s*["'][^"']*\b(illo|illustration|mockup|mock-ui|screenshot|testimonials?|logo-wall|logos|marquee)\b/i;

/**
 * Removes every element marked as decoration together with its subtree. A
 * regex can't match a balanced element, so this walks the tags and counts
 * depth per element name; void elements (img, br, input...) have no subtree.
 */
export function dropDecoration(html: string): string {
  const open = /<([a-zA-Z][\w:-]*)\b([^>]*)>/g;
  let out = "";
  let at = 0;
  let m: RegExpExecArray | null;
  while ((m = open.exec(html))) {
    const [tag, name, attrs] = m;
    if (!DECORATION.test(attrs)) continue;
    const lower = name.toLowerCase();
    const start = m.index;
    let end = start + tag.length;
    if (!VOID.has(lower) && !tag.endsWith("/>")) {
      const same = new RegExp(`<(/?)${lower}\\b[^>]*>`, "gi");
      same.lastIndex = end;
      let depth = 1;
      let t: RegExpExecArray | null;
      while (depth > 0 && (t = same.exec(html))) {
        depth += t[1] ? -1 : 1;
        end = t.index + t[0].length;
      }
      if (depth > 0) end = html.length;
    }
    out += html.slice(at, start) + " ";
    at = end;
    open.lastIndex = end;
  }
  return out + html.slice(at);
}

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

// ---- reading a whole site ----

export interface SiteClaim {
  /** A sentence as it appears on the site, trimmed of whitespace and trailing punctuation. */
  text: string;
  /** How many times it appears across the pages read: layout, not priority. */
  count: number;
}

export interface SiteRead {
  pages: Page[];
  /** The site's sentences, deduplicated, most repeated first. */
  claims: SiteClaim[];
  /** Pages tried and not read, with why. */
  skipped: { url: string; reason: string }[];
}

/** Paths that are never about what the company sells or believes. */
const SKIP_PATH = /^\/(blog|news|changelog|docs?|help|support|legal|privacy|terms|policies|security|careers|jobs|contact|login|log-in|signin|sign-in|signup|sign-up|register|download|status|press|events|cookies?|sitemap|search|app|admin|account|cdn-cgi)(\/|$)|\.(pdf|zip|xml|json|png|jpe?g|svg|webp)$/i;

/** The four pages read before 2026-10-12, tried when the home page links to nothing readable. */
const FALLBACK_PATHS = ["/pricing", "/about", "/product"];

/**
 * The home page's links, as the site's own menu ranks them: a path linked
 * from several places (nav and footer) comes first, then shorter paths. Same
 * host only, at most two path segments, none of the SKIP_PATH kinds.
 */
export function sitePaths(homeHtml: string, base: URL, limit: number): string[] {
  const counts = new Map<string, number>();
  for (const m of homeHtml.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#?]+)[^"']*["']/gi)) {
    let u: URL;
    try {
      u = new URL(decode(m[1]), base);
    } catch {
      continue;
    }
    if (u.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) continue;
    const path = u.pathname.replace(/\/+$/, "") || "/";
    if (path === "/" || path.split("/").length > 3 || SKIP_PATH.test(path)) continue;
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([p]) => p);
}

/**
 * Reads a company's website the way a visitor skims it: the home page, then
 * the pages its own menu points at (`limit` of them, `pageChars` each), with
 * decoration dropped and headings kept. Also returns the site's sentences
 * with their repetition counts, so a model can be told that a sentence
 * repeated five times is layout, not the company's priority.
 */
export async function readSite(website: string, opts: { homeChars?: number; pageChars?: number; limit?: number } = {}): Promise<SiteRead> {
  const { homeChars = 8_000, pageChars = 3_000, limit = 6 } = opts;
  const base = new URL(/^https?:\/\//.test(website) ? website : `https://${website}`);
  const out: SiteRead = { pages: [], claims: [], skipped: [] };
  let home: { page: Page; html: string };
  try {
    home = await readPageWithHtml(base.toString(), homeChars);
  } catch (err) {
    out.skipped.push({ url: base.toString(), reason: (err as Error).message });
    return out;
  }
  if (home.page.text.trim()) out.pages.push(home.page);
  const paths = sitePaths(home.html, base, limit);
  const seen = new Set([new URL(home.page.url).pathname.replace(/\/+$/, "") || "/"]);
  for (const path of paths.length ? paths : FALLBACK_PATHS) {
    if (seen.has(path)) continue;
    seen.add(path);
    const url = new URL(path, base).toString();
    try {
      const p = await readPage(url, pageChars);
      if (p.text.trim()) out.pages.push(p);
      else out.skipped.push({ url, reason: "no text" });
    } catch (err) {
      out.skipped.push({ url, reason: (err as Error).message });
    }
  }
  out.claims = siteClaims(out.pages.map((p) => p.text));
  return out;
}

/**
 * Every sentence of the texts, deduplicated after trimming whitespace and
 * trailing punctuation, with how often it appears; most repeated first, then
 * in page order. Headings count as sentences; menu items and prices (under
 * 20 characters, no letters, or over 300) don't.
 */
export function siteClaims(texts: string[], limit = 120): SiteClaim[] {
  const counts = new Map<string, { text: string; count: number; order: number }>();
  let order = 0;
  for (const text of texts) {
    for (const line of text.split("\n")) {
      for (const raw of line.replace(/^(#+|-)\s+/, "").split(/(?<=[.!?])\s+(?=[A-Z"“(])/)) {
        const s = raw.trim().replace(/[\s.!?:;,]+$/, "");
        if (s.length < 20 || s.length > 300 || !/[a-z]{3}/i.test(s)) continue;
        const key = s.toLowerCase();
        const row = counts.get(key);
        if (row) row.count++;
        else counts.set(key, { text: s, count: 1, order: order++ });
      }
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.order - b.order)
    .slice(0, limit)
    .map(({ text, count }) => ({ text, count }));
}

function tidy(s: string): string {
  return s
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decode(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
