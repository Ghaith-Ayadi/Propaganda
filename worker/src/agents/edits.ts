// What reviewers changed in the Writer's drafts (strategist-cold-start-and-pacing.md,
// section 3b, "Drafts learn too"). The database logs a draft as edited when a
// person saves a version right after the Writer's; this reads the two texts and
// keeps what changed, paragraph by paragraph. The Writer reads it before each
// draft, and proposes voice-guide changes from edits that repeat. It never
// changes the guide itself: the tenant applies the suggestion, or doesn't.

import { DBOS } from "@dbos-inc/dbos-sdk";
import { MODELS, arr, askJson, obj, str } from "./model.js";
import { HOUSE_RULES } from "./writing.js";
import { editedDrafts, saveVoiceSuggestion, versionsOf, voiceGuide } from "./store.js";

export interface DraftEdit {
  title: string;
  at: string;
  /** Paragraphs the reviewer cut or rewrote (the Writer's text). */
  removed: string[];
  /** What they wrote instead, or added. */
  added: string[];
}

const paragraphs = (md: string) =>
  md
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
const clip = (p: string) => (p.length > 300 ? `${p.slice(0, 300)}...` : p);

/** The reviewer's changes to the Writer's version: the reviewer's latest version against the Writer's last. */
export function diffDraft(writer: string, reviewer: string): { removed: string[]; added: string[] } {
  const a = paragraphs(writer);
  const b = paragraphs(reviewer);
  const inB = new Set(b);
  const inA = new Set(a);
  return { removed: a.filter((p) => !inB.has(p)).slice(0, 4).map(clip), added: b.filter((p) => !inA.has(p)).slice(0, 4).map(clip) };
}

/** Recent reviewer edits for the tenant, newest first. */
export async function reviewerEdits(site: string, since: string | null, limit = 5): Promise<DraftEdit[]> {
  const out: DraftEdit[] = [];
  for (const row of await editedDrafts(site, since, limit)) {
    const versions = await versionsOf(site, row.object_id);
    const lastWriter = [...versions].reverse().find((v) => v.created_by === "agent:writer");
    const latest = versions[versions.length - 1];
    if (!lastWriter || !latest || latest.created_by === "agent:writer") continue;
    const d = diffDraft(lastWriter.content, latest.content);
    if (d.removed.length || d.added.length) out.push({ title: row.title, at: row.at, ...d });
  }
  return out;
}

export function renderEdits(edits: DraftEdit[]): string {
  if (!edits.length) return "";
  return edits
    .map(
      (e) =>
        `On "${e.title}" (${e.at.slice(0, 10)}):\n${e.removed.map((p) => `  cut: ${p}`).join("\n")}${e.removed.length && e.added.length ? "\n" : ""}${e.added.map((p) => `  wrote: ${p}`).join("\n")}`,
    )
    .join("\n\n");
}

export interface SuggestResult {
  status: "suggested" | "nothing";
  edits: number;
}

/** Fewest edited drafts before the Writer looks for a pattern. */
const MIN_EDITS = 2;

async function voiceSuggestRun(input: { site: string }): Promise<SuggestResult> {
  const { site } = input;
  const guide = await DBOS.runStep(() => voiceGuide(site), { name: "read the voice guide" });
  if (!guide) return { status: "nothing", edits: 0 };
  const edits = await DBOS.runStep(() => reviewerEdits(site, guide.suggestion_through ?? null, 10), { name: "read reviewer edits" });
  if (edits.length < MIN_EDITS) return { status: "nothing", edits: edits.length };

  const proposed = await askJson(
    "propose voice changes",
    {
      site,
      job: "writer:voice-suggest",
      model: MODELS.base,
      maxOutputTokens: 1500,
      system: `You maintain a writer's voice guide. Reviewers edit the drafts; when they make the same kind of change on two or more drafts (always cutting the conclusion, always renaming a term, always softening a claim), that belongs in the guide. One-off edits don't.\n\n${HOUSE_RULES}`,
      prompt: `The voice guide now:\n${guide.body}\n\nHow reviewers edited recent drafts:\n${renderEdits(edits)}\n\nPropose changes to the guide only for edits that repeat across two or more drafts. Each change is one line the tenant can paste into the guide, with the drafts it comes from.\n\nAnswer with JSON only: {"changes": [{"change": "...", "from": ["draft title", "draft title"]}]}`,
    },
    (v) =>
      arr(obj(v, "The answer").changes, "changes", { optional: true }).map((x, i) => {
        const o = obj(x, `changes[${i}]`);
        return { change: str(o.change, `changes[${i}].change`, { max: 400 }), from: arr(o.from, `changes[${i}].from`, { optional: true }).map(String).slice(0, 5) };
      }),
  );
  const through = edits[0].at;
  const suggestion = proposed.length
    ? proposed.map((c, n) => `${n + 1}. ${c.change}${c.from.length ? ` (from your edits on ${c.from.map((t) => `"${t}"`).join(", ")})` : ""}`).join("\n")
    : "";
  // A suggestion the tenant hasn't dealt with yet stays; new ones go under it.
  const kept = guide.suggestion?.trim() ?? "";
  const next = suggestion ? (kept ? `${kept}\n${suggestion}` : suggestion) : kept;
  await DBOS.runStep(() => saveVoiceSuggestion(site, next.slice(0, 6000), through), { name: "save the suggestion" });
  return { status: suggestion ? "suggested" : "nothing", edits: edits.length };
}

export const voiceSuggest = DBOS.registerWorkflow(voiceSuggestRun, { name: "writer:voice-suggest" });
