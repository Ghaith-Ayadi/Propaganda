// The blog renderer on the box: every public page of every site, written as
// files that Caddy serves (docs/blog-server.md, "On the box"). One Node
// process (propaganda-blog in Bedrock's compose/propaganda-supabase, built
// there from this checkout), bundled from this file by app/vite.box.config.ts
// (npm run build:box) with the same components the browser and the Vercel
// function render.
//
// Four rules keep it out of cache trouble:
//   1. A page is stored as a fragment (fill.ts): its markup and head, nothing
//      from the app build. Caddy wraps it in the current shell at serve time,
//      so a deploy of the app invalidates no file. The shell's pieces are
//      refreshed here from the deployment itself (BLOG_SHELL_URL).
//   2. A site is rewritten when its rows change: every tick compares a mark
//      (row count, newest `updated`) of posts, collections, settings and the
//      site row, through PostgREST as the anonymous key, so only published
//      rows are ever read. Files are written whole and renamed into place,
//      then paths the site no longer has are removed.
//   3. A missing file is never an error: Caddy falls through to the
//      on-demand function (api/blog.ts). A sweep every BLOG_SWEEP_HOURS
//      rewrites every site regardless.
//   4. The data decides, not the UI: a publish from the editor, the plugin,
//      a sync or an import all move the marks the same way.
//
// Files, under BLOG_DIR (/srv/blogs):
//   shell/0.html … 4.html, shell/favicon.html   the shell's pieces
//   sites/<host>/index.html                      a fragment (home)
//   sites/<host>/<collection>/index.html         a fragment
//   sites/<host>/<collection>/<slug>/index.html  a fragment
//   sites/<host>/author/index.html               a fragment (themed blogs)
//   sites/<host>/<collection>/<slug>.md          the post as Markdown
//   sites/<host>/sitemap.xml, feed.xml, rss.xml, robots.txt, llms.txt,
//   llms-full.txt, <IndexNow key>.txt            whole files
//   state.json                                   marks, keys and the last sweep
//
// IndexNow: when a site's files change, the addresses that changed are sent
// to api.indexnow.org (Bing, Yandex, Naver, Seznam read it; Google does not),
// with the site's key, served at /<key>.txt. BLOG_INDEXNOW=off turns it off
// (the dev box).
// <host> is the site's canonical host (its domain, else <slug>.<platform>);
// the other host answers 301 from the function.
//
// Env: BLOG_API_URL (else SUPABASE_URL), BLOG_API_KEY (the anonymous key; else
// SUPABASE_ANON_KEY or ANON_KEY, as the stack's .env names it),
// BLOG_PLATFORM_DOMAIN and BLOG_APP_HOST (else the VITE_ names), BLOG_DIR,
// BLOG_SHELL_URL (or BLOG_SHELL_FILE on the dev box), BLOG_POLL_SECONDS (10),
// BLOG_SWEEP_HOURS (24), BLOG_PORT (3030, /health), BLOG_INDEXNOW (off).

import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { collectionSlugOf } from "@/lib/slug";
import type { BlogRoute } from "../route";
import type { BlogSite } from "../siteTypes";
import { allSites, ApiError, dataOf, markOf, type Api, type Mark } from "./api";
import { llmsFullTxt, llmsTxt, postMarkdown, robots, rss, sitemap } from "./feeds";
import { FRAGMENT_SEPARATOR, fragmentOf, shellPieces } from "./fill";
import { isThemed, renderParts, type SiteData } from "./page";
import type { Hosts } from "./urls";

