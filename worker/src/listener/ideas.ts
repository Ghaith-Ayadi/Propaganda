// The Listener's ideas, for the Pitcher. The Pitcher's thread owns the ideas
// inbox (public.agent_ideas, worker/src/agents/ideas.ts handOffIdeas()); until
// that lands here, ideas stay in the Listener run's output, where Admin > Runs
// shows them, and handOff() reports that nothing was handed over.

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

export async function handOff(_site: string, _ideas: IdeaIn[], _opts: { sourceAgent: "listener"; key: string }): Promise<boolean> {
  return false;
}
