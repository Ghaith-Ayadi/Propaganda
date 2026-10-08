// Ideas: what the Listener, the Scout, Chat and people hand the Pitcher. One
// row each in agent_ideas, with the evidence that made it an idea. The
// producers only insert (status "new"); the Pitcher fills each batch from the
// best ideas waiting, whatever their source, and settles every idea it judges
// as pitched (with its brief) or rejected (with a reason), keeping both.

import { insertIdea, type IdeaRow } from "./store.js";
import { startForTenant } from "../workflows/agents.js";
import { pitchBatch } from "./pitcher.js";

/** Same values as the pipeline UI's Origin (app/src/lib/pipeline/types.ts). */
export type Origin = "calls" | "search" | "news" | "watched" | "team" | "plan";

export interface NewIdea {
  title: string;
  summary: string;
  origin: Origin;
  evidence: NonNullable<IdeaRow["evidence"]>;
  sourceAgent: "listener" | "scout" | "chat" | "person" | "strategist";
  /** For timely ideas: when it stops being worth writing. */
  expiresAt?: string | null;
  /** One of the quarter's 10 target searches, when it's about one. */
  targetSearch?: string;
  /** A stable key for the idea: handing off the same key again adds nothing (the Scout's daily runs). */
  key?: string;
}

/**
 * Store ideas for a tenant and start the Pitcher on them. Call it from a
 * workflow step (it writes) or from outside a workflow.
 */
export async function handOffIdeas(site: string, ideas: NewIdea[], opts: { pitchNow?: boolean } = {}): Promise<string[]> {
  const ids: string[] = [];
  for (const i of ideas) {
    const row = await insertIdea({
      site,
      title: i.title.slice(0, 300),
      summary: i.summary.slice(0, 4000),
      origin: i.origin,
      evidence: i.evidence.slice(0, 20),
      source_agent: i.sourceAgent,
      expires_at: i.expiresAt ?? null,
      target_search: i.targetSearch ?? "",
    }, i.key);
    ids.push(row.id);
  }
  // Every idea competes for the next batch's slots. The plan arriving starts a
  // batch run now (flood sends it; weekly sends the quarter's first batch);
  // the rest wait for the morning run.
  if (opts.pitchNow !== false && ideas.some((i) => i.origin === "plan")) {
    await startForTenant(site, pitchBatch, { site, trigger: "handoff" });
  }
  return ids;
}
