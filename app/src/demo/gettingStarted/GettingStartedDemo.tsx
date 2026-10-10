// The Getting started page as a clickable demo, on example content
// (onboarding/first-day-flow.md in the project files). UI preview builds only
// (VITE_UI_PREVIEW, `npm run dev:ui`), at /_demo/getting-started: App.tsx
// never loads it otherwise, so nothing here can reach production.
//
// Nothing talks to a server. The agents' waits are shortened and simulated;
// the shell around the page (nav) is a static copy of the real one.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Label, TextArea, TextField } from "react-aria-components";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle,
  ChevronDown,
  Clock,
  Columns03,
  Database01,
  Dataflow03,
  Edit03,
  File06,
  Globe01,
  Home01,
  Inbox01,
  LinkExternal01,
  MessageChatCircle,
  RefreshCw01,
  Rocket02,
  SearchLg,
  Settings01,
  Stars01,
  Target04,
  XClose,
} from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Badge } from "@/components/base/badges/badges";
import { Input } from "@/components/base/input/input";
import { NativeSelect } from "@/components/base/select/select-native";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/shell/Card";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { cx } from "@/utils/cx";
import {
  ANSWERS,
  ARTICLE,
  NUMBERS,
  PITCHES,
  PLANNING_STEPS,
  QUESTIONS,
  REPLACEMENT,
  SEARCHES,
  SUMMARY,
  TENANT,
  TIMELINE,
  TOPICS,
  WATCHED,
  type Pitch,
  type StepId,
} from "./data";

// The app's fonts and type scale (EditorApp does the same).
document.documentElement.classList.add("ppgd-app");
if (!document.getElementById("demo-fonts")) {
  const link = document.createElement("link");
  link.id = "demo-fonts";
  link.rel = "stylesheet";
  link.href =
    "https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400..600&family=Source+Serif+4:ital,opsz,wght@0,8..60,400..700;1,8..60,400..700&display=swap";
  document.head.appendChild(link);
}

/** Demo speed: an agent's "3 minutes" takes this many seconds. */
const STRATEGIST_SECONDS = 14;
const REVISION_SECONDS = 8;
const PITCH_SECONDS = [2, 3.5, 5, 6.5];
const DRAFT_SECONDS = 22;
const REPLACE_SECONDS = 4;

const DOMAIN_STRIP_KEY = "demo:getting-started:domain-strip-dismissed";

type Decision = { kind: "approved" } | { kind: "rejected"; reason: string } | { kind: "later" };

export function GettingStartedDemo() {
  const [step, setStep] = useState<StepId>("business");
  const [started] = useState(() => Date.now());
  const [stepStarted, setStepStarted] = useState(() => Date.now());
  const [done, setDone] = useState<Set<StepId>>(new Set());
  const [round, setRound] = useState(1);
  const [revisionNote, setRevisionNote] = useState("");
  const [published, setPublished] = useState(false);
  /** The draft open in the review view (from the pitches), or null. */
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [nextOpen, setNextOpen] = useState(false);
  /** After the first article: carry on in the guide, or leave the rest in the Pipeline. */
  const [after, setAfter] = useState<"guide" | "pipeline" | null>(null);

  // Background work: the plan, the pitches and the drafts arrive on their own.
  const [planReady, setPlanReady] = useState(false);
  const [planProgress, setPlanProgress] = useState(0);
  const [topicsPitched, setTopicsPitched] = useState(0);
  const [pitches, setPitches] = useState<Pitch[]>(PITCHES);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [draftsStart, setDraftsStart] = useState<number | null>(null);
  const [publishedIds, setPublishedIds] = useState<Set<string>>(new Set());
  const now = useNow();
  const mainRef = useRef<HTMLElement>(null);

  const toTop = () => mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });

  function finish(id: StepId) {
    setDone((d) => new Set(d).add(id));
  }

  function go(next: StepId, finished?: StepId) {
    if (finished) finish(finished);
    setStep(next);
    setStepStarted(Date.now());
    toTop();
  }

  // The Strategist's run (and a revision round).
  function runStrategist(seconds: number) {
    setPlanReady(false);
    setPlanProgress(0);
    setTopicsPitched(0);
    const t0 = Date.now();
    const id = window.setInterval(() => {
      const p = Math.min((Date.now() - t0) / (seconds * 1000), 1);
      setPlanProgress(p);
      if (p >= 1) {
        window.clearInterval(id);
        setPlanReady(true);
      }
    }, 200);
  }

  // The plan is ready: the Strategist's step is done on the timeline, even before they look.
  useEffect(() => {
    if (planReady && step === "planning") {
      finish("planning");
      setStepStarted(Date.now());
    }
  }, [planReady, step]);

  // Once the plan shows, the Strategist pitches each topic in parallel.
  useEffect(() => {
    if (!planReady) return;
    const timers = PITCH_SECONDS.map((s, i) => window.setTimeout(() => setTopicsPitched((n) => Math.max(n, i + 1)), s * 1000));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [planReady, round]);

  const draftProgress = (p: Pitch) => {
    if (!p.drafted || draftsStart == null) return 0;
    const offset = p.id === "p1" ? 0 : p.id === "p2" ? 3 : 6;
    return Math.min(Math.max((now - draftsStart - offset * 1000) / (DRAFT_SECONDS * 1000), 0), 1);
  };
  const drafted = pitches.filter((p) => p.drafted && decisions[p.id]?.kind !== "rejected");
  const draftsDone = drafted.length > 0 && drafted.every((p) => draftProgress(p) >= 1);
  useEffect(() => {
    if (draftsDone && !done.has("drafts")) finish("drafts");
  }, [draftsDone, done]);

  const firstReady = pitches.find((p) => p.drafted && !publishedIds.has(p.id) && decisions[p.id]?.kind !== "rejected" && draftProgress(p) >= 1);

  function decide(p: Pitch, d: Decision) {
    setDecisions((all) => ({ ...all, [p.id]: d }));
    if (d.kind === "rejected") {
      window.setTimeout(() => setPitches((ps) => [...ps, REPLACEMENT(d.reason, p.topic)]), REPLACE_SECONDS * 1000);
    }
  }

  function openDraft(p: Pitch) {
    setReviewing(p.id);
    toTop();
  }

  function publish() {
    if (!reviewing) return;
    setDecisions((all) => ({ ...all, [reviewing]: { kind: "approved" } }));
    setPublishedIds((s) => new Set(s).add(reviewing));
    setReviewing(null);
    if (!published) {
      setPublished(true);
      finish("pitches");
      finish("publish");
      setStep("publish");
      window.setTimeout(() => setNextOpen(true), 1800);
    }
    toTop();
  }

  function restart() {
    window.location.reload();
  }

  const current = TIMELINE.findIndex((t) => t.id === step);
  const activeIds = new Set<StepId>([step === "planning" && planReady ? "plan" : step]);
  if (step === "pitches" && !draftsDone) activeIds.add("drafts");
  const reviewPitch = reviewing ? pitches.find((p) => p.id === reviewing) ?? null : null;
  const allDone = after === "pipeline" || (published && after === null);

  return (
    <div className="flex h-dvh w-full bg-primary text-primary">
      <DemoNav />
      <main ref={mainRef} className="min-w-0 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-30 bg-primary">
          <PageHeader
            title="Getting started"
            description={`Today, from your answers to your first article on ${TENANT.host}.`}
            actions={<Badge color="gray" size="sm">Demo: example content, waits shortened</Badge>}
          />
        </div>
        <PageBody>
          <PhoneProgress current={current} done={done} />
          <div className="flex flex-col gap-10 lg:flex-row lg:items-start">
            <div className="min-w-0 flex-1">
              {reviewPitch ? (
                <ReviewStep
                  pitch={reviewPitch}
                  first={!published}
                  onBack={() => {
                    setReviewing(null);
                    toTop();
                  }}
                  onPublish={publish}
                />
              ) : (
                <>
                  {step === "business" && <BusinessStep onNext={() => go("strategy", "business")} />}
                  {step === "strategy" && (
                    <StrategyStep
                      onNext={() => {
                        runStrategist(STRATEGIST_SECONDS);
                        go("planning", "strategy");
                      }}
                    />
                  )}
                  {step === "planning" && (
                    <PlanningStep progress={planProgress} ready={planReady} round={round} note={revisionNote} onSee={() => go("plan", "planning")} />
                  )}
                  {step === "plan" && (
                    <PlanStep
                      round={round}
                      topicsPitched={topicsPitched}
                      note={round > 1 ? revisionNote : ""}
                      onApprove={() => {
                        setDraftsStart(Date.now());
                        go("pitches", "plan");
                      }}
                      onRevise={(note) => {
                        setRevisionNote(note);
                        setRound((r) => r + 1);
                        runStrategist(REVISION_SECONDS);
                        setStep("planning");
                        setStepStarted(Date.now());
                        toTop();
                      }}
                    />
                  )}
                  {step === "pitches" && (
                    <PitchesStep
                      pitches={pitches}
                      decisions={decisions}
                      publishedIds={publishedIds}
                      draftProgress={draftProgress}
                      onDecide={decide}
                      firstReady={firstReady ?? null}
                      onOpenDraft={openDraft}
                      continuing={after === "guide"}
                    />
                  )}
                  {step === "publish" && (
                    <PublishedStep
                      after={after}
                      onNext={() => setNextOpen(true)}
                      onRestart={restart}
                    />
                  )}
                </>
              )}
            </div>
            <TodayPanel
              activeIds={activeIds}
              done={allDone ? new Set(TIMELINE.map((t) => t.id)) : done}
              stepStarted={stepStarted}
              started={started}
              now={now}
              onRestart={restart}
            />
          </div>
        </PageBody>
      </main>
      {published && <Confetti />}
      {nextOpen && (
        <NextDialog
          onClose={() => setNextOpen(false)}
          onGuide={() => {
            setNextOpen(false);
            setAfter("guide");
            setStep("pitches");
            setStepStarted(Date.now());
            toTop();
          }}
          onPipeline={() => {
            setNextOpen(false);
            setAfter("pipeline");
            setStep("publish");
            toTop();
          }}
        />
      )}
    </div>
  );
}

