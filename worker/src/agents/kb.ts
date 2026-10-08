// What the tenant knows, from the knowledge base (the Guardian thread's schema,
// kb-data-model). Read only, through kb_search: the nearest claims for a query,
// never the whole base. Keyword search until the worker fills embeddings.
// A server without the knowledge base yet reads as an empty one.

import { isMissing, rpc } from "./backend.js";

export interface Claim {
  id: string;
  text: string;
  status: "settled" | "contested";
  topics: string[];
}

export async function searchClaims(site: string, query: string, limit = 20): Promise<Claim[]> {
  if (!query.trim()) return [];
  try {
    const rows = await rpc<Claim[]>("kb_search", { p_site: site, p_query: query, p_limit: limit });
    return rows.map((r) => ({ id: r.id, text: r.text, status: r.status, topics: r.topics ?? [] }));
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
}

/** Several queries, deduplicated, in first-seen order. */
export async function claimsFor(site: string, queries: string[], perQuery = 10): Promise<Claim[]> {
  const seen = new Map<string, Claim>();
  for (const q of queries) for (const c of await searchClaims(site, q, perQuery)) if (!seen.has(c.id)) seen.set(c.id, c);
  return [...seen.values()];
}

/** One sentence per line under topic headings, with ids: how agents read claims (kb-data-model README). */
export function renderClaims(claims: Claim[]): string {
  if (claims.length === 0) return "(The knowledge base has nothing on this yet.)";
  const byTopic = new Map<string, Claim[]>();
  for (const c of claims) {
    const t = c.topics[0] ?? "General";
    byTopic.set(t, [...(byTopic.get(t) ?? []), c]);
  }
  return [...byTopic]
    .map(([t, cs]) => `## ${t}\n${cs.map((c) => `- [${c.id}] ${c.text}${c.status === "contested" ? " (contested: don't state it as settled)" : ""}`).join("\n")}`)
    .join("\n\n");
}
