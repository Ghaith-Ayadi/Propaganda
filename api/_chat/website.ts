// The tenant's own website, as Chat reads it: one page at a time, only on the
// host in their settings (tenant.website), as text. The Strategist quotes this
// site in its proposals ("their site says"); Chat opens the same pages when
// the operator asks where something came from.

import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
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

/** What one request returns: the body is cut at MAX_BYTES while it streams. */
export interface Fetched {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export type Resolver = (host: string) => Promise<string[]>;

const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 10_000;

let resolveAll: Resolver = async (host) => (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);

// ---- which addresses Chat may connect to ----

/** An IPv4 address as 4 bytes, or null. */
function v4Bytes(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const b = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return b.every((n) => n >= 0 && n <= 255) ? b : null;
}

/** An IPv6 address as 16 bytes (zone and brackets dropped, a dotted tail allowed), or null. */
export function v6Bytes(raw: string): number[] | null {
  let ip = raw.replace(/^\[|\]$/g, "").replace(/%.*$/, "").toLowerCase();
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(ip)?.[1];
  if (tail) {
    const b = v4Bytes(tail);
    if (!b) return null;
    ip = `${ip.slice(0, -tail.length)}${((b[0] << 8) | b[1]).toString(16)}:${((b[2] << 8) | b[3]).toString(16)}`;
  }
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const groups = (h: string) => (h ? h.split(":") : []);
  const head = groups(halves[0]);
  const rest = halves.length === 2 ? groups(halves[1]) : [];
  const missing = 8 - head.length - rest.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const all = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  if (all.length !== 8 || !all.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.flatMap((g) => {
    const n = parseInt(g, 16);
    return [n >> 8, n & 255];
  });
}

/** Public unicast IPv4: not private, shared, loopback, link-local, test, benchmark or multicast space. */
function publicV4([a, b, c]: number[]): boolean {
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // shared (CGNAT)
  if (a === 169 && b === 254) return false; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // IETF, TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3
  return true;
}

/**
 * True only for a public unicast address. IPv6 must be global unicast
 * (2000::/3); forms that embed an IPv4 address (mapped ::ffff:0:0/96, NAT64
 * 64:ff9b::/96, 6to4 2002::/16) are judged by that address, Teredo and
 * documentation space are refused.
 */
export function isPublicAddress(ip: string): boolean {
  const v4 = v4Bytes(ip);
  if (v4) return publicV4(v4);
  const b = v6Bytes(ip);
  if (!b) return false;
  const zero = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  if (zero(0, 10) && b[10] === 0xff && b[11] === 0xff) return publicV4(b.slice(12));
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zero(4, 12)) return publicV4(b.slice(12));
  if (b[0] === 0x20 && b[1] === 0x02) return publicV4(b.slice(2, 6));
  if ((b[0] & 0xe0) !== 0x20) return false; // not 2000::/3
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return false; // documentation
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) return false; // Teredo
  return true;
}

/**
 * The lookup the socket connects through: it resolves once and refuses unless
 * every address is public, so the address checked is the address used (a host
 * can't answer one address to a check and another to the connection).
 */
export function guardedLookup(resolver: Resolver = resolveAll): LookupFunction {
  return (hostname, options, callback) => {
    resolver(hostname).then(
      (addresses) => {
        const bad = addresses.find((a) => !isPublicAddress(a));
        if (!addresses.length || bad) {
          const err = Object.assign(new Error(`not a public address: ${hostname}${bad ? ` (${bad})` : ""}`), { code: "ENOTPUBLIC" });
          return callback(err, "", 0);
        }
        const list = addresses.map((address) => ({ address, family: isIP(address) }));
        if ((options as { all?: boolean }).all) (callback as unknown as (e: null, l: typeof list) => void)(null, list);
        else callback(null, list[0].address, list[0].family);
      },
      (err: NodeJS.ErrnoException) => callback(err, "", 0),
    );
  };
}

/** One GET over the guarded lookup; the body stops at MAX_BYTES. */
function get(url: URL, resolver: Resolver): Promise<Fetched> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  // An address written in the URL never goes through a lookup: check it here.
  if (isIP(host) && !isPublicAddress(host)) return Promise.reject(new Error(`not a public address: ${url.hostname}`));
  return new Promise((resolve, reject) => {
    const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        method: "GET",
        lookup: guardedLookup(resolver),
        headers: { "User-Agent": "PropagandaBot/0.2 (+https://propaganda.pub)", Accept: "text/html,text/plain;q=0.9" },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const done = () => resolve({ status: res.statusCode ?? 0, headers: flat(res.headers), body: Buffer.concat(chunks).toString("utf8") });
        res.on("data", (c: Buffer) => {
          if (size >= MAX_BYTES) return;
          chunks.push(c.subarray(0, MAX_BYTES - size));
          size += c.length;
          if (size >= MAX_BYTES) {
            res.destroy();
            done();
          }
        });
        res.on("end", done);
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    req.end();
  });
}

function flat(h: IncomingHttpHeaders): Record<string, string> {
  return Object.fromEntries(Object.entries(h).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : (v ?? "")]));
}

let transport: (url: URL) => Promise<Fetched> = (url) => get(url, resolveAll);

/** For tests: replace the request, or keep the real one and replace DNS. */
export function setWebsiteTransport(t: ((url: URL) => Promise<Fetched>) | null, r?: Resolver): void {
  if (r) resolveAll = r;
  transport = t ?? ((url) => get(url, resolveAll));
}

/** The tenant's website from their settings, or null. */
export async function websiteOf(token: string, site: string): Promise<string | null> {
  const rows = await asUser(token).get<{ value: unknown }[]>(`/app_settings?select=value&site=${eq(site)}&key=eq.tenant.website`);
  const v = typeof rows[0]?.value === "string" ? rows[0].value.trim() : "";
  if (!v) return null;
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

const bare = (host: string) => host.toLowerCase().replace(/^www\./, "");

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
  if (url.port && url.port !== "80" && url.port !== "443") return "only the standard web ports (80, 443)";
  return url;
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
    let res: Fetched | null = null;
    for (let hop = 0; hop < 4; hop++) {
      res = await transport(url);
      const next = res.status >= 300 && res.status < 400 ? res.headers.location : null;
      if (!next) break;
      const moved = onTheirSite(next, website);
      if (typeof moved === "string") return { ok: false, reason: `the page moves off their site (${moved})` };
      url = moved;
    }
    if (!res || res.status < 200 || res.status >= 300) return { ok: false, reason: `${url.hostname} answered ${res?.status ?? "nothing"}` };
    const type = res.headers["content-type"] ?? "";
    if (!/text\/html|text\/plain|application\/xhtml/.test(type)) return { ok: false, reason: `not a web page (${type || "no type"})` };
    const body = res.body;
    const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1] ?? url.hostname).replace(/\s+/g, " ").trim();
    const text = type.includes("text/plain") ? body.trim() : pageText(body);
    const words = searchWords(query);
    const shown = text.length <= maxChars ? text : words.length ? passage(text, query, words, maxChars) : `${text.slice(0, maxChars)}…`;
    return { ok: true, page: { url: url.toString(), title, text: shown } };
  } catch (err) {
    return { ok: false, reason: `couldn't read ${url.hostname}: ${err instanceof Error ? err.message : String(err)}` };
  }
}