function useNow(ms = 500) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

// ---- the shell around it ----

const NAV = [
  { label: "Home", icon: Home01 },
  { label: "Inbox", icon: Inbox01 },
  { label: "Pipeline", icon: Columns03 },
  { label: "Content", icon: File06 },
  { label: "Knowledge base", icon: Database01 },
  { label: "Goals", icon: Target04 },
  { label: "Site", icon: Globe01 },
  { label: "Chat", icon: MessageChatCircle },
  { label: "Connections", icon: Dataflow03 },
];

function DemoNav() {
  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-secondary bg-secondary max-md:hidden">
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
          <span className="grid size-7 place-items-center rounded-md bg-brand-solid text-sm font-semibold text-white">{TENANT.initial}</span>
          <span className="flex-1 truncate text-sm font-medium text-primary">{TENANT.name}</span>
          <ChevronDown className="size-4 text-quaternary" />
        </div>
      </div>
      <div className="px-3 pb-2">
        <div className="flex w-full items-center gap-2 rounded-lg bg-primary px-2.5 py-1.5 text-sm text-quaternary shadow-xs ring-1 ring-inset ring-primary">
          <SearchLg className="size-4 shrink-0" />
          <span className="flex-1 text-left">Search</span>
          <kbd className="shrink-0 rounded border border-secondary bg-secondary px-1 text-xs">⌘K</kbd>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        <ul className="flex flex-col gap-0.5">
          <li>
            <span className="flex w-full items-center gap-2.5 rounded-lg bg-primary px-2.5 py-1.5 text-sm font-medium text-primary shadow-xs ring-1 ring-inset ring-secondary">
              <Rocket02 className="size-4 shrink-0 text-quaternary" />
              <span>Getting started</span>
            </span>
          </li>
          {NAV.map(({ label, icon: Icon }) => (
            <li key={label}>
              <span className="flex w-full cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-secondary">
                <Icon className="size-4 shrink-0 text-quaternary" />
                <span>{label}</span>
              </span>
            </li>
          ))}
        </ul>
      </nav>
      <div className="border-t border-secondary px-2 py-2">
        <span className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-secondary">
          <Settings01 className="size-4 text-quaternary" />
          <span>Settings</span>
        </span>
      </div>
    </aside>
  );
}

// ---- the right panel: today ----

