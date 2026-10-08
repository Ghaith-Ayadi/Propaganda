// What the tenant likes, dislikes and has already been shown
// (strategist-cold-start-and-pacing.md, section 3b). The taste log is the
// record (one row per decision, written by the database triggers and the app);
// this file reads it for the Pitcher: a short summary the Pitcher rewrites
// before each batch, the recent decisions verbatim, and the no-repeats check
// against everything ever pitched or published.

import { DBOS } from "@dbos-inc/dbos-sdk";
import { MODELS, askText } from "./model.js";
import { saveTasteSummary, tasteLog, tasteProfile, type TasteRow } from "./store.js";

// ---- near-duplicates ----

const STOP = new Set(
  "a an and are as at be but by can do does for from how i if in into is it its of on or our so than that the their them then there these they this to too vs was we what when where which who why will with without you your".split(" "),
);

/** The words that carry a title's meaning, lowercased and roughly singular. */
export function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map((w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)),
  );
}

/** Overlap of two titles' keywords, 0 to 1 (Jaccard). */
export function similarity(a: string, b: string): number {
  const x = keywords(a);
  const y = keywords(b);
  if (x.size === 0 || y.size === 0) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

/** Close enough to be the same post. */
export const SAME_POST = 0.5;

export interface Seen {
  title: string;
  kind: "rejected" | "published" | "pipeline" | "not_now";
  /** YYYY-MM-DD */
  date: string;
  reason: string;
}

/** The closest thing already pitched or published, if any is close enough. */
export function nearest(title: string, seen: Seen[]): (Seen & { score: number }) | null {
  let best: (Seen & { score: number }) | null = null;
  for (const s of seen) {
    const score = similarity(title, s.title);
    if (score >= SAME_POST && (!best || score > best.score)) best = { ...s, score };
  }
  return best;
}

export function seenLine(s: Seen): string {
  if (s.kind === "rejected") return `rejected on ${s.date}: "${s.title}"${s.reason ? `, because: ${s.reason.trim().replace(/[.!]+$/, "")}` : ""}`;
  if (s.kind === "not_now") return `pushed to later on ${s.date}: "${s.title}"`;
  if (s.kind === "published") return `published on ${s.date}: "${s.title}"`;
  return `already in the pipeline: "${s.title}"`;
}

// ---- what the Pitcher reads before a batch ----

function decisionLine(r: TasteRow): string {
  const notes = (r.notes ?? []).map((n) => n.text).filter(Boolean).join("; ");
  const what = r.object_kind === "draft" ? "draft" : "pitch";
  const verb =
    {
      approved: "Approved",
      approved_with_notes: "Approved with notes",
      rejected: "Rejected",
      not_now: "Not now",
      cancelled: "Cancelled",
      edited: "Edited the draft of",
      sent_back: "Sent back",
      note: "Note on",
    }[r.decision] ?? r.decision;
  return `- ${r.at.slice(0, 10)} ${verb} ${what} "${r.title}"${r.origin ? ` (${r.origin})` : ""}${r.reason ? `: ${r.reason}` : ""}${notes ? ` [notes: ${notes}]` : ""}`;
}

export interface Taste {
  summary: string;
  /** The tenant's own words about its taste, if it wrote any. */
  notes: string;
  /** Recent decisions, verbatim, newest first. */
  recent: string;
}

export function renderTaste(t: Taste): string {
  return [
    t.notes ? `The tenant's own words about what it wants:\n${t.notes}` : "",
    t.summary ? `What we've learned about this tenant's taste:\n${t.summary}` : "",
    t.recent ? `Recent decisions (newest first):\n${t.recent}` : "",
  ]
    .filter(Boolean)
    .join("\n\n") || "(no decisions yet: this is the first batch)";
}

/**
 * Read the log and, when there are decisions the summary hasn't seen,
 * rewrite the summary first. Call from a workflow.
 */
export async function readTaste(site: string): Promise<Taste> {
  const { profile, fresh, recent } = await DBOS.runStep(
    async () => {
      const profile = await tasteProfile(site);
      const [fresh, recent] = await Promise.all([tasteLog(site, { since: profile?.summary_through ?? null, limit: 200 }), tasteLog(site, { limit: 30 })]);
      return { profile, fresh, recent };
    },
    { name: "read the taste log" },
  );
  let summary = profile?.summary ?? "";
  if (fresh.length) {
    summary = (
      await askText("rewrite the taste summary", {
        site,
        job: "pitcher:taste",
        model: MODELS.base,
        maxOutputTokens: 800,
        system:
          "You keep a short record of a content team's taste: what they approve, reject and change, and why. Plain sentences, no headings, at most 8 lines, each a pattern backed by their decisions (\"rejected 4 of 5 listicles\", \"approves anything with a customer story\"). Keep what still holds from the old summary, drop what newer decisions contradict.",
        prompt: `Old summary:\n${summary || "(none yet)"}\n\n${profile?.notes ? `The tenant's own words (they win over any pattern):\n${profile.notes}\n\n` : ""}New decisions:\n${fresh.map(decisionLine).join("\n")}\n\nWrite the new summary.`,
      })
    )
      .trim()
      .slice(0, 4000);
    const through = fresh[0].at;
    await DBOS.runStep(() => saveTasteSummary(site, summary, through), { name: "save the taste summary" });
  }
  return { summary, notes: profile?.notes ?? "", recent: recent.map(decisionLine).join("\n") };
}
