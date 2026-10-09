// The Listener's ideas, for the Pitcher: rows in its ideas inbox
// (public.agent_ideas, through handOffIdeas() in agents/ideas.ts). They wait
// there and compete for the next batch's slots with every other idea; the
// Listener never starts the Pitcher itself.

import { handOffIdeas } from "../agents/ideas.js";

export interface IdeaEvidence {
  label: string;
  url?: string;
  quote?: string;
  at?: string;
  detail?: string;
  /** The kb_sources row the quote is from, and where in its body. */
  source_id?: string;
  span_start?: number;
  span_end?: number;
}

export interface IdeaIn {
  title: string;
  summary: string;
  /** The pipeline's Origin: a call is 'calls', a Slack thread is 'team'. */
  origin: "calls" | "team";
  evidence: IdeaEvidence[];
}

/**
 * Hands a source's ideas over. Each idea's key comes from its source and its
 * place in the (replayed, so fixed) extraction: a retried step adds nothing.
 */
export async function handOff(site: string, ideas: IdeaIn[], opts: { sourceAgent: "listener"; key: string }): Promise<boolean> {
  if (!ideas.length) return false;
  await handOffIdeas(
    site,
    ideas.map((i, n) => ({ ...i, sourceAgent: opts.sourceAgent, key: `listener:${site}:${opts.key}:${n}` })),
  );
  return true;
}
