// Watched sites: read a page, keep its links, and tell what's new since the
// last check. A regulator's news page or a competitor's blog index changes by
// gaining links, so the links are what the Scout compares; it never stores the
// page itself.
//
// The worker sits on the box's internal network next to the database, so a
// page is only fetched from a public address: every hop of a redirect is
// checked, and private, loopback and link-local addresses are refused.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface PageLink {
  url: string;
  text: string;
}

const MAX_BYTES = 3 * 1024 * 1024;
const MAX_LINKS = 300;
const USER_AGENT = "PropagandaScout/0.2 (+https://propaganda.pub)";

export class PageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PageError";
  }
}

function privateV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return (
    a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  );
}

/** True for an address the worker must never fetch from. */
export function privateAddress(ip: string): boolean {
  if (isIP(ip) === 4) return privateV4(ip);
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return privateV4(v6.slice(7));
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe8") ||
    v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb") || v6.startsWith("ff");
}

/** Tests fetch from a local server. */
const allowPrivate = () => process.env.SCOUT_ALLOW_PRIVATE_FETCH === "1";

async function assertPublic(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new PageError(`Not a web address: ${url.protocol}`);
  if (allowPrivate()) return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (addrs.length === 0) throw new PageError(`Can't resolve ${host}`);
  if (addrs.some((a) => privateAddress(a.address))) throw new PageError(`${host} is not a public address`);
}

/** The page's HTML, following at most 3 redirects, each checked. */
export async function fetchPage(address: string): Promise<{ url: string; html: string }> {
  let url = new URL(address);
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(url);
    const res = await fetch(url, {
      redirect: "manual",
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (!res.ok) throw new PageError(`${url.host} answered ${res.status}`);
    const type = res.headers.get("content-type") ?? "";
    if (type && !/html|xml/i.test(type)) throw new PageError(`Not a web page (${type.split(";")[0]})`);
    const reader = res.body?.getReader();
    if (!reader) return { url: url.href, html: "" };
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    return { url: url.href, html: Buffer.concat(chunks).toString("utf8") };
  }
  throw new PageError("Too many redirects");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/**
 * The page's content links: absolute http(s), same order as the page, one per
 * address, with text long enough to be a headline (menus and "Read more" are
 * dropped). Scripts, styles, nav, header and footer are skipped.
 */
export function extractLinks(html: string, base: string): PageLink[] {
  const body = html
    .replace(/<(script|style|noscript|svg|nav|header|footer)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const seen = new Set<string>();
  const out: PageLink[] = [];
  const re = /<a\b[^>]*?\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  for (let m; (m = re.exec(body)) && out.length < MAX_LINKS; ) {
    const href = decode((m[2] ?? m[3] ?? m[4] ?? "").trim());
    const text = decode(m[5]!.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (text.length < 20 || text.length > 300) continue;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    url.hash = "";
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    out.push({ url: url.href, text });
  }
  return out;
}

/** Links on the page now that weren't there last time. The first check has none: it's the baseline. */
export function newLinks(previous: PageLink[] | null, current: PageLink[]): PageLink[] {
  if (previous === null) return [];
  const before = new Set(previous.map((l) => l.url));
  return current.filter((l) => !before.has(l.url));
}
