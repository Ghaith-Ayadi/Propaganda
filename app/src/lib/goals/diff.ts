// What a revision changed, in plain bullets, by comparing a proposal with the
// round before it. Nothing here is specific to a tenant: it reads only the
// proposal's own fields.

import type { Proposal } from "./types";

const fmt = (n: number) => n.toLocaleString("en-US");
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function describeChanges(prev: Proposal, next: Proposal): string[] {
  const out: string[] = [];

  if (prev.launch && next.launch && prev.launch.target !== next.launch.target) {
    out.push(`Launch: ${prev.launch.target} posts became ${next.launch.target}.`);
  }
  if (prev.volume.value !== next.volume.value) {
    out.push(`Posts this quarter: ${fmt(prev.volume.value)} became ${fmt(next.volume.value)}.`);
  }
  const pa = prev.ranking.pageOneTarget.value;
  const pb = next.ranking.pageOneTarget.value;
  if (pa !== pb) out.push(`Searches on page one: ${pa} became ${pb}.`);

  const topicsBefore = new Map(prev.topics.map((t) => [t.name.toLowerCase(), t]));
  const topicsAfter = new Map(next.topics.map((t) => [t.name.toLowerCase(), t]));
  for (const [k, t] of topicsAfter) {
    const old = topicsBefore.get(k);
    if (!old) out.push(`New topic: ${t.name}.`);
    else if (old.low !== t.low || old.high !== t.high) out.push(`${t.name}: ${old.low} to ${old.high} posts became ${t.low} to ${t.high}.`);
  }
  for (const [k, t] of topicsBefore) if (!topicsAfter.has(k)) out.push(`Dropped topic: ${t.name}.`);

  const searchesBefore = new Set(prev.ranking.searches.map((s) => s.query.toLowerCase()));
  const searchesAfter = new Set(next.ranking.searches.map((s) => s.query.toLowerCase()));
  const added = next.ranking.searches.filter((s) => !searchesBefore.has(s.query.toLowerCase())).map((s) => s.query);
  const removed = prev.ranking.searches.filter((s) => !searchesAfter.has(s.query.toLowerCase())).map((s) => s.query);
  if (added.length) out.push(`Searches added: ${added.join(", ")}.`);
  if (removed.length) out.push(`Searches dropped: ${removed.join(", ")}.`);

  const sitesBefore = new Set(prev.watchedSites.map((w) => w.url));
  const sitesAfter = new Set(next.watchedSites.map((w) => w.url));
  const siteAdded = next.watchedSites.filter((w) => !sitesBefore.has(w.url)).length;
  const siteRemoved = prev.watchedSites.filter((w) => !sitesAfter.has(w.url)).length;
  if (siteAdded) out.push(`${siteAdded} more site${siteAdded === 1 ? "" : "s"} watched.`);
  if (siteRemoved) out.push(`${siteRemoved} site${siteRemoved === 1 ? "" : "s"} no longer watched.`);

  const open = next.questions.filter((q) => !prev.questions.some((p) => same(p, q)));
  if (prev.questions.length && !next.questions.length) out.push("Your questions are answered; nothing is left open.");
  else if (open.length) out.push(`${open.length} new question${open.length === 1 ? "" : "s"} for you.`);

  if (!out.length && !same(prev.summary, next.summary)) out.push("The summary was reworded; the numbers and topics stayed as they were.");
  if (!out.length) out.push("Nothing in the plan's numbers or topics changed.");
  return out;
}
