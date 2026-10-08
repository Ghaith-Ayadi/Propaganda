// Product copy for the Strategist's explanations. Versioned with the
// Strategist's rules so the help center and the UI never disagree
// (agents/strategist-cold-start-and-pacing.md, section 1). Each line links to
// its help center article once the help center exists (before GA).

export const STRATEGIST_COPY_VERSION = "2026-10-07";

export interface ExplainerLine {
  text: string;
  /** Help center article with the sources. Not published yet. */
  helpSlug: string;
}

/** Why a new blog ranks slowly. Shown on the Launch card, Goals and the proposal. */
export const AUTHORITY_EXPLAINER: ExplainerLine[] = [
  {
    text: "A new domain ranks slowly whatever we do.",
    helpSlug: "new-domain-authority",
  },
  {
    text: "Ahrefs found 5.7% of pages reach the top 10 within a year, and the winners take 2 to 6 months.",
    helpSlug: "new-domain-authority#ahrefs",
  },
  {
    text: "Google's John Mueller: it's hard to call a site authoritative after 30 articles. The fix is to keep publishing, not to publish more at once.",
    helpSlug: "new-domain-authority#mueller",
  },
];

export const LAUNCH_WHY =
  "A new blog has no authority yet. The first month builds a library in one or two topics so Google and readers can tell what you're about. Rankings come in months 3 to 6.";

export const ZERO_OPPORTUNISTIC =
  "Everything in the quarter is planned. Posts from news and calls are a bonus on top; when one deserves a slot, a planned post moves to next quarter.";

export const BATCH_RULE =
  "One batch at a time, so review stays one sitting. The next batch arrives when two thirds of this one is decided, or after 7 days.";

export const GOAL_COPY: Record<string, { title: string; question: string }> = {
  volume: { title: "Volume", question: "Are we publishing enough, on the right topics?" },
  coverage: { title: "Coverage", question: "Are we using what we know and what people search for?" },
  consistency: { title: "Consistency", question: "Is what we publish true and aligned?" },
  readership: { title: "Readership", question: "Is anyone paying attention?" },
  ranking: { title: "Ranking", question: "Do we show up where it counts?" },
};