const e = process.env;
const env = {
  apiUrl: e.BLOG_API_URL || e.SUPABASE_URL || (import.meta.env.VITE_SUPABASE_URL as string | undefined) || "",
  apiKey: e.BLOG_API_KEY || e.SUPABASE_ANON_KEY || e.ANON_KEY || (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || "",
  platformDomain: (e.BLOG_PLATFORM_DOMAIN || e.VITE_PLATFORM_DOMAIN || (import.meta.env.VITE_PLATFORM_DOMAIN as string | undefined) || "propaganda.pub").toLowerCase(),
  appHost: (e.BLOG_APP_HOST || e.VITE_APP_HOST || (import.meta.env.VITE_APP_HOST as string | undefined) || "").toLowerCase(),
  dir: process.env.BLOG_DIR || "/srv/blogs",
  shellUrl: process.env.BLOG_SHELL_URL || "",
  shellFile: process.env.BLOG_SHELL_FILE || "",
  pollSeconds: Number(process.env.BLOG_POLL_SECONDS) || 10,
  sweepHours: Number(process.env.BLOG_SWEEP_HOURS) || 24,
  port: Number(process.env.BLOG_PORT) || 3030,
  indexNow: (process.env.BLOG_INDEXNOW || "on").toLowerCase() !== "off",
};

const api: Api = { url: env.apiUrl, key: env.apiKey };
const hosts: Hosts = { platformDomain: env.platformDomain, appHost: env.appHost || `app.${env.platformDomain}` };

/** The tables a site's pages are made of, with the filter that picks its rows. */
const TABLES: Array<[table: string, filter: string]> = [
  ["posts", "status=eq.published"],
  ["collections", ""],
  ["app_settings", ""],
  ["sites", ""],
];

interface SiteState {
  mark: string;
  host: string;
  pages: number;
  renderedAt: string;
  failures?: number;
  retryAt?: string;
}
interface State {
  sweptAt: string | null;
  global: string;
  sites: Record<string, SiteState>;
  /** IndexNow keys, one per host. */
  keys?: Record<string, string>;
  /** The renderer that wrote the files (BUILD): a new one renders every site again. */
  build?: string;
}

/** A fingerprint of the running bundle: the files on disk came from one renderer, and a
 *  new deploy changes what a page contains without any row changing, so it renders all. */
const BUILD = (() => {
  try {
    return createHash("sha256").update(readFileSync(process.argv[1] ?? "")).digest("hex").slice(0, 16);
  } catch {
    return "unknown";
  }
})();

let state: State = { sweptAt: null, global: "", sites: {}, keys: {} };
let shellTag = "";
let lastError = "";
let ticking = false;

const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);
const now = () => new Date().toISOString();

/* ------------------------------------------------------------------ files */

/** Writes the file whole and renames it into place; false when it already held exactly this. */
async function writeAtomic(path: string, body: string): Promise<boolean> {
  await mkdir(dirname(path), { recursive: true });
  const old = await readFile(path, "utf8").catch(() => null);
  if (old === body) return false;
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, body, "utf8");
  await rename(tmp, path);
  return true;
}

/** Every file under dir, relative to it. */
async function filesUnder(dir: string, prefix = ""): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await filesUnder(join(dir, e.name), rel)));
    else out.push(rel);
  }
  return out;
}

/** Removes the files not in keep, then the directories left empty. */
async function prune(dir: string, keep: Set<string>): Promise<number> {
  let removed = 0;
  for (const rel of await filesUnder(dir)) {
    if (keep.has(rel)) continue;
    await rm(join(dir, rel), { force: true });
    removed++;
  }
  // Empty directories, deepest first.
  const dirs = new Set<string>();
  for (const rel of await filesUnder(dir)) {
    let d = dirname(rel);
    while (d !== ".") {
      dirs.add(d);
      d = dirname(d);
    }
  }
  const all = await dirsUnder(dir);
  for (const d of all.sort((a, b) => b.length - a.length)) {
    if (!dirs.has(d)) await rmdir(join(dir, d)).catch(() => {});
  }
  return removed;
}

async function dirsUnder(dir: string, prefix = ""): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    out.push(rel, ...(await dirsUnder(join(dir, e.name), rel)));
  }
  return out;
}

/* ------------------------------------------------------------------ shell */

/** The shell, from the deployment (BLOG_SHELL_URL) or the dev box's build (BLOG_SHELL_FILE); null when unchanged. */
async function fetchShell(): Promise<{ tag: string; html: string } | null> {
  if (env.shellFile) {
    const s = await stat(env.shellFile);
    const tag = `${s.mtimeMs}:${s.size}`;
    return tag === shellTag ? null : { tag, html: await readFile(env.shellFile, "utf8") };
  }
  if (!env.shellUrl) throw new Error("BLOG_SHELL_URL or BLOG_SHELL_FILE is needed");
  const headers: Record<string, string> = { Accept: "text/html" };
  if (shellTag) headers["If-None-Match"] = shellTag;
  const res = await fetch(env.shellUrl, { headers, signal: AbortSignal.timeout(8000), redirect: "manual" });
  if (res.status === 304) return null;
  if (!res.ok) throw new Error(`shell ${env.shellUrl}: ${res.status}`);
  const html = await res.text();
  const tag = res.headers.get("etag") || String(html.length);
  return tag === shellTag ? null : { tag, html };
}

async function refreshShell(): Promise<void> {
  const got = await fetchShell();
  if (!got) return;
  const { pieces, favicon } = shellPieces(got.html); // throws on a page that is not the app's: the old pieces stay
  const dir = join(env.dir, "shell");
  await Promise.all([...pieces.map((p, i) => writeAtomic(join(dir, `${i}.html`), p)), writeAtomic(join(dir, "favicon.html"), favicon)]);
  shellTag = got.tag;
  log(`shell: new pieces (${got.tag})`);
}

