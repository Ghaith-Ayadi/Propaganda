// What the Chat agent can read, always as the person asking (their rights,
// their site). The knowledge base is searched, never loaded whole: a question
// pulls the dozen nearest claims (public.kb_search, keyword and meaning merged).

import { BackendError, asUser, eq } from "./db.js";

export interface ClaimHit {
  id: string;
  text: string;
  status: "settled" | "contested";
  topics: string[];
}

/** `total`: how many live claims the knowledge base holds, read only when a search finds none. */
export type KbResult = { available: true; claims: ClaimHit[]; total: number | null } | { available: false };

export async function searchKnowledge(token: string, site: string, query: string, limit = 12): Promise<KbResult> {
  try {
    const claims = await asUser(token).post<ClaimHit[]>(
      "/rpc/kb_search",
      { p_site: site, p_query: query, p_limit: limit },
      "return=representation",
    );
    const found = claims ?? [];
    // A search that finds nothing can mean "no match" or "nothing there": tell them apart.
    const total = found.length ? null : await countClaims(token, site);
    return { available: true, claims: found, total };
  } catch (err) {
    // Not deployed yet (the Guardian's schema lands separately): say so, don't fail the reply.
    if (err instanceof BackendError && (err.status === 404 || err.status === 400)) return { available: false };
    throw err;
  }
}

const COUNT_CAP = 500;

async function countClaims(token: string, site: string): Promise<number | null> {
  try {
    const rows = await asUser(token).get<{ id: string }[]>(
      `/kb_claims?select=id&site=${eq(site)}&status=in.(settled,contested)&limit=${COUNT_CAP}`,
    );
    return rows.length;
  } catch {
    return null; // the count only colours the answer
  }
}

export interface PostHit {
  id: string;
  title: string;
  status: string;
  collection: string;
  publishedAt: string | null;
  /** A few lines around the whole phrase, or where most of the query's words sit. */
  excerpt: string;
  /** The post holds the whole query as a phrase. */
  exact: boolean;
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

/** Lower case, punctuation and runs of space collapsed to one space: text and phrase compare on this. */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * A few lines of `content` worth showing for `query`: around the whole phrase when
 * the text has it, else around the stretch that holds the most different query words.
 */
export function passage(content: string, query: string, words: string[], size = 320): string {
  const text = content.replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  let at = 0;
  const phrase = query.toLowerCase().replace(/\s+/g, " ").trim();
  const exact = phrase.length >= 4 ? lower.indexOf(phrase) : -1;
  if (exact >= 0) {
    at = exact;
  } else if (words.length) {
    // Every occurrence of a word starts a window; the window with most different words wins.
    let best = -1;
    for (const w of words) {
      for (let i = lower.indexOf(w); i >= 0; i = lower.indexOf(w, i + w.length)) {
        const win = lower.slice(i, i + size);
        const n = words.filter((x) => win.includes(x)).length;
        if (n > best) {
          best = n;
          at = i;
        }
      }
    }
  }
  const start = Math.max(0, at - Math.floor(size / 4));
  const s = text.slice(start, start + size);
  return (start > 0 ? "…" : "") + s + (start + size < text.length ? "…" : "");
}

/** Does the text hold the whole query, ignoring case and punctuation? */
function hasPhrase(text: string, query: string): boolean {
  const q = normalize(query);
  return q.split(" ").length >= 2 && ` ${normalize(text)} `.includes(` ${q} `);
}

/**
 * Rows whose `fields` hold every query word; when none do, rows with any of them.
 * (`and` first so a sentence finds the page it came from, not the four pages that share one word.)
 */
async function findRows<T>(token: string, path: string, fields: string[], words: string[], limit: number): Promise<T[]> {
  const per = (w: string) => `or(${fields.map((f) => `${f}.ilike.*${w}*`).join(",")})`;
  const get = (filter: string) =>
    asUser(token).get<T[]>(`${path}&${filter}&order=updated.desc&limit=${limit}`);
  if (words.length > 1) {
    const all = await get(`and=(${encodeURIComponent(words.map(per).join(","))})`);
    if (all.length) return all;
  }
  return get(`or=(${encodeURIComponent(fields.flatMap((f) => words.map((w) => `${f}.ilike.*${w}*`)).join(","))})`);
}

export async function searchPosts(token: string, site: string, query: string, limit = 6): Promise<PostHit[]> {
  const words = searchWords(query);
  if (!words.length) return [];
  const rows = await findRows<PostRow>(
    token,
    `/posts?select=id,title,status,type,published_at,excerpt,content_md&site=${eq(site)}`,
    ["title", "content_md"],
    words,
    40,
  );
  // The whole phrase first, then by how many of the words each post has, title hits counting double.
  const score = (r: PostRow) =>
    (hasPhrase(`${r.title} ${r.content_md}`, query) ? 100 : 0) +
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
      excerpt: passage(r.content_md || r.excerpt, query, words),
      exact: hasPhrase(`${r.title} ${r.content_md}`, query),
    }));
}

export interface PitchHit {
  /** A brief is a pitch (or what an approved one became); an idea is what the Pitcher works from. */
  kind: "brief" | "idea";
  id: string;
  title: string;
  status: string;
  excerpt: string;
  exact: boolean;
}

interface BriefRow {
  id: string;
  title: string;
  status: string;
  body: string;
  angle: string;
}

interface IdeaRow {
  id: string;
  title: string;
  summary: string;
  status: string;
  brief: string | null;
}

/** Pitches (briefs: title, angle, body) and ideas (title, summary), the Pipeline's side of the product. */
export async function searchPitches(token: string, site: string, query: string, limit = 6): Promise<PitchHit[]> {
  const words = searchWords(query);
  if (!words.length) return [];
  const [briefs, ideas] = await Promise.all([
    findRows<BriefRow>(token, `/briefs?select=id,title,status,body,angle&site=${eq(site)}`, ["title", "angle", "body"], words, 30),
    findRows<IdeaRow>(token, `/agent_ideas?select=id,title,summary,status,brief&site=${eq(site)}`, ["title", "summary"], words, 30),
  ]);
  const rank = (text: string, title: string) =>
    (hasPhrase(text, query) ? 100 : 0) + words.reduce((s, w) => s + (title.toLowerCase().includes(w) ? 2 : 0) + (text.toLowerCase().includes(w) ? 1 : 0), 0);
  const hits: (PitchHit & { s: number; brief?: string | null })[] = [
    ...briefs.map((b) => {
      const text = `${b.title} ${b.angle} ${b.body}`;
      return { kind: "brief" as const, id: b.id, title: b.title || "Untitled", status: b.status, excerpt: passage(`${b.angle} ${b.body}`.trim(), query, words), exact: hasPhrase(text, query), s: rank(text, b.title) };
    }),
    ...ideas.map((i) => {
      const text = `${i.title} ${i.summary}`;
      return { kind: "idea" as const, id: i.id, title: i.title, status: i.status, excerpt: passage(i.summary, query, words), exact: hasPhrase(text, query), s: rank(text, i.title), brief: i.brief };
    }),
  ];
  // An idea that became a hit brief is the same thing twice.
  const briefIds = new Set(briefs.map((b) => b.id));
  return hits
    .filter((h) => !(h.kind === "idea" && h.brief && briefIds.has(h.brief)))
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(({ s: _s, brief: _b, ...h }) => h);
}

export async function siteName(token: string, site: string): Promise<string> {
  const [row] = await asUser(token).get<{ name: string }[]>(`/sites?select=name&id=${eq(site)}`);
  return row?.name ?? "this site";
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
