// What the Chat agent can read, always as the person asking (their rights,
// their site). The knowledge base is searched, never loaded whole: a question
// pulls the dozen nearest claims (public.kb_search, keyword and meaning merged).

import { BackendError, asUser, eq } from "./db";

export interface ClaimHit {
  id: string;
  text: string;
  status: "settled" | "contested";
  topics: string[];
}

export type KbResult = { available: true; claims: ClaimHit[] } | { available: false };

export async function searchKnowledge(token: string, site: string, query: string, limit = 12): Promise<KbResult> {
  try {
    const claims = await asUser(token).post<ClaimHit[]>(
      "/rpc/kb_search",
      { p_site: site, p_query: query, p_limit: limit },
      "return=representation",
    );
    return { available: true, claims: claims ?? [] };
  } catch (err) {
    // Not deployed yet (the Guardian's schema lands separately): say so, don't fail the reply.
    if (err instanceof BackendError && (err.status === 404 || err.status === 400)) return { available: false };
    throw err;
  }
}

export interface PostHit {
  id: string;
  title: string;
  status: string;
  collection: string;
  publishedAt: string | null;
  /** A few lines around the first match. */
  excerpt: string;
}

interface PostRow {
  id: string;
  title: string;
  status: string;
  type: string;
  published_at: string | null;
  excerpt: string;
  content_md: string;
}

/** Words worth searching for: PostgREST's filter syntax only ever sees letters, digits and hyphens. */
export function searchWords(query: string): string[] {
  const words = (query.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]*/gu) ?? []).filter((w) => w.length >= 3);
  return [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, 6);
}

function snippet(content: string, words: string[], size = 320): string {
  const lower = content.toLowerCase();
  const at = Math.min(...words.map((w) => lower.indexOf(w)).filter((i) => i >= 0), Number.MAX_SAFE_INTEGER);
  const start = at === Number.MAX_SAFE_INTEGER ? 0 : Math.max(0, at - size / 3);
  const s = content.slice(start, start + size).replace(/\s+/g, " ").trim();
  return (start > 0 ? "…" : "") + s + (start + size < content.length ? "…" : "");
}

export async function searchPosts(token: string, site: string, query: string, limit = 6): Promise<PostHit[]> {
  const words = searchWords(query);
  if (!words.length) return [];
  const or = words.flatMap((w) => [`title.ilike.*${w}*`, `content_md.ilike.*${w}*`]).join(",");
  const rows = await asUser(token).get<PostRow[]>(
    `/posts?select=id,title,status,type,published_at,excerpt,content_md&site=${eq(site)}` +
      `&or=(${encodeURIComponent(or)})&order=updated.desc&limit=40`,
  );
  // Rank by how many of the words each post has, title hits counting double.
  const score = (r: PostRow) =>
    words.reduce((s, w) => s + (r.title.toLowerCase().includes(w) ? 2 : 0) + (r.content_md.toLowerCase().includes(w) ? 1 : 0), 0);
  return rows
    .map((r) => ({ r, s: score(r) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(({ r }) => ({
      id: r.id,
      title: r.title || "Untitled",
      status: r.status || "draft",
      collection: r.type,
      publishedAt: r.published_at,
      excerpt: snippet(r.content_md || r.excerpt, words),
    }));
}

export async function siteName(token: string, site: string): Promise<string> {
  const [row] = await asUser(token).get<{ name: string }[]>(`/sites?select=name&id=${eq(site)}`);
  return row?.name ?? "this tenant";
}

/** Proposes a statement to the Guardian (public.kb_remember opens the proposal; only the Guardian admits it). */
export async function remember(token: string, site: string, statement: string): Promise<{ available: boolean; proposal?: string }> {
  try {
    const proposal = await asUser(token).post<string>(
      "/rpc/kb_remember",
      { p_site: site, p_text: statement },
      "return=representation",
    );
    return { available: true, proposal };
  } catch (err) {
    if (err instanceof BackendError && err.status === 404) return { available: false };
    throw err;
  }
}

interface GoalVersionRow {
  quarter: string;
  version: number;
  targets: {
    volume?: { total?: number; topics?: { name: string; low: number; high: number }[] };
    ranking?: { searches?: { query: string; topic: string }[]; pageOneTarget?: number };
  } | null;
}

/**
 * The tenant's approved goals for the newest quarter, and whether a proposal
 * from the Strategist is being written or waits on approval: what Chat reads
 * before it answers "what should we write" or asks the Strategist for anything.
 */
export async function readGoals(token: string, site: string): Promise<string> {
  const db = asUser(token);
  const [versions, proposals] = await Promise.all([
    db.get<GoalVersionRow[]>(`/goal_versions?select=quarter,version,targets&site=${eq(site)}&order=quarter.desc,version.desc&limit=1`),
    db.get<{ quarter: string; status: string }[]>(`/strategy_proposals?select=quarter,status&site=${eq(site)}&status=in.(requested,running,sent)`),
  ]);
  const lines: string[] = [];
  const v = versions[0];
  if (v) {
    const vol = v.targets?.volume;
    lines.push(`Approved goals for ${v.quarter} (version ${v.version}): ${vol?.total ?? "?"} posts planned.`);
    for (const t of vol?.topics ?? []) lines.push(`- Topic "${t.name}": ${t.low} to ${t.high} posts`);
    const searches = v.targets?.ranking?.searches ?? [];
    if (searches.length) lines.push(`Ranking: page one for ${v.targets?.ranking?.pageOneTarget ?? 0} of these searches: ${searches.map((s) => `"${s.query}"`).join(", ")}.`);
  } else {
    lines.push("No goals approved yet.");
  }
  for (const p of proposals) {
    lines.push(p.status === "sent" ? `A Strategist proposal for ${p.quarter} is waiting on the operator's approval in Goals.` : `The Strategist is already writing a proposal for ${p.quarter}.`);
  }
  return lines.join("\n");
}