/* ------------------------------------------------------------------ marks */

const markString = (marks: Mark[]) => marks.map((m) => `${m.count}@${m.latest ?? "-"}`).join(" ");

async function globalMark(): Promise<string> {
  return markString(await Promise.all(TABLES.map(([t, f]) => markOf(api, t, f))));
}

async function siteMark(site: BlogSite): Promise<string> {
  return markString(
    await Promise.all(TABLES.map(([t, f]) => markOf(api, t, t === "sites" ? `id=eq.${site.id}${f ? `&${f}` : ""}` : `site=eq.${site.id}${f ? `&${f}` : ""}`))),
  );
}

/* ------------------------------------------------------------------ pages */

const hostOf = (site: BlogSite) => (site.domain || `${site.slug}.${env.platformDomain}`).toLowerCase();

/** The routes a site's files answer: the function's 200s, nothing that redirects or 404s. */
function routesOf(data: SiteData): Array<{ route: BlogRoute; file: string }> {
  const { collections, posts, settings } = data;
  const hidden = new Set(collections.filter((c) => c.isHidden).map((c) => c.name));
  const out: Array<{ route: BlogRoute; file: string }> = [{ route: { view: "home" }, file: "index.html" }];
  for (const c of collections) {
    if (hidden.has(c.name)) continue;
    if (!posts.some((p) => p.type === c.name)) continue;
    const slug = c.slug || collectionSlugOf(c.name, collections);
    out.push({ route: { view: "collection", collection: slug }, file: `${slug}/index.html` });
  }
  if (isThemed(settings)) out.push({ route: { view: "author" }, file: "author/index.html" });
  for (const p of posts) {
    if (hidden.has(p.type)) continue;
    const collection = collectionSlugOf(p.type, collections);
    out.push({ route: { view: "post", collection, slug: p.slug }, file: `${collection}/${p.slug}/index.html` });
  }
  return out;
}

/** A path under the site's directory is at most three segments, none empty, `.`, `..` or with a control character. */
function safeFile(file: string): boolean {
  const parts = file.split("/");
  if (parts.length > 3) return false;
  // eslint-disable-next-line no-control-regex
  return parts.every((p) => p !== "" && p !== "." && p !== ".." && !/[\x00-\x1f\x7f]/.test(p) && Buffer.byteLength(p) <= 255);
}

/** The address a site file answers at. */
const urlOfFile = (host: string, file: string) => `https://${host}/${file.replace(/(^|\/)index\.html$/, "")}`;

async function renderSite(site: BlogSite): Promise<{ pages: number; removed: number; changed: string[] }> {
  const data = await dataOf(api, site);
  const host = hostOf(site);
  const dir = join(env.dir, "sites", host);
  const written = new Set<string>();
  const changed: string[] = [];
  const put = async (file: string, body: string) => {
    if (!safeFile(file)) throw new Error(`refusing to write ${file}`);
    if (await writeAtomic(join(dir, file), body)) changed.push(urlOfFile(host, file));
    written.add(file);
  };
  let pages = 0;
  for (const { route, file } of routesOf(data)) {
    const r = renderParts(route, data, hosts);
    if (r.status !== 200) continue;
    const fragment = fragmentOf(r.parts);
    if (fragment.split(FRAGMENT_SEPARATOR).length !== 4) throw new Error(`fragment of ${file} does not split in four`);
    await put(file, fragment);
    pages++;
    if (route.view === "post") await put(file.replace(/\/index\.html$/, ".md"), postMarkdown(data.posts.find((p) => p.slug === route.slug && collectionSlugOf(p.type, data.collections) === route.collection)!, data, hosts));
  }
  await put("sitemap.xml", sitemap(data, hosts));
  const feed = rss(data, hosts);
  await put("feed.xml", feed);
  await put("rss.xml", feed);
  await put("robots.txt", robots(data, hosts));
  await put("llms.txt", llmsTxt(data, hosts));
  await put("llms-full.txt", llmsFullTxt(data, hosts));
  const key = indexNowKey(host);
  await writeAtomic(join(dir, `${key}.txt`), key);
  written.add(`${key}.txt`);
  const removed = await prune(dir, written);
  return { pages, removed, changed };
}

/* --------------------------------------------------------------- IndexNow */

function indexNowKey(host: string): string {
  state.keys ??= {};
  return (state.keys[host] ??= randomBytes(16).toString("hex"));
}

