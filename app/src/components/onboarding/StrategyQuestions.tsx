// Onboarding step 2 until the Strategist's own step lands (handoffs.ts,
// "Goals and Strategist pages" thread): its four questions, in Ayadi's
// order, then the plan drop, with example answers as placeholders.
//
// The answers stay on this device (localStorage, per site) for now: where
// they live on the server is the Strategist's call, and app_settings is
// public, which competitor lists and plans shouldn't be.

import { useEffect, useState } from "react";
import { Label, TextArea, TextField } from "react-aria-components";
import { useWorkspace } from "@/components/Workspace";

export interface StrategyQuestion {
  id: string;
  label: string;
  hint: string;
  example: string;
  rows: number;
}

export const STRATEGY_QUESTIONS: StrategyQuestion[] = [
  {
    id: "offer",
    label: "What do you sell, and who buys it?",
    hint: "A sentence or two is plenty.",
    example: "An open-source framework for fleet-scale batch jobs. Bought by platform and data teams who've outgrown cron.",
    rows: 3,
  },
  {
    id: "searches",
    label: "3 to 5 searches you want to be found by",
    hint: "One per line, as someone would type them.",
    example: "temporal batch jobs\nrun scrapers at scale\nopen source etl orchestration",
    rows: 4,
  },
  {
    id: "watch",
    label: "Competitors and sites worth watching",
    hint: "Names or addresses, one per line. Scout follows them.",
    example: "airflow.apache.org\nprefect.io\ndagster.io",
    rows: 4,
  },
  {
    id: "upcoming",
    label: "Anything happening in the next three months?",
    hint: "Launches, events, hires, a funding round. Skip it if nothing is planned.",
    example: "v2 ships in November. Talk at KubeCon in December.",
    rows: 3,
  },
  {
    id: "plan",
    label: "Already have a content plan?",
    hint: "Paste it here. Dropping a PDF, doc or image comes with the Strategist's own step.",
    example: "Q4 ideas:\n- Close checklist series\n- Customer story with Northwind",
    rows: 4,
  },
];

type Answers = Record<string, string>;

const storageKey = (siteId: string) => `propaganda:onboarding:strategy:${siteId}`;

function load(siteId: string): Answers {
  try {
    return JSON.parse(localStorage.getItem(storageKey(siteId)) || "{}") as Answers;
  } catch {
    return {};
  }
}

export function StrategyQuestions() {
  const { site } = useWorkspace();
  const [answers, setAnswers] = useState<Answers>(() => load(site.id));

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(site.id), JSON.stringify(answers));
    } catch {
      // Private window or full storage: the answers just don't survive a reload.
    }
  }, [site.id, answers]);

  return (
    <div className="flex flex-col gap-5">
      {STRATEGY_QUESTIONS.map((q) => (
        <TextField
          key={q.id}
          value={answers[q.id] ?? ""}
          onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
          className="flex flex-col gap-1.5"
        >
          <Label className="text-sm font-medium text-secondary">{q.label}</Label>
          <TextArea
            rows={q.rows}
            placeholder={q.example}
            className="w-full resize-y rounded-lg bg-primary px-3.5 py-2.5 text-md text-primary shadow-xs ring-1 ring-primary outline-none ring-inset placeholder:text-placeholder focus:ring-2 focus:ring-brand"
          />
          <span className="text-sm text-tertiary">{q.hint}</span>
        </TextField>
      ))}
    </div>
  );
}
