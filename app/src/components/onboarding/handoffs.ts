// The steps of a new tenant's first run that other parts of the app own.
// Onboarding (OnboardingFlow.tsx) shows them in order and doesn't know what's
// inside: each is a component that calls `onDone` when its part is finished
// (or skipped). Until a thread fills a slot, the step shows `placeholder`.
//
//   strategist   the Strategist's five onboarding questions and the plan drop
//                (text area plus PDF/doc/JPEG): the "Goals and Strategist
//                pages" thread. Fill `component` below with theirs.
//   connections  where Propaganda listens (Granola, the transcript URL, Slack,
//                documents): the Connections page's thread.
//
// A filled step renders inside the onboarding card, full width, with its own
// buttons; the flow's Back and Skip stay outside it.

import type { ComponentType } from "react";

export interface HandoffStepProps {
  /** The step is finished: onboarding moves on. */
  onDone: () => void;
}

export interface Handoff {
  id: "strategist" | "connections";
  /** In the step strip at the top. */
  label: string;
  title: string;
  lede: string;
  /** The owning page, for "do it later": an id from lib/routes.ts. */
  page: string;
  component: ComponentType<HandoffStepProps> | null;
  /** What the step promises until `component` lands. */
  placeholder: string[];
}

export const HANDOFFS: Handoff[] = [
  {
    id: "strategist",
    label: "Strategy",
    title: "Your strategy",
    lede: "Five questions, then drop in any plan you already have. The Strategist turns it into this quarter's goals and a first batch of briefs.",
    page: "goals",
    // Goals and Strategist thread: lazy(() => import("@/components/goals/StrategistOnboarding").then(...))
    component: null,
    placeholder: [
      "Who you write for, and what they should come away believing.",
      "The topics worth owning this quarter.",
      "How much you can review in a week.",
      "Searches you want to rank for, and sites worth watching.",
      "Anything off limits.",
    ],
  },
  {
    id: "connections",
    label: "Sources",
    title: "Where Propaganda listens",
    lede: "Calls, Slack and documents are what your knowledge base is built from. Connect what you have; you can add more any time.",
    page: "connections",
    // Connections thread: your page's onboarding step goes here.
    component: null,
    placeholder: [
      "Granola, for call transcripts.",
      "A private address any tool can send transcripts to.",
      "Slack channels worth reading.",
      "Documents dropped straight from your machine.",
    ],
  },
];
