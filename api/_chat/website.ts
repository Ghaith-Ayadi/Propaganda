// The tenant's own website, as Chat reads it: one page at a time, only on the
// host in their settings (tenant.website), as text. The Strategist quotes this
// site in its proposals ("their site says"); Chat opens the same pages when
// the operator asks where something came from.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { asUser, eq } from "./db.js";
import { passage, searchWords } from "./lookups.js";

export interface WebsitePage {
  url: string;
  title: string;
  text: string;
}

export type WebsiteResult =
  | { ok: true; page: WebsitePage }
  | { ok: false; reason: string };

type Fetch = typeof fetch;
let fetchImpl: Fetch = (input, init) => fetch(input, init);
let resolve = async (host: string) => (await lookup(host, { all: true })).map((a) => a.address);

/** For tests. */
export function setWebsiteFetch(f: Fetch, r?: (host: string) => Promise<string[]>): void {
  fetchImpl = f;
  if (r) resolve = r;
}

const MAX_BYTES = 2_000_000;

/** The tenant's website from their settings, or null. */
export async function websiteOf(token: string, site: string): Promise<string | null> {
  const rows = await asUser(token).get<{ value: unknown }[]>(`/app_settings?select=value&site=${eq(site)}&key=eq.tenant.website`);
  const v = typeof rows[0]?.value === "string" ? rows[0].value.trim() : "";
  if (!v) return null;
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

const bare = (host: string) => host.toLowerCase().replace(/^www\./, "");

function privateAddress(ip: string): boolean {
  if (ip.includes(":")) {
    const l = ip.toLowerCase();
    if (l === "::1" || l === "::" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80")) return true;
    const v4 = /::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(l)?.[1];
    return v4 ? privateAddress(v4) : false;
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** `raw` as a URL on the tenant's host (a path is taken relative to their site), or why not. */
export function onTheirSite(raw: string, website: string): URL | string {
  let base: URL;
  try {
    base = new URL(website);
  } catch {
    return "their website setting isn't a valid address";
  }
  let url: URL;
  try {
    url = new URL(raw || "/", base);
  } catch {
    return `not an address: ${raw}`;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "only web pages";
  if (url.username || url.password) return "addresses with credentials are not read";
  if (bare(url.hostname) !== bare(base.hostname)) return `only pages on ${base.hostname} (their website)`;
  return url;
}

async function assertPublic(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : await resolve(host);
  if (!addresses.length || addresses.some(privateAddress)) throw new Error(`not a public address: ${url.hostname}`);
}

function decode(h: string): string {
  return h
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&mdash;|&ndash;/g, "-")
    .replace(/&middot;/g, "·")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

/** Readable text: scripts, styles and site chrome dropped, headings kept as Markdown. */
export function pageText(html: string): string {
  let h = html.replace(/<!--[\s\S]*?-->/g, " ");
  h = h.replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe|template)\b[\s\S]*?<\/\1>/gi, " ");
  h = h.replace(/<h([1-6])\b[^>]*>/gi, (_, n) => `\n${"#".repeat(Number(n))} `);
  h = h.replace(/<\/(p|div|section|li|h[1-6]|tr|blockquote|pre|article)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n");
  h = h.replace(/<li\b[^>]*>/gi, "- ").replace(/<[^>]+>/g, " ");
  h = decode(h);
  return h
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * One page of the tenant's website as text: around `query` when it is on the
 * page, else from the top. Follows up to 3 redirects that stay on their host.
 */
export async function readWebsite(token: string, site: string, raw: string, query = "", maxChars = 5_000): Promise<WebsiteResult> {
  const website = await websiteOf(token, site);
  if (!website) return { ok: false, reason: "no website is set for them (Settings)" };
  let url = onTheirSite(raw, website);
  if (typeof url === "string") return { ok: false, reason: url };
  try {
    let res: Response | null = null;
    for (let hop = 0; hop < 4; hop++) {
      await assertPublic(url);
      res = await fetchImpl(url, {
        redirect: "manual",
        headers: { "User-Agent": "PropagandaBot/0.2 (+https://propaganda.pub)", Accept: "text/html,text/plain;q=0.9" },
        signal: AbortSignal.timeout(10_000),
      });
      const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!next) break;
      const moved = onTheirSite(next, website);
      if (typeof moved === "string") return { ok: false, reason: `the page moves off their site (${moved})` };
      url = moved;
    }
    if (!res || !res.ok) return { ok: false, reason: `${url.hostname} answered ${res?.status ?? "nothing"}` };
    const type = res.headers.get("content-type") ?? "";
    if (!/text\/html|text\/plain|application\/xhtml/.test(type)) return { ok: false, reason: `not a web page (${type || "no type"})` };
    const body = (await res.text()).slice(0, MAX_BYTES);
    const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1] ?? url.hostname).replace(/\s+/g, " ").trim();
    const text = type.includes("text/plain") ? body.trim() : pageText(body);
    const words = searchWords(query);
    const shown = text.length <= maxChars ? text : words.length ? passage(text, query, words, maxChars) : `${text.slice(0, maxChars)}…`;
    return { ok: true, page: { url: url.toString(), title, text: shown } };
  } catch (err) {
    return { ok: false, reason: `couldn't read ${url.hostname}: ${err instanceof Error ? err.message : String(err)}` };
  }
}
