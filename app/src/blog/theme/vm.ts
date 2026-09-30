// View models for the themed templates: what the page components read.
// Built from plain input (PgInput) so the same components render a live site
// (blog/theme/live.ts maps PocketBase records and settings into it) and the
// conformance harness's fixtures (blog/harness/).
//
// Everything a layout needs to stay robust is decided here: fallbacks for
// missing data (a blank title is "Untitled", no author name falls back to the
// site's), content-aware size hints (data-len), and formatted dates, reading
// times and post numbers in the theme's format.

import type { CompiledTheme } from "./compile";

export interface PgLink {
  label: string;
  url: string;
}

export interface PgInput {
  site: { name: string; host: string; lang?: string; tagline?: string | null; manifesto?: string | null };
  author: {
    name?: string | null;
    tagline?: string | null;
    location?: string | null;
    bio?: string | null;
    avatar?: string | null;
    links?: PgLink[] | null;
  };
  collections: { name: string; slug: string; description?: string | null; emoji?: string | null; hidden?: boolean }[];
  /** Published posts; `collection` is the collection's slug. */
  posts: {
    id: string;
    number?: number | null;
    slug: string;
    collection: string;
    title: string;
    subtitle?: string | null;
    excerpt?: string | null;
    date: number | null;
    words?: number | null;
    content: string;
  }[];
}

/** Where things live. The live blog builds these from blog/route.ts; the harness uses hashes. */
export interface PgLinks {
  home: () => string;
  collection: (slug: string) => string;
  post: (collection: string, slug: string) => string;
  author: () => string;
  feed?: () => string | null;
}

export type PgRoute =
  | { tpl: "home" }
  | { tpl: "collection"; collection: string }
  | { tpl: "post"; collection?: string; post: string }
  | { tpl: "author" };

export type Len = "long" | "xlong" | undefined;

export interface VmCollection {
  name: string;
  slug: string;
  description: string | null;
  emoji: string | null;
  hidden: boolean;
  count: number;
  href: string;
}

export interface VmPost {
  id: string;
  slug: string;
  title: string;
  untitled: boolean;
  dek: string | null;
  col: VmCollection;
  content: string;
  words: number | null;
  date: number | null;
  image: { src: string; alt: string } | null;
  titleLen: Len;
  dekLen: Len;
  dateText: string | null;
  dateIso: string | null;
  readText: string | null;
  numberText: string | null;
  year: number | null;
  href: string;
}

export interface VmAuthor {
  displayName: string;
  initial: string;
  nameLen: Len;
  tagline: string | null;
  location: string | null;
  bio: string | null;
  avatar: string | null;
  links: PgLink[];
}

export interface Vm {
  site: { name: string; host: string; lang: string; tagline: string | null; manifesto: string | null; nameLen: Len; logo: string | null };
  author: VmAuthor;
  collections: VmCollection[];
  posts: VmPost[];
  lastUpdate: number | null;
  lastText: string | null;
  links: PgLinks;
  frame: { header: string; footer: string; align: "start" | "center" };
}

/* ---------------------------------------------------------------- formatting */

const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtDate(ms: number | null | undefined, style?: string): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const Y = d.getUTCFullYear(), M = d.getUTCMonth(), D = d.getUTCDate();
  if (style === "iso") return `${Y}-${String(M + 1).padStart(2, "0")}-${String(D).padStart(2, "0")}`;
  if (style === "medium") return `${MONTHS_SHORT[M]} ${D}, ${Y}`;
  return `${D} ${MONTHS_LONG[M]} ${Y}`;
}

export function fmtRead(words: number | null | undefined, style?: string): string | null {
  if (!words || words <= 0) return null;
  const m = Math.max(1, Math.ceil(words / 220));
  if (style === "long") return `${m.toLocaleString("en")} ${m === 1 ? "minute" : "minutes"}`;
  if (style === "min") return `${m.toLocaleString("en")} min`;
  return `${m.toLocaleString("en")} min read`;
}

export function fmtNumber(n: number | null | undefined, pattern?: string): string | null {
  if (!n) return null;
  return (pattern || "No. {n}").replace(/\{n(?::0(\d))?\}/, (_, w?: string) => (w ? String(n).padStart(+w, "0") : String(n)));
}

export function lenOf(s: string | null | undefined, [a, b]: [number, number]): Len {
  const n = [...String(s || "")].length;
  return n > b ? "xlong" : n > a ? "long" : undefined;
}

export function initialOf(s: string | null | undefined): string {
  const str = String(s || "").trim();
  if (!str) return "·";
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    for (const { segment } of seg.segment(str)) return segment.toUpperCase();
  } catch {
    /* old engines */
  }
  return [...str][0].toUpperCase();
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i;