/** Tells IndexNow which of a site's addresses changed (at most 10,000 per call, as it allows). */
async function pingIndexNow(host: string, urls: string[]): Promise<void> {
  if (!env.indexNow || !urls.length) return;
  const key = indexNowKey(host);
  const body = { host, key, keyLocation: `https://${host}/${key}.txt`, urlList: urls.slice(0, 10_000) };
  const res = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok && res.status !== 202) throw new Error(`IndexNow ${res.status}`);
  log(`${host}: IndexNow told of ${urls.length} addresses (${res.status})`);
}

/** Removes the host directories of sites that no longer exist or moved host. */
async function pruneHosts(current: Set<string>): Promise<void> {
  const root = join(env.dir, "sites");
  let entries: string[] = [];
  try {
    entries = await readdir(root);
  } catch {
    return;
  }
  for (const host of entries) {
    if (current.has(host)) continue;
    await rm(join(root, host), { recursive: true, force: true });
    log(`removed ${host}: no site has that host`);
  }
}

/* ------------------------------------------------------------------ loop */

const STATE_FILE = () => join(env.dir, "state.json");

async function loadState(): Promise<void> {
  try {
    state = JSON.parse(await readFile(STATE_FILE(), "utf8")) as State;
  } catch {
    state = { sweptAt: null, global: "", sites: {} };
  }
}
const saveState = () => writeAtomic(STATE_FILE(), JSON.stringify(state, null, 2));

function sweepDue(): boolean {
  if (!state.sweptAt) return true;
  return Date.now() - Date.parse(state.sweptAt) > env.sweepHours * 3600_000;
}

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    await refreshShell().catch((err) => log(`shell: ${(err as Error).message}`));
    const rebuilt = state.build !== BUILD;
    const sweep = sweepDue() || rebuilt;
    if (rebuilt) log(`renderer ${BUILD}: rendering every site again`);
    const global = await globalMark();
    if (!sweep && global === state.global && !Object.values(state.sites).some((s) => s.retryAt)) return;
    const sites = await allSites(api);
    const hostsNow = new Set(sites.map(hostOf));
    for (const site of sites) {
      const mark = await siteMark(site);
      const prev = state.sites[site.id];
      const due = sweep || !prev || prev.mark !== mark || prev.host !== hostOf(site) || (prev.retryAt && Date.parse(prev.retryAt) <= Date.now());
      if (!due) continue;
      try {
        const t0 = Date.now();
        const { pages, removed, changed } = await renderSite(site);
        state.sites[site.id] = { mark, host: hostOf(site), pages, renderedAt: now() };
        log(`${hostOf(site)}: ${pages} pages, ${changed.length} changed, ${removed} removed, ${Date.now() - t0} ms${sweep ? " (sweep)" : ""}`);
        // Not on the first render of a host (every file is new) and not on a sweep that changed nothing.
        if (prev && !sweep) await pingIndexNow(hostOf(site), changed.filter((u) => !/\.(txt|xml)$/.test(u))).catch((err) => log(`${hostOf(site)}: ${(err as Error).message}`));
      } catch (err) {
        const failures = (prev?.failures ?? 0) + 1;
        const wait = Math.min(env.pollSeconds * 2 ** failures, 600) * 1000;
        state.sites[site.id] = { ...(prev ?? { mark: "", host: hostOf(site), pages: 0, renderedAt: "" }), failures, retryAt: new Date(Date.now() + wait).toISOString() };
        lastError = `${hostOf(site)}: ${(err as Error).message}`;
        log(`${hostOf(site)}: failed (${failures}), retry in ${wait / 1000} s: ${(err as Error).message}`);
      }
    }
    for (const id of Object.keys(state.sites)) if (!sites.some((s) => s.id === id)) delete state.sites[id];
    await pruneHosts(hostsNow);
    state.global = global;
    state.build = BUILD;
    if (sweep) state.sweptAt = now();
    await saveState();
  } catch (err) {
    lastError = (err as Error).message;
    log(`tick: ${err instanceof ApiError ? `API ${err.status}` : ""} ${(err as Error).message}`);
  } finally {
    ticking = false;
  }
}

async function main(): Promise<void> {
  if (!env.apiUrl || !env.apiKey) throw new Error("BLOG_API_URL and BLOG_API_KEY are needed");
  await mkdir(join(env.dir, "sites"), { recursive: true });
  await loadState();
  log(`blog renderer: ${env.apiUrl}, files in ${env.dir}, every ${env.pollSeconds} s, sweep every ${env.sweepHours} h`);
  createServer((req, res) => {
    if (req.url === "/health") {
      const body = { ok: true, shell: !!shellTag, sites: Object.keys(state.sites).length, sweptAt: state.sweptAt, lastError };
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body));
    } else res.writeHead(404).end();
  }).listen(env.port);
  await tick();
  setInterval(() => void tick(), env.pollSeconds * 1000);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
