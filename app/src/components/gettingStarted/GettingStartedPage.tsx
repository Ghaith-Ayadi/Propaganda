// #/getting-started: a new tenant's first day, start to first article
// (onboarding/first-day-flow.md in the project files; decided by Ayadi,
// 2026-10-10). The steps on the left, today's timeline on the right:
//
//   1. Your business     website, name, posts a month        (onboarding/SetupStep)
//   2. Your strategy     the Strategist's four questions     (goals/StrategistOnboarding)
//   3. Planning          the Strategist writes; the rest of the setup meanwhile
//   4. The plan          read it, answer its questions, approve or ask again (5 rounds)
//   5-6. First pitches   the Strategist's first pitches; the Writer drafts the strongest 3
//   7. Publish           the first draft opens in the editor; "Approve and publish now"
//
// The step comes from the tenant's own data (state.ts), so it resumes on any
// device. Lite tenants never see the page (no AI on Lite). It shows in the nav
// once a tenant has started here (onboarding.started: a tenant with no approved
// plan that opens it) and leaves after "I got it" (onboarding.completed).

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Stars01 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { useWorkspace } from "@/components/Workspace";
import { SetupStep } from "@/components/onboarding/SetupStep";
import { StrategistOnboarding } from "@/components/goals/StrategistOnboarding";
import { pollGoalsEvery, refreshGoals } from "@/lib/goals/live";
import { refresh as refreshPipeline } from "@/lib/pipeline/store";
import { goPage } from "@/lib/route";
import { setSetting, useSetting } from "@/lib/settings";
import { siteHost } from "@/lib/siteUrl";
import { track } from "@/lib/telemetry";
import { StepFooter, StepTitle } from "./bits";
import { JUST_PUBLISHED_KEY } from "./backLink";
import { FirstPitches } from "./FirstPitches";
import { PlanningStep } from "./PlanningStep";
import { useStrategistProgress } from "./progress";
import { Confetti, NextDialog, PublishedStep } from "./Published";
import { useFirstDay } from "./state";
import { StrategyView } from "./StrategyView";
import { PhoneProgress, TodayPanel } from "./TodayPanel";

export function GettingStartedPage() {
  const { site } = useWorkspace();
  const day = useFirstDay();
  const rootRef = useRef<HTMLDivElement>(null);
  const [nextOpen, setNextOpen] = useState(false);
  const [celebrate, setCelebrate] = useState(false);

  // The nav shows the page to a tenant that started here and hasn't finished (lite/pages.ts).
  const started = !!useSetting<string>("onboarding.started", "");
  useEffect(() => {
    if (day.ready && !started && !day.completed && day.proposal?.status !== "approved") {
      void setSetting("onboarding.started", new Date().toISOString());
    }
  }, [day.ready, started, day.completed, day.proposal?.status]);

  const toTop = () => rootRef.current?.closest("main")?.scrollTo({ top: 0, behavior: "smooth" });

  // Every step change starts at the top of the page, where the new step is.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    toTop();
  }, [day.step]);

  // Waiting on an agent: read the goals and the board every few seconds, and the worker's progress.
  const draftsPending = day.step === "pitches" && !day.done.has("drafts");
  const pitchesPending = (day.step === "plan" || day.step === "pitches") && day.firstPitches.length < 3;
  const waiting = day.planning || pitchesPending || draftsPending;
  useEffect(() => (day.planning ? pollGoalsEvery(5000) : undefined), [day.planning]);
  useEffect(() => {
    if (!pitchesPending && !draftsPending) return;
    const id = window.setInterval(() => void refreshPipeline(), 5000);
    return () => window.clearInterval(id);
  }, [pitchesPending, draftsPending]);
  const progress = useStrategistProgress(site.id, waiting);

  // Back from publishing the first article: confetti once, then "What happens next".
  useEffect(() => {
    if (!day.firstArticle) return;
    let just: string | null = null;
    try {
      just = sessionStorage.getItem(JUST_PUBLISHED_KEY);
      if (just) sessionStorage.removeItem(JUST_PUBLISHED_KEY);
    } catch {
      // No session storage: no confetti.
    }
    if (just !== day.firstArticle) return;
    setCelebrate(true);
    const t = window.setTimeout(() => setNextOpen(true), 1800);
    return () => window.clearTimeout(t);
  }, [day.firstArticle]);

  const finish = async (after: "guide" | "pipeline") => {
    setNextOpen(false);
    track("getting_started_next", { after });
    if (after === "guide") {
      await setSetting("onboarding.after", "guide");
      toTop();
    } else {
      await setSetting("onboarding.completed", new Date().toISOString());
      goPage("pipeline");
    }
  };

  const host = siteHost({ slug: site.slug, domain: site.domain });
  return (
    <div ref={rootRef} className="contents">
      <div className="top-0 z-30 bg-primary md:sticky">
        <PageHeader title="Getting started" description={`Today, from your answers to your first article on ${host}.`} />
      </div>
      <PageBody>
        {!day.ready ? null : (
          <>
            <PhoneProgress step={day.step} done={day.done} active={day.active} />
            <div className="flex flex-col gap-10 lg:flex-row lg:items-start">
              <div className="min-w-0 flex-1">
                {day.step === "business" && <BusinessStep />}
                {day.step === "strategy" && <StrategyStep />}
                {day.step === "planning" && <PlanningStep day={day} progress={progress} />}
                {day.step === "plan" && day.proposal && (
                  <StrategyView proposal={day.proposal} round={day.strategist?.rounds ?? 1} pitches={day.firstPitches} progress={progress} />
                )}
                {day.step === "pitches" && <FirstPitches day={day} progress={progress} continuing={day.after === "guide"} />}
                {day.step === "publish" && <PublishedStep day={day} onNext={() => setNextOpen(true)} />}
              </div>
              <TodayPanel done={day.done} active={day.active} />
            </div>
          </>
        )}
      </PageBody>
      {celebrate && <Confetti />}
      {nextOpen && <NextDialog day={day} onClose={() => setNextOpen(false)} onGuide={() => void finish("guide")} onPipeline={() => void finish("pipeline")} />}
    </div>
  );
}

function BusinessStep() {
  return (
    <section className="max-w-2xl">
      <StepTitle title="Your business" lede="Three things to start. Everything else builds on them." />
      <SetupStep />
      <StepFooter>
        <span className="text-sm text-tertiary">Next: four questions about your strategy.</span>
        <Button
          iconTrailing={ArrowRight}
          onClick={() => {
            track("getting_started_business");
            void setSetting("onboarding.business", new Date().toISOString());
          }}
        >
          Continue
        </Button>
      </StepFooter>
    </section>
  );
}

function StrategyStep() {
  return (
    <section className="max-w-2xl">
      <StepTitle
        title="Your strategy"
        lede="Four questions, then any plan you already have. The Strategist turns it into a plan and your first pitches, in about 3 minutes. You'll set up the rest meanwhile."
      />
      <StrategistOnboarding submitLabel="Write my plan" submitIcon={Stars01} onDone={() => void refreshGoals()} />
    </section>
  );
}