/** The first image in a post's markdown: `![alt](src)`, or a bare link to an image file (older posts). */
export function firstImage(md: string): { src: string; alt: string } | null {
  const m = md.match(/!\[([^\]]*)\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/);
  if (m) return { src: m[2], alt: m[1] };
  const link = md.match(/(?:^|\n)\s*\[([^\]]*)\]\(\s*<?([^\s)>]+)>?\s*\)\s*(?:\n|$)/);
  if (link && IMAGE_EXT.test(link[2])) return { src: link[2], alt: link[1] };
  return null;
}

/** A dek for a post with no subtitle or excerpt: its first plain paragraph, shortened. */
export function firstParagraph(md: string, maxLen = 220): string | null {
  for (const block of (md || "").split(/\n{2,}/)) {
    const t = block.trim();
    if (!t || /^([#`>|]|-{1,3}(\s|$)|\*\s|\d+\.\s|```|\[\^)/.test(t)) continue;
    if (/^!?\[[^\]]*\]\([^)]*\)$/.test(t)) continue;
    const flat = t.replace(/\s+/g, " ").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`\\]/g, "").trim();
    if (!flat) continue;
    return flat.length <= maxLen ? flat : flat.slice(0, maxLen).replace(/\s+\S*$/, "") + "…";
  }
  return null;
}

/* ---------------------------------------------------------------- build */

export function buildVM(input: PgInput, compiled: CompiledTheme, links: PgLinks, headerAlign?: string): Vm {
  const fmt = compiled.format;
  const collections: VmCollection[] = input.collections.map((c) => ({
    name: c.name,
    slug: c.slug,
    description: c.description?.trim() || null,
    emoji: c.emoji || null,
    hidden: !!c.hidden,
    count: 0,
    href: links.collection(c.slug),
  }));
  const bySlug = new Map(collections.map((c) => [c.slug, c]));
  const posts: VmPost[] = [];
  for (const p of input.posts) {
    let col = bySlug.get(p.collection);
    if (col?.hidden) continue; // a private collection's posts are never listed
    if (!col) {
      col = { name: p.collection, slug: p.collection, description: null, emoji: null, hidden: false, count: 0, href: links.collection(p.collection) };
      bySlug.set(col.slug, col);
      collections.push(col);
    }
    const title = (p.title || "").trim() || "Untitled";
    const dek = (p.subtitle || p.excerpt || "").trim() || null;
    posts.push({
      id: p.id,
      slug: p.slug,
      title,
      untitled: !(p.title || "").trim(),
      dek,
      col,
      content: p.content || "",
      words: p.words ?? null,
      date: p.date,
      image: firstImage(p.content || ""),
      titleLen: lenOf(title, [64, 120]),
      dekLen: lenOf(dek, [180, 360]),
      dateText: fmtDate(p.date, fmt.date),
      dateIso: p.date != null && Number.isFinite(p.date) ? new Date(p.date).toISOString().slice(0, 10) : null,
      readText: fmtRead(p.words, fmt.readTime),
      numberText: fmtNumber(p.number, fmt.number),
      year: p.date ? new Date(p.date).getUTCFullYear() : null,
      href: links.post(col.slug, p.slug),
    });
  }
  posts.sort((a, b) => (b.date ?? -Infinity) - (a.date ?? -Infinity));
  for (const p of posts) p.col.count++;
  const a = input.author;
  const name = (a.name || "").trim();
  const author: VmAuthor = {
    displayName: name || input.site.name,
    initial: initialOf(name || input.site.name),
    nameLen: lenOf(name, [28, 60]),
    tagline: a.tagline?.trim() || null,
    location: a.location?.trim() || null,
    bio: a.bio?.trim() || null,
    avatar: a.avatar || null,
    links: (a.links || []).filter((l) => l && l.url && l.label),
  };
  const lastUpdate = posts.find((p) => p.date)?.date ?? null;
  return {
    site: {
      name: input.site.name,
      host: input.site.host,
      lang: input.site.lang || "en",
      tagline: input.site.tagline?.trim() || null,
      manifesto: input.site.manifesto?.trim() || null,
      nameLen: lenOf(input.site.name, [30, 70]),
      logo: compiled.logo,
    },
    author,
    collections: collections.filter((c) => !c.hidden),
    posts,
    lastUpdate,
    lastText: fmtDate(lastUpdate, fmt.date),
    links,
    frame: { header: compiled.attrs["data-header"], footer: compiled.attrs["data-footer"], align: headerAlign === "center" ? "center" : "start" },
  };
}
