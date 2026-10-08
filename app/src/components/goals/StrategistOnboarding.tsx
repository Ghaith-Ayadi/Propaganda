// The Strategist's onboarding step: the `strategist` slot in
// components/onboarding/handoffs.ts (#35). Four questions in Ayadi's order
// (2026-10-08), then the plan drop. Review capacity was already asked in
// "Your business" (site setting strategist.reviewPerMonth), so it's read here,
// never asked again. There's no consultant review: the Strategist's proposal
// goes straight to the tenant's Goals page.

import { useEffect, useState } from "react";
import { Label, TextArea, TextField } from "react-aria-components";
import { ArrowRight } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { toast } from "@/components/base/toast/toast";
import { useWorkspace } from "@/components/Workspace";
import { useSetting } from "@/lib/settings";
import { reportError, track } from "@/lib/telemetry";
import type { StrategyAnswers } from "@/lib/goals/types";
import { goalsActions, useStrategyAnswers } from "@/lib/goals/useGoals";
import { PlanDropFields, usePlanDraft } from "./PlanDrop";

const QUESTIONS: { id: keyof StrategyAnswers; label: string; hint: string; example: string; rows: number }[] = [
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
];

/** "Your business" (#35) offers 4, 8, 12 and 16 or more; its top option is stored as "16". */
function reviewLine(v: string): string {
  return v === "16" || v === "16+" ? "16 or more posts a month" : `${v} posts a month`;
}

export function StrategistOnboarding({ onDone }: { onDone: () => void }) {
  const { site } = useWorkspace();
  const saved = useStrategyAnswers(site.id);
  const [answers, setAnswers] = useState<StrategyAnswers>(saved);
  useEffect(() => setAnswers(saved), [saved]);
  const review = useSetting<string>("strategist.reviewPerMonth", "8") ?? "8";
  const plan = usePlanDraft();
  const [saving, setSaving] = useState(false);

  const answered = QUESTIONS.filter((q) => answers[q.id].trim()).length;

  const save = async () => {
    setSaving(true);
    try {
      await goalsActions.saveStrategyAnswers(site.id, answers);
      await plan.save();
      track("strategist_onboarding_saved", { answered, planText: !!plan.text.trim(), planFiles: plan.drop.files.length + plan.pending.length });
      onDone();
    } catch (err) {
      reportError("goals.onboarding", err);
      toast.add({ type: "error", title: "Couldn't save your answers", description: "Try again in a moment." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <p className="rounded-lg bg-secondary px-3.5 py-2.5 text-sm text-secondary">
        The Strategist plans around the {reviewLine(review)} you said you can review.
      </p>

      {QUESTIONS.map((q, i) => (
        <TextField
          key={q.id}
          value={answers[q.id]}
          onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
          className="flex flex-col gap-1.5"
        >
          <Label className="text-sm font-medium text-secondary">
            <span className="mr-1.5 text-quaternary tabular-nums">{i + 1}.</span>
            {q.label}
          </Label>
          <TextArea
            rows={q.rows}
            placeholder={q.example}
            className="w-full resize-y rounded-lg bg-primary px-3.5 py-2.5 text-md text-primary shadow-xs ring-1 ring-primary outline-none ring-inset placeholder:text-placeholder focus:ring-2 focus:ring-brand"
          />
          <span className="text-sm text-tertiary">{q.hint}</span>
        </TextField>
      ))}

      <div className="flex flex-col gap-1.5 border-t border-secondary pt-6">
        <p className="text-sm font-medium text-secondary">Already have a plan?</p>
        <p className="text-sm text-tertiary">
          Paste it or drop the files. Every item shows up in the Strategist's proposal: kept, changed with a reason, or moved to the backlog.
        </p>
        <div className="mt-2">
          <PlanDropFields draft={plan} compact label="Your plan, notes or a list of titles" />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-tertiary">
          {answered} of {QUESTIONS.length} answered. The Strategist drafts your goals and first briefs from these.
        </p>
        <Button color="primary" iconTrailing={ArrowRight} isLoading={saving} isDisabled={saving} onClick={() => void save()}>
          Save and continue
        </Button>
      </div>
    </div>
  );
}