function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function TodayPanel({
  activeIds,
  done,
  stepStarted,
  started,
  now,
  onRestart,
}: {
  activeIds: Set<StepId>;
  done: Set<StepId>;
  stepStarted: number;
  started: number;
  now: number;
  onRestart: () => void;
}) {
  const left = TIMELINE.filter((t) => !done.has(t.id) && !(t.agent && TIMELINE.some((o) => activeIds.has(o.id) && o.id !== t.id && !o.agent)))
    .reduce((n, t) => n + t.minutes, 0);
  const all = done.size === TIMELINE.length;
  return (
    <aside className="w-full shrink-0 max-lg:hidden lg:sticky lg:top-36 lg:w-80">
      <Card>
        <CardHeader
          title="Today with Propaganda"
          description={all ? `Done in ${fmt(now - started)}.` : `About ${left} min left`}
          icon={<Clock className="size-5" />}
        />
        <CardBody>
          <ol className="relative flex flex-col">
            {TIMELINE.map((t, i) => {
              const isDone = done.has(t.id);
              const isActive = !isDone && activeIds.has(t.id);
              return (
                <li key={t.id} className="relative flex gap-3 pb-4 last:pb-0">
                  {i < TIMELINE.length - 1 && (
                    <span className={cx("absolute top-6 left-[11px] h-[calc(100%-1.25rem)] w-px", isDone ? "bg-fg-success-primary/40" : "bg-border-secondary")} />
                  )}
                  <span
                    className={cx(
                      "relative z-10 mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-xs",
                      isDone && "bg-success-solid text-white",
                      isActive && "bg-brand-solid text-white",
                      !isDone && !isActive && "bg-primary text-quaternary ring-1 ring-secondary ring-inset",
                    )}
                  >
                    {isDone ? <Check className="size-3.5" /> : isActive && t.agent ? <Spinner light /> : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cx("text-sm", isActive ? "font-medium text-primary" : isDone ? "text-tertiary" : "text-secondary")}>{t.label}</p>
                    <p className="text-xs text-quaternary">
                      {t.agent ? "Agent · " : ""}
                      {isActive && !t.agent ? `${fmt(now - stepStarted)} so far · ` : ""}~{t.minutes} min
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </CardBody>
        <CardFooter className="flex items-center justify-between">
          <span>Leave any time; this page picks up where you stopped.</span>
        </CardFooter>
      </Card>
      <button type="button" onClick={onRestart} className="mt-3 flex items-center gap-1.5 text-xs text-quaternary hover:text-secondary">
        <RefreshCw01 className="size-3.5" /> Restart the demo
      </button>
    </aside>
  );
}

function PhoneProgress({ current, done }: { current: number; done: Set<StepId> }) {
  const left = TIMELINE.filter((t) => !done.has(t.id)).reduce((n, t) => n + t.minutes, 0);
  return (
    <div className="mb-5 flex items-center justify-between rounded-lg bg-secondary px-3 py-2 text-sm text-secondary lg:hidden">
      <span>
        Step {current + 1} of {TIMELINE.length}: {TIMELINE[current]?.label}
      </span>
      <span className="text-tertiary">~{left} min left</span>
    </div>
  );
}

function Spinner({ light }: { light?: boolean }) {
  return <span className={cx("inline-block size-3 animate-spin rounded-full border-2 border-t-transparent", light ? "border-white" : "border-fg-quaternary")} />;
}

// ---- small parts ----

function StepTitle({ title, lede }: { title: string; lede?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-1">
      <h2 className="font-title text-2xl text-primary">{title}</h2>
      {lede && <p className="text-sm text-tertiary">{lede}</p>}
    </div>
  );
}

function Box({ label, hint, defaultValue, rows = 3, placeholder }: { label: string; hint?: string; defaultValue?: string; rows?: number; placeholder?: string }) {
  return (
    <TextField defaultValue={defaultValue} className="flex flex-col gap-1.5">
      <Label className="text-sm font-medium text-secondary">{label}</Label>
      <TextArea
        rows={rows}
        placeholder={placeholder}
        className="w-full resize-y rounded-lg bg-primary px-3.5 py-2.5 text-md text-primary shadow-xs ring-1 ring-primary outline-none ring-inset placeholder:text-placeholder focus:ring-2 focus:ring-brand"
      />
      {hint && <span className="text-sm text-tertiary">{hint}</span>}
    </TextField>
  );
}

// ---- 1. Your business ----

function StepFooter({ children }: { children: ReactNode }) {
  return <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-secondary pt-5">{children}</div>;
}

function BusinessStep({ onNext }: { onNext: () => void }) {
  return (
    <section className="max-w-2xl">
      <StepTitle title="Your business" lede="Three things to start. Everything else builds on them." />
      <div className="flex flex-col gap-5">
        <Input label="Your business's website" defaultValue={TENANT.website} hint="The site your customers know you by." />
        <Input label="Your business's name" defaultValue={TENANT.name} />
        <NativeSelect
          label="How many posts a month can your team review?"
          hint="We do the writing. The Strategist plans to this number."
          defaultValue="8"
          options={[
            { value: "4", label: "4, about one a week" },
            { value: "8", label: "8, about two a week" },
            { value: "12", label: "12, about three a week" },
            { value: "16+", label: "16 or more" },
          ]}
        />
      </div>
      <StepFooter>
        <span className="text-sm text-tertiary">Next: four questions about your strategy.</span>
        <Button iconTrailing={ArrowRight} onClick={onNext}>
          Continue
        </Button>
      </StepFooter>
    </section>
  );
}

// ---- 2. Strategy questions ----

function StrategyStep({ onNext }: { onNext: () => void }) {
  return (
    <section className="max-w-2xl">
      <StepTitle title="Your strategy" lede="Four questions, then any plan you already have. The Strategist turns it into a plan and your first pitches." />
      <div className="flex flex-col gap-5">
        <Box label="What do you sell, and who buys it?" defaultValue={ANSWERS.offer} />
        <Box label="3 to 5 searches you want to be found by" hint="One per line." defaultValue={ANSWERS.searches} rows={4} />
        <Box label="Competitors and sites worth watching" defaultValue={ANSWERS.watch} rows={3} />
        <Box label="Anything happening in the next three months?" defaultValue={ANSWERS.upcoming} rows={2} />
        <Box label="Already have a content plan?" hint="Paste it, or drop a PDF, doc or image." placeholder="Optional" rows={2} />
      </div>
      <StepFooter>
        <span className="text-sm text-tertiary">The Strategist takes about 3 minutes. You'll set up the rest meanwhile.</span>
        <Button iconLeading={Stars01} onClick={onNext}>
          Write my plan
        </Button>
      </StepFooter>
    </section>
  );
}

// ---- 3. The Strategist works: the plan fills in, the rest is set up meanwhile ----

function PlanningStep({ progress, ready, round, note, onSee }: { progress: number; ready: boolean; round: number; note: string; onSee: () => void }) {
  const stepsDone = ready ? PLANNING_STEPS.length : Math.floor(progress * PLANNING_STEPS.length);
  return (
    <div className="flex flex-col gap-10">
      <section>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
          <StepTitle
            title={ready ? `Your plan is ready${round > 1 ? ` (round ${round})` : ""}` : round > 1 ? `Revising your plan, round ${round} of 5` : "The Strategist is writing your plan"}
            lede={ready ? "Finish what you're typing below, or look now." : "About 3 minutes. It fills in here as it's written."}
          />
          {ready && (
            <Button iconTrailing={ArrowRight} onClick={onSee}>
              See your plan
            </Button>
          )}
        </div>
        {note && (
          <p className="mb-4 text-sm text-secondary">
            <span className="font-medium text-primary">What you asked for: </span>
            {note}
          </p>
        )}
        <div className="mb-3 h-1 overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-brand-solid transition-all duration-300" style={{ width: `${Math.round((ready ? 1 : progress) * 100)}%` }} />
        </div>
        <ul className="mb-8 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
          {PLANNING_STEPS.map((s, i) => (
            <li key={s} className={cx("flex items-center gap-1.5", i < stepsDone ? "text-tertiary" : i === stepsDone ? "text-primary" : "text-quaternary")}>
              {i < stepsDone ? <Check className="size-4 text-fg-success-primary" /> : i === stepsDone ? <Spinner /> : <span className="size-1.5 rounded-full bg-fg-quaternary" />}
              {s}
            </li>
          ))}
        </ul>
        <PlanTakingShape progress={ready ? 1 : progress} />
      </section>

      {round === 1 && <WhileYouWait />}
    </div>
  );
}

/** The plan's outline, filling in as the Strategist gets there. */
function PlanTakingShape({ progress }: { progress: number }) {
  const show = (at: number) => progress >= at;
  return (
    <div className="flex flex-col gap-5">
      {show(0.75) ? (
        <p className="font-serif text-2xl leading-snug text-primary">{SUMMARY}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <Shimmer className="h-6 w-full" />
          <Shimmer className="h-6 w-2/3" />
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        {NUMBERS.map((n, i) => (
          <div key={n.label} className="rounded-xl p-4 ring-1 ring-secondary ring-inset">
            {show(0.45 + i * 0.08) ? (
              <>
                <p className="type-figure text-primary">{n.value}</p>
                <p className="text-sm text-secondary">{n.label}</p>
              </>
            ) : (
              <>
                <Shimmer className="mb-2 h-7 w-12" />
                <Shimmer className="h-4 w-3/4" />
              </>
            )}
          </div>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {TOPICS.map((t, i) => (
          <div key={t.name} className="rounded-xl p-4 ring-1 ring-secondary ring-inset">
            {show(0.6 + i * 0.07) ? (
              <>
                <p className="type-heading text-primary">
                  {i + 1}. {t.name}
                </p>
                <p className="text-sm text-tertiary">{t.range}</p>
              </>
            ) : (
              <>
                <Shimmer className="mb-2 h-5 w-1/2" />
                <Shimmer className="h-4 w-1/4" />
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Shimmer({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded bg-secondary", className)} />;
}

function WhileYouWait() {
  const [hosting, setHosting] = useState<"here" | "elsewhere">("here");
  return (
    <section className="border-t border-secondary pt-8">
      <StepTitle title="While you wait" lede="Four things the Strategist doesn't need. Save each one, or skip it: they all live in Settings later." />
      <div className="flex flex-col gap-4">
        <SaveCard title="Your blog" summary={hosting === "here" ? `Hosted on Propaganda at ${TENANT.host}` : "Lives on another site"}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Choice selected={hosting === "here"} onSelect={() => setHosting("here")} title="Host it on Propaganda" hint={`Live now at ${TENANT.host}. Your own domain any time.`} />
            <Choice selected={hosting === "elsewhere"} onSelect={() => setHosting("elsewhere")} title="It lives somewhere else" hint="Framer, WordPress, Webflow… we publish to it." />
          </div>
        </SaveCard>
        <SaveCard title="Who signs the posts" description="Every post carries a real person's name. Google checks; readers do too." summary="Dana Okafor, Head of Customs Operations">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Name" defaultValue="Dana Okafor" />
            <Input label="Role" defaultValue="Head of Customs Operations" />
          </div>
        </SaveCard>
        <SaveCard title="Your voice" description="Paste a post or a page you like the sound of. The Writer learns from it." summary="1 sample saved">
          <Box label="Something that sounds like you" placeholder="Paste text, or a link to a page" rows={4} />
        </SaveCard>
        <SaveCard title="Where Propaganda listens" description="Calls and Slack are where your best posts come from." summary="Granola connected" saveLabel="Done">
          <div className="flex flex-wrap gap-2">
            {["Granola", "Slack", "A transcript address", "Documents"].map((s) => (
              <Button key={s} color="secondary" size="sm">
                Connect {s}
              </Button>
            ))}
          </div>
        </SaveCard>
      </div>
    </section>
  );
}

/** A setup card with its own Save: once saved it folds to one line, with Edit. */
function SaveCard({
  title,
  description,
  summary,
  saveLabel = "Save",
  children,
}: {
  title: string;
  description?: string;
  summary: string;
  saveLabel?: string;
  children: ReactNode;
}) {
  const [saved, setSaved] = useState(false);
  const [skipped, setSkipped] = useState(false);
  if (saved || skipped) {
    return (
      <div className="flex items-center gap-3 rounded-xl px-5 py-3.5 ring-1 ring-secondary ring-inset">
        {saved ? <CheckCircle className="size-5 text-fg-success-primary" /> : <span className="size-5 rounded-full ring-1 ring-secondary ring-inset" />}
        <span className="text-sm font-medium text-primary">{title}</span>
        <span className="flex-1 truncate text-sm text-tertiary">{saved ? summary : "Skipped for now"}</span>
        <Button
          size="sm"
          color="link-gray"
          onClick={() => {
            setSaved(false);
            setSkipped(false);
          }}
        >
          Edit
        </Button>
      </div>
    );
  }
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody>{children}</CardBody>
      <CardFooter className="flex justify-end gap-2">
        <Button size="sm" color="tertiary" onClick={() => setSkipped(true)}>
          Skip
        </Button>
        <Button size="sm" iconLeading={Check} onClick={() => setSaved(true)}>
          {saveLabel}
        </Button>
      </CardFooter>
    </Card>
  );
}

function Choice({ selected, onSelect, title, hint }: { selected: boolean; onSelect: () => void; title: string; hint: string }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cx("flex flex-col gap-1 rounded-xl p-4 text-left ring-1 ring-inset transition", selected ? "bg-brand-primary ring-brand" : "bg-primary ring-secondary hover:bg-primary_hover")}
    >
      <span className="text-sm font-semibold text-primary">{title}</span>
      <span className="text-xs text-tertiary">{hint}</span>
    </button>
  );
}

// ---- 4. The plan ----

function PlanStep({
  round,
  topicsPitched,
  note,
  onApprove,
  onRevise,
}: {
  round: number;
  topicsPitched: number;
  note: string;
  onApprove: () => void;
  onRevise: (note: string) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [answers, setAnswers] = useState<string[]>(() => QUESTIONS.map(() => ""));
  const [answered, setAnswered] = useState(false);
  const allAnswered = answers.every((a) => a.trim());
  const [ask, setAsk] = useState("");
  const allPitched = topicsPitched >= TOPICS.length;
  return (
    <div className="flex flex-col gap-8 pb-28">
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge color="gray" size="sm">Q4 2026 plan</Badge>
          <Badge color="gray" size="sm">Round {round} of 5</Badge>
          {note && <Badge color="success" size="sm">Your notes applied</Badge>}
        </div>
        <p className="font-serif text-2xl leading-snug text-primary md:text-[28px] md:leading-[36px]">{SUMMARY}</p>
        {note && <p className="mt-3 text-sm text-tertiary">You asked: “{note}”. Changed: topic 4 moved to January, its posts went to topic 1.</p>}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {NUMBERS.map((n) => (
          <NumberTile key={n.label} n={n} />
        ))}
      </div>

      <section>
        <SectionTitle title="Your topics" lede="Up to four, so readers and Google can tell what you're about. Under each, the first posts the Strategist pitched." />
        <div className="grid gap-4 md:grid-cols-2">
          {TOPICS.map((t, i) => (
            <Card key={t.name}>
              <CardHeader title={`${i + 1}. ${t.name}`} description={t.range} />
              <CardBody className="flex flex-col gap-3">
                <p className="text-sm text-secondary">{t.why}</p>
                <div className="border-t border-secondary pt-3">
                  <p className="mb-2 text-xs font-medium tracking-wide text-quaternary uppercase">First pitches</p>
                  {i < topicsPitched ? (
                    <ul className="flex flex-col gap-2">
                      {PITCHES.filter((p) => p.topic === i).map((p) => (
                        <li key={p.id} className="flex items-start gap-2 text-sm">
                          <Edit03 className="mt-0.5 size-4 shrink-0 text-quaternary" />
                          <span className="flex-1 text-primary">{p.title}</span>
                          <Badge color={p.grade === "Strong" ? "success" : "gray"} size="sm">
                            {p.grade}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <p className="flex items-center gap-2 text-sm text-tertiary">
                        <Spinner /> The Strategist is pitching this topic…
                      </p>
                      <div className="h-3 w-4/5 animate-pulse rounded bg-secondary" />
                      <div className="h-3 w-3/5 animate-pulse rounded bg-secondary" />
                    </div>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle title="Your Launch, the first 30 days" lede="15 posts written in 20 days and published over 30, so the blog is never quiet more than 4 days." />
        <LaunchLine />
      </section>

      <section>
        <SectionTitle title="Searches to win" lede="Long-tail first: a new blog ranks slowly. Head terms come later, and we'll say when." />
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-secondary text-left text-xs text-tertiary">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Search</th>
                  <th className="px-3 py-2.5 font-medium">A month</th>
                  <th className="px-3 py-2.5 font-medium">Ranking today</th>
                  <th className="px-5 py-2.5 font-medium">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-secondary">
                {SEARCHES.map((s) => (
                  <tr key={s.query}>
                    <td className="px-5 py-2.5 text-primary">{s.query}</td>
                    <td className="px-3 py-2.5 text-secondary tabular-nums">{s.volume}</td>
                    <td className="px-3 py-2.5 text-tertiary">{s.ranks}</td>
                    <td className="px-5 py-2.5">
                      <Badge color={s.when === "Winnable now" ? "success" : "gray"} size="sm">
                        {s.when}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CardFooter>Volumes and rankings from DataForSEO, US English, this week.</CardFooter>
        </Card>
      </section>

      <section>
        <SectionTitle title="Sites the Scout watches" />
        <div className="flex flex-wrap gap-2">
          {WATCHED.map((w) => (
            <Badge key={w} color="gray" size="md">
              {w}
            </Badge>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle
          title="What it couldn't decide alone"
          lede={answered ? "Sent. The Strategist folded your answers into the plan." : "Answer all three and send them together. Approving unlocks once they're sent."}
        />
        <div className="flex flex-col gap-4">
          {QUESTIONS.map((q, i) =>
            answered ? (
              <div key={q} className="flex gap-2.5 text-sm">
                <CheckCircle className="mt-0.5 size-4 shrink-0 text-fg-success-primary" />
                <div>
                  <p className="text-secondary">{q}</p>
                  <p className="mt-0.5 text-primary">{answers[i]}</p>
                </div>
              </div>
            ) : (
              <TextField key={q} value={answers[i]} onChange={(v) => setAnswers((a) => a.map((x, j) => (j === i ? v : x)))} className="flex flex-col gap-1.5">
                <Label className="text-sm font-medium text-secondary">{q}</Label>
                <TextArea
                  rows={2}
                  placeholder="Your answer"
                  className="w-full resize-y rounded-lg bg-primary px-3.5 py-2.5 text-md text-primary shadow-xs ring-1 ring-primary outline-none ring-inset placeholder:text-placeholder focus:ring-2 focus:ring-brand"
                />
              </TextField>
            ),
          )}
          {!answered && (
            <div>
              <Button size="sm" isDisabled={!allAnswered} onClick={() => setAnswered(true)}>
                Send answers
              </Button>
            </div>
          )}
        </div>
      </section>

      <div className="fixed right-0 bottom-0 left-0 z-20 border-t border-secondary bg-primary/95 backdrop-blur md:left-[260px]">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center gap-3 px-4 py-3 md:px-8">
          {asking ? (
            <>
              <input
                autoFocus
                value={ask}
                onChange={(e) => setAsk(e.target.value)}
                placeholder="What should change? e.g. Peak season can wait for January."
                className="min-w-[16rem] flex-1 rounded-lg bg-primary px-3.5 py-2 text-sm text-primary shadow-xs ring-1 ring-primary outline-none ring-inset focus:ring-2 focus:ring-brand"
              />
              <Button color="tertiary" size="sm" onClick={() => setAsking(false)}>
                Cancel
              </Button>
              <Button size="sm" isDisabled={!ask.trim() || round >= 5} onClick={() => onRevise(ask.trim())}>
                Send to the Strategist
              </Button>
            </>
          ) : (
            <>
              <span className="text-sm text-tertiary">
                Round {round} of 5 · {allPitched ? "10 pitches ready" : "pitches on their way"}
                {!answered && " · Answer its 3 questions to approve"}
              </span>
              <div className="ml-auto flex gap-2">
                <Button color="secondary" size="sm" isDisabled={round >= 5} onClick={() => setAsking(true)}>
                  Ask for changes
                </Button>
                <Button size="sm" iconTrailing={ArrowRight} isDisabled={!answered} onClick={onApprove}>
                  Approve plan
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ title, lede }: { title: string; lede?: string }) {
  return (
    <div className="mb-3">
      <h3 className="type-heading text-primary">{title}</h3>
      {lede && <p className="mt-0.5 text-sm text-tertiary">{lede}</p>}
    </div>
  );
}

function NumberTile({ n }: { n: (typeof NUMBERS)[number] }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardBody className="flex flex-col gap-1">
        <span className="type-figure text-primary">{n.value}</span>
        <span className="text-sm text-secondary">{n.label}</span>
        <button type="button" onClick={() => setOpen((o) => !o)} className="mt-2 flex items-center gap-1 self-start text-xs text-tertiary hover:text-secondary">
          Why <ChevronDown className={cx("size-3.5 transition", open && "rotate-180")} />
        </button>
        {open && (
          <div className="mt-1 flex flex-col gap-1.5 text-sm">
            <p className="text-secondary">{n.why}</p>
            <p className="text-xs text-quaternary">From: {n.basis}</p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function LaunchLine() {
  const batches = [1, 8, 15];
  const publish = [3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 30];
  return (
    <Card>
      <CardBody className="py-6">
        <div className="relative h-14">
          <div className="absolute top-6 right-0 left-0 h-px bg-border-primary" />
          {batches.map((d, i) => (
            <div key={d} className="absolute top-0 flex -translate-x-1/2 flex-col items-center" style={{ left: `${((d - 1) / 29) * 100}%` }}>
              <span className="mb-1 text-xs whitespace-nowrap text-secondary">Batch {i + 1}</span>
              <span className="size-3 rounded-full bg-brand-solid ring-4 ring-primary" />
            </div>
          ))}
          {publish.map((d) => (
            <span key={d} className="absolute top-[22px] size-2 -translate-x-1/2 rounded-full bg-fg-quaternary" style={{ left: `${((d - 1) / 29) * 100}%` }} />
          ))}
          <div className="absolute top-9 left-0 text-xs text-quaternary">Today</div>
          <div className="absolute top-9 right-0 text-xs text-quaternary">Day 30</div>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-tertiary">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-brand-solid" /> Batch of pitches
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-fg-quaternary" /> A post goes live
          </span>
        </div>
      </CardBody>
    </Card>
  );
}

// ---- 5. Pitches (and the drafts behind them) ----

function PitchesStep({
  pitches,
  decisions,
  publishedIds,
  draftProgress,
  onDecide,
  firstReady,
  onOpenDraft,
  continuing,
}: {
  pitches: Pitch[];
  decisions: Record<string, Decision>;
  publishedIds: Set<string>;
  draftProgress: (p: Pitch) => number;
  onDecide: (p: Pitch, d: Decision) => void;
  firstReady: Pitch | null;
  onOpenDraft: (p: Pitch) => void;
  continuing: boolean;
}) {
  const approved = Object.values(decisions).filter((d) => d.kind === "approved").length;
  const rejected = Object.values(decisions).filter((d) => d.kind === "rejected").length;
  const waiting = pitches.filter((p) => !decisions[p.id]).length;
  const [open, setOpen] = useState<string | null>(continuing ? null : "p1");
  return (
    <div className="flex flex-col gap-5">
      <StepTitle
        title={continuing ? "The rest of your first batch" : "Your first pitches"}
        lede={
          continuing
            ? "Review the drafts that are ready and decide on the pitches left. Everything you skip waits in the Pipeline."
            : "The Strategist pitched these with your plan. Approve the ones you'd publish; a reason on a rejection shapes the next one. The 3 strongest are already being written."
        }
      />
      <div className="flex flex-wrap gap-2 text-sm">
        <Badge color="success" size="md">{approved} approved</Badge>
        <Badge color="gray" size="md">{rejected} rejected</Badge>
        <Badge color="gray" size="md">{waiting} waiting</Badge>
        {publishedIds.size > 0 && <Badge color="gray" size="md">{publishedIds.size} published</Badge>}
      </div>

      {firstReady && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-secondary px-4 py-3">
          <CheckCircle className="size-5 text-fg-success-primary" />
          <span className="flex-1 text-sm text-primary">
            {publishedIds.size ? "A draft is ready" : "Your first draft is ready"}: <span className="font-medium">{firstReady.title}</span>
          </span>
          <Button size="sm" iconTrailing={ArrowRight} onClick={() => onOpenDraft(firstReady)}>
            Open the draft
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {pitches.map((p) => (
          <PitchCard
            key={p.id}
            p={p}
            decision={decisions[p.id]}
            published={publishedIds.has(p.id)}
            draft={draftProgress(p)}
            open={open === p.id}
            onToggle={() => setOpen((o) => (o === p.id ? null : p.id))}
            onDecide={(d) => onDecide(p, d)}
            onOpenDraft={() => onOpenDraft(p)}
          />
        ))}
      </div>
    </div>
  );
}

function PitchCard({
  p,
  decision,
  published,
  draft,
  open,
  onToggle,
  onDecide,
  onOpenDraft,
}: {
  p: Pitch;
  decision?: Decision;
  published: boolean;
  draft: number;
  open: boolean;
  onToggle: () => void;
  onDecide: (d: Decision) => void;
  onOpenDraft: () => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const dropped = p.drafted && decision?.kind === "rejected";
  return (
    <Card className={cx(decision && !published && "opacity-80")}>
      <div className="flex w-full items-start gap-3 px-5 py-4">
        <button type="button" onClick={onToggle} className="min-w-0 flex-1 text-left">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-tertiary">
            <span>{TOPICS[p.topic].name}</span>
            <Badge color={p.grade === "Strong" ? "success" : "gray"} size="sm">
              {p.grade}
            </Badge>
            {p.learned && <Badge color="brand" size="sm">New</Badge>}
          </div>
          <p className="type-heading text-primary">{p.title}</p>
          <p className="mt-1 text-sm text-secondary">{p.why}</p>
          {p.learned && <p className="mt-1 text-sm text-tertiary italic">{p.learned}</p>}
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {published && <Badge color="success" size="sm">Published</Badge>}
          {!published && decision?.kind === "approved" && <Badge color="success" size="sm">Approved</Badge>}
          {decision?.kind === "rejected" && <Badge color="gray" size="sm">Rejected</Badge>}
          {decision?.kind === "later" && <Badge color="gray" size="sm">Not now</Badge>}
          <button type="button" onClick={onToggle} aria-label={open ? "Collapse" : "Expand"}>
            <ChevronDown className={cx("size-4 text-quaternary transition", open && "rotate-180")} />
          </button>
        </div>
      </div>
      {p.drafted && !dropped && !published && (
        <div className="-mt-1 px-5 pb-4">
          {draft >= 1 ? (
            <button
              type="button"
              onClick={onOpenDraft}
              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium text-primary ring-1 ring-secondary ring-inset hover:bg-primary_hover"
            >
              <CheckCircle className="size-4 text-fg-success-primary" /> Draft ready: open it <ArrowRight className="size-4 text-quaternary" />
            </button>
          ) : (
            <p className="flex items-center gap-2 text-xs text-tertiary">
              <Spinner /> The Writer is drafting it · {Math.round(draft * 100)}%
              <span className="h-1 w-24 overflow-hidden rounded-full bg-secondary">
                <span className="block h-full bg-brand-solid" style={{ width: `${Math.round(draft * 100)}%` }} />
              </span>
            </p>
          )}
        </div>
      )}
      {dropped && <p className="-mt-1 px-5 pb-4 text-xs text-quaternary">Draft dropped.</p>}
      {open && (
        <>
          <div className="grid gap-4 border-t border-secondary px-5 py-4 text-sm md:grid-cols-2">
            <div className="flex flex-col gap-3">
              <Field label="Angle">{p.angle}</Field>
              <Field label="Audience">{p.audience}</Field>
              <Field label="Sources">{p.sources.join(" · ")}</Field>
            </div>
            <Field label="Outline">
              <ol className="list-decimal space-y-1 pl-4">
                {p.outline.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ol>
            </Field>
          </div>
          {!decision && (
            <div className="flex flex-wrap items-center gap-2 border-t border-secondary px-5 py-3">
              {rejecting ? (
                <>
                  <input
                    autoFocus
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why not? Your reason shapes the replacement."
                    className="min-w-[14rem] flex-1 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary shadow-xs ring-1 ring-primary outline-none ring-inset focus:ring-2 focus:ring-brand"
                  />
                  <Button size="sm" color="tertiary" onClick={() => setRejecting(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" color="secondary" isDisabled={!reason.trim()} onClick={() => onDecide({ kind: "rejected", reason: reason.trim() })}>
                    Reject
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" iconLeading={Check} onClick={() => onDecide({ kind: "approved" })}>
                    Approve
                  </Button>
                  <Button size="sm" color="secondary" iconLeading={XClose} onClick={() => setRejecting(true)}>
                    Reject
                  </Button>
                  <Button size="sm" color="tertiary" onClick={() => onDecide({ kind: "later" })}>
                    Not now
                  </Button>
                </>
              )}
            </div>
          )}
          {decision?.kind === "rejected" && (
            <p className="border-t border-secondary px-5 py-3 text-sm text-tertiary">“{decision.reason}”. The Strategist is writing a replacement.</p>
          )}
        </>
      )}
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium tracking-wide text-quaternary uppercase">{label}</p>
      <div className="text-secondary">{children}</div>
    </div>
  );
}

// ---- 6. Review a draft (the editor's Review tab, in the real build) ----

function ReviewStep({ pitch, first, onBack, onPublish }: { pitch: Pitch; first: boolean; onBack: () => void; onPublish: () => void }) {
  const isPillar = pitch.id === "p1";
  return (
    <div className="flex flex-col gap-6">
      <button type="button" onClick={onBack} className="flex items-center gap-1.5 self-start text-sm text-tertiary hover:text-primary">
        <ArrowLeft className="size-4" /> Back to Getting started
      </button>
      <StepTitle title={first ? "Your first article" : "Review the draft"} lede="Read it as a reader would. Approve, or send it back with a note." />

      <div className="grid gap-6 text-sm md:grid-cols-2">
        <Field label="Your notes on the pitch">
          <ul className="list-disc space-y-1 pl-4">
            {ARTICLE.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Field>
        <Field label="The Writer's checks">
          <p>House rules: all clear.</p>
          <p className="mt-1">{isPillar ? "1 number to confirm, highlighted below." : "Nothing to confirm."}</p>
        </Field>
      </div>

      <article className="max-w-[680px] border-t border-secondary pt-8 font-serif">
        <p className="mb-2 font-sans text-xs tracking-wide text-quaternary uppercase">{ARTICLE.collection}</p>
        <h1 className="text-3xl leading-tight text-primary">{pitch.title}</h1>
        <p className="mt-3 font-sans text-sm text-tertiary">By {ARTICLE.byline}</p>
        <div className="mt-6 flex flex-col gap-4 text-lg leading-relaxed text-secondary">
          {(isPillar ? ARTICLE.paragraphs : [{ h: null, t: pitch.angle }, ...pitch.outline.map((o) => ({ h: o, t: "The Writer's section, from the outline, with its sources linked." }))]).map((p, i) => (
            <div key={i}>
              {p.h && <h2 className="mt-2 mb-2 text-xl text-primary">{p.h}</h2>}
              <p>
                {isPillar && p.t.includes(ARTICLE.flagged) ? (
                  <>
                    <mark className="rounded bg-warning-secondary px-0.5 text-primary">{ARTICLE.flagged}</mark>
                    {p.t.replace(ARTICLE.flagged, "")}
                  </>
                ) : (
                  p.t
                )}
              </p>
            </div>
          ))}
        </div>
      </article>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-secondary bg-primary/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
        <Button color="tertiary">Send back with a note</Button>
        <Button color="secondary">Approve, publish on schedule</Button>
        <Button iconLeading={Rocket02} onClick={onPublish}>
          Approve and publish now
        </Button>
      </div>
    </div>
  );
}

// ---- 7. Published ----

function PublishedStep({ after, onNext, onRestart }: { after: "guide" | "pipeline" | null; onNext: () => void; onRestart: () => void }) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DOMAIN_STRIP_KEY) === "1";
    } catch {
      return false;
    }
  });
  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(DOMAIN_STRIP_KEY, "1");
    } catch {
      // Private window: dismissed for this visit only.
    }
  }
  return (
    <div className="flex flex-col gap-8">
      {!dismissed && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-secondary px-4 py-3">
          <Globe01 className="size-5 text-fg-quaternary" />
          <span className="flex-1 text-sm text-secondary">
            Put your blog on your own domain: <span className="font-medium text-primary">blog.harborlight.example</span> instead of {TENANT.host}.
          </span>
          <Button size="sm" color="secondary">
            Set up domain
          </Button>
          <button type="button" aria-label="Dismiss for good" onClick={dismiss} className="rounded p-1 text-quaternary hover:bg-primary_hover hover:text-secondary">
            <XClose className="size-4" />
          </button>
        </div>
      )}

      <section className="flex flex-col items-center gap-4 py-10 text-center">
        <span className="grid size-14 place-items-center rounded-full bg-success-secondary">
          <CheckCircle className="size-7 text-fg-success-primary" />
        </span>
        <h2 className="font-title text-3xl text-primary">{after === "pipeline" ? "You're all set" : "Your first article is live"}</h2>
        <p className="max-w-md text-sm text-tertiary">{ARTICLE.title}</p>
        <a
          href={ARTICLE.url}
          onClick={(e) => e.preventDefault()}
          className="flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 font-mono text-sm text-primary ring-1 ring-secondary ring-inset hover:bg-primary_hover"
        >
          {ARTICLE.url.replace("https://", "")} <LinkExternal01 className="size-4 text-quaternary" />
        </a>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {after === "pipeline" ? (
            <Button iconTrailing={ArrowRight}>Go to the Pipeline</Button>
          ) : (
            <Button color="secondary" iconTrailing={ArrowRight} onClick={onNext}>
              What happens next
            </Button>
          )}
        </div>
      </section>

      <button type="button" onClick={onRestart} className="self-center text-xs text-quaternary hover:text-secondary">
        Restart the demo
      </button>
    </div>
  );
}

// "What happens next": what's waiting, where it lives, and two ways on.
function NextDialog({ onClose, onGuide, onPipeline }: { onClose: () => void; onGuide: () => void; onPipeline: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-overlay/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-[760px] max-w-full rounded-2xl bg-primary shadow-2xl ring-1 ring-secondary">
        <div className="flex items-start justify-between gap-4 border-b border-secondary px-6 py-5">
          <div>
            <h2 className="type-title text-primary">What happens next</h2>
            <p className="mt-1 text-sm text-tertiary">Your first article is live. The rest of your first batch is waiting for you.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded p-1 text-quaternary hover:bg-primary_hover hover:text-secondary">
            <XClose className="size-5" />
          </button>
        </div>

        <div className="grid gap-6 px-6 py-5 md:grid-cols-[1fr_1.1fr]">
          <ul className="flex flex-col gap-3 text-sm text-secondary">
            <li className="flex gap-2.5">
              <Check className="mt-0.5 size-4 shrink-0 text-fg-success-primary" />
              <span>
                <span className="font-medium text-primary">2 drafts</span> are ready for your review, and <span className="font-medium text-primary">7 pitches</span> wait for a yes or no.
              </span>
            </li>
            <li className="flex gap-2.5">
              <Check className="mt-0.5 size-4 shrink-0 text-fg-success-primary" />
              <span>Everything lives in the <span className="font-medium text-primary">Pipeline</span>: pitches, then writing, then review, then published.</span>
            </li>
            <li className="flex gap-2.5">
              <Check className="mt-0.5 size-4 shrink-0 text-fg-success-primary" />
              <span>
                <span className="font-medium text-primary">Batch 2 arrives Monday morning</span>, written after what you approved and rejected today.
              </span>
            </li>
            <li className="flex gap-2.5">
              <Check className="mt-0.5 size-4 shrink-0 text-fg-success-primary" />
              <span>Your Launch card on Home tracks the 30 days: 1 of 15 live.</span>
            </li>
            <li className="mt-1 rounded-lg bg-secondary px-3 py-2.5 text-primary">
              <span className="font-medium">What to do:</span> approve what you'd publish, reject with a reason, and open each draft when it's ready. A few minutes a day is enough.
            </li>
          </ul>
          <PipelineIllustration />
        </div>

        <div className="grid gap-4 border-t border-secondary px-6 py-5 sm:grid-cols-2">
          <ChoiceTile
            icon={<Rocket02 className="size-6" />}
            title="Continue the first batch now"
            body="Stay in this guide: 2 drafts and 7 pitches. About 15 minutes."
            primary
            onClick={onGuide}
          />
          <ChoiceTile
            icon={<Columns03 className="size-6" />}
            title="I got it"
            body="Put everything in the Pipeline. I'll handle it later."
            onClick={onPipeline}
          />
        </div>
      </div>
    </div>
  );
}

function ChoiceTile({ icon, title, body, primary, onClick }: { icon: ReactNode; title: string; body: string; primary?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex aspect-square max-h-56 w-full flex-col justify-between rounded-xl p-5 text-left ring-1 ring-inset transition sm:aspect-auto sm:h-48",
        primary ? "bg-brand-solid text-white ring-transparent hover:bg-brand-solid_hover" : "bg-primary ring-secondary hover:bg-primary_hover",
      )}
    >
      <span className={cx(primary ? "text-white" : "text-fg-quaternary")}>{icon}</span>
      <span>
        <span className={cx("block text-lg font-semibold", primary ? "text-white" : "text-primary")}>{title}</span>
        <span className={cx("mt-1 block text-sm", primary ? "text-white/80" : "text-tertiary")}>{body}</span>
      </span>
    </button>
  );
}

/** A small, real-HTML picture of the Pipeline board with today's work in it. */
function PipelineIllustration() {
  const cols: { name: string; cards: { t: string; dim?: boolean; tag?: string }[] }[] = [
    { name: "Pitched", cards: [{ t: "Free time is not free" }, { t: "Exam holds, explained" }, { t: "+5 more", dim: true }] },
    { name: "Writing", cards: [{ t: "Container tracking without a TMS", tag: "Writer" }] },
    { name: "Review", cards: [{ t: "Detention charges explained" }, { t: "How long does customs take?" }] },
    { name: "Live", cards: [{ t: "What demurrage really costs", tag: "Today" }] },
  ];
  return (
    <div aria-hidden className="rounded-xl bg-secondary p-3 ring-1 ring-secondary ring-inset">
      <div className="mb-2 flex items-center gap-1.5 px-1 text-xs font-medium text-tertiary">
        <Columns03 className="size-3.5" /> Pipeline
      </div>
      <div className="grid grid-cols-4 gap-2">
        {cols.map((c) => (
          <div key={c.name} className="flex flex-col gap-1.5">
            <p className="px-1 text-[10px] font-medium tracking-wide text-quaternary uppercase">{c.name}</p>
            {c.cards.map((card) => (
              <div
                key={card.t}
                className={cx(
                  "rounded-md bg-primary p-1.5 text-[10px] leading-tight shadow-xs ring-1 ring-secondary ring-inset",
                  card.dim ? "text-quaternary" : "text-secondary",
                )}
              >
                {card.t}
                {card.tag && <span className="mt-1 block text-[9px] text-quaternary">{card.tag}</span>}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// Confetti in the app's own neutrals (no accent colours in the product).
function Confetti() {
  const pieces = useRef(
    Array.from({ length: 120 }, (_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 0.6,
      duration: 2.4 + Math.random() * 1.8,
      size: 6 + Math.random() * 6,
      rotate: Math.random() * 360,
      shade: ["#0a0a0a", "#404040", "#737373", "#a3a3a3", "#d4d4d4"][i % 5],
      round: i % 3 === 0,
    })),
  ).current;
  const [show, setShow] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setShow(false), 4500);
    return () => window.clearTimeout(t);
  }, []);
  if (!show) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      <style>{`@keyframes demo-confetti{0%{transform:translateY(-10vh) rotate(0)}100%{transform:translateY(110vh) rotate(720deg)}}`}</style>
      {pieces.map((p, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            top: 0,
            left: `${p.left}%`,
            width: p.size,
            height: p.round ? p.size : p.size * 0.45,
            background: p.shade,
            borderRadius: p.round ? "9999px" : "1px",
            transform: `rotate(${p.rotate}deg)`,
            animation: `demo-confetti ${p.duration}s ${p.delay}s cubic-bezier(.2,.6,.4,1) forwards`,
          }}
        />
      ))}
    </div>
  );
}
