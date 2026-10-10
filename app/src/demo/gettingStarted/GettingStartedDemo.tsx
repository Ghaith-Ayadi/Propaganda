// The Getting started page as a clickable demo, on example content
// (onboarding/first-day-flow.md in the project files). UI preview builds only
// (VITE_UI_PREVIEW, `npm run dev:ui`), at /_demo/getting-started: App.tsx
// never loads it otherwise, so nothing here can reach production.
//
// Nothing talks to a server. The agents' waits are shortened and simulated;
// the shell around the page (nav) is a static copy of the real one.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Label, TextArea, TextField } from "react-aria-components";
import {
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

  // Background work: the plan, the pitches and the drafts arrive on their own.
  const [planReady, setPlanReady] = useState(false);
  const [planProgress, setPlanProgress] = useState(0);
  const [topicsPitched, setTopicsPitched] = useState(0);
  const [pitches, setPitches] = useState<Pitch[]>(PITCHES);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [draftsStart, setDraftsStart] = useState<number | null>(null);
  const now = useNow();

  function go(next: StepId, finished?: StepId) {
    if (finished) setDone((d) => new Set(d).add(finished));
    setStep(next);
    setStepStarted(Date.now());
    window.scrollTo({ top: 0, behavior: "smooth" });
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
    if (draftsDone && !done.has("drafts")) setDone((d) => new Set(d).add("drafts"));
  }, [draftsDone, done]);

  const firstReady = pitches.find((p) => p.drafted && decisions[p.id]?.kind === "approved" && draftProgress(p) >= 1);

  function decide(p: Pitch, d: Decision) {
    setDecisions((all) => ({ ...all, [p.id]: d }));
    if (d.kind === "rejected") {
      window.setTimeout(() => setPitches((ps) => [...ps, REPLACEMENT(d.reason, p.topic)]), REPLACE_SECONDS * 1000);
    }
  }

  function restart() {
    window.location.reload();
  }

  const current = TIMELINE.findIndex((t) => t.id === step);
  // The Writer's step is "current" alongside the pitches once drafting starts.
  const activeIds = new Set<StepId>([step]);
  if (step === "pitches" && !draftsDone) activeIds.add("drafts");

  return (
    <div className="flex h-dvh w-full bg-primary text-primary">
      <DemoNav />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <PageHeader
          title="Getting started"
          description={`Today, from your answers to your first article on ${TENANT.host}.`}
          actions={<Badge color="gray" size="sm">Demo: example content, waits shortened</Badge>}
        />
        <PageBody>
          <PhoneProgress current={current} done={done} />
          <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
            <div className="min-w-0 flex-1">
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
                <PlanningStep
                  progress={planProgress}
                  ready={planReady}
                  round={round}
                  note={revisionNote}
                  onSee={() => go("plan", "planning")}
                />
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
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                />
              )}
              {step === "pitches" && (
                <PitchesStep
                  pitches={pitches}
                  decisions={decisions}
                  draftProgress={draftProgress}
                  onDecide={decide}
                  firstReady={firstReady ?? null}
                  onReview={() => go("publish", "pitches")}
                />
              )}
              {step === "publish" &&
                (published ? (
                  <PublishedStep onRestart={restart} />
                ) : (
                  <ReviewStep onPublish={() => setPublished(true)} />
                ))}
            </div>
            <TodayPanel
              activeIds={activeIds}
              done={published ? new Set(TIMELINE.map((t) => t.id)) : done}
              stepStarted={stepStarted}
              started={started}
              now={now}
              onRestart={restart}
            />
          </div>
        </PageBody>
      </main>
      {published && <Confetti />}
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
    <aside className="w-full shrink-0 max-lg:hidden lg:sticky lg:top-6 lg:w-80">
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

function BusinessStep({ onNext }: { onNext: () => void }) {
  return (
    <Card>
      <CardBody className="flex flex-col gap-5 py-6">
        <StepTitle title="Your business" lede="Three things to start. Everything else builds on them." />
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
      </CardBody>
      <CardFooter className="flex justify-end">
        <Button iconTrailing={ArrowRight} onClick={onNext}>
          Continue
        </Button>
      </CardFooter>
    </Card>
  );
}

// ---- 2. Strategy questions ----

function StrategyStep({ onNext }: { onNext: () => void }) {
  return (
    <Card>
      <CardBody className="flex flex-col gap-5 py-6">
        <StepTitle title="Your strategy" lede="Four questions, then any plan you already have. The Strategist turns it into a plan and your first pitches." />
        <Box label="What do you sell, and who buys it?" defaultValue={ANSWERS.offer} />
        <Box label="3 to 5 searches you want to be found by" hint="One per line." defaultValue={ANSWERS.searches} rows={4} />
        <Box label="Competitors and sites worth watching" defaultValue={ANSWERS.watch} rows={3} />
        <Box label="Anything happening in the next three months?" defaultValue={ANSWERS.upcoming} rows={2} />
        <Box label="Already have a content plan?" hint="Paste it, or drop a PDF, doc or image." placeholder="Optional" rows={2} />
      </CardBody>
      <CardFooter className="flex items-center justify-between gap-3">
        <span>The Strategist takes about 3 minutes. You'll set up the rest meanwhile.</span>
        <Button iconLeading={Stars01} onClick={onNext}>
          Write my plan
        </Button>
      </CardFooter>
    </Card>
  );
}

// ---- 3. The Strategist works; the person sets up the rest ----

function PlanningStep({ progress, ready, round, note, onSee }: { progress: number; ready: boolean; round: number; note: string; onSee: () => void }) {
  const stepsDone = Math.floor(progress * PLANNING_STEPS.length);
  const [hosting, setHosting] = useState<"here" | "elsewhere">("here");
  return (
    <div className="flex flex-col gap-6">
      <Card className={cx(ready && "ring-2 ring-brand")}>
        <CardHeader
          icon={ready ? <CheckCircle className="size-5 text-fg-success-primary" /> : <Stars01 className="size-5" />}
          title={ready ? `Your plan is ready${round > 1 ? ` (round ${round})` : ""}` : round > 1 ? `The Strategist is revising your plan (round ${round} of 5)` : "The Strategist is writing your plan"}
          description={ready ? "Finish what you're typing, or look now." : round > 1 ? "About 3 minutes." : "About 3 minutes. Set up the rest below meanwhile."}
          actions={
            ready ? (
              <Button iconTrailing={ArrowRight} onClick={onSee}>
                See your plan
              </Button>
            ) : undefined
          }
        />
        <CardBody>
          {note && (
            <p className="mb-3 rounded-lg bg-secondary px-3 py-2 text-sm text-secondary">
              <span className="font-medium text-primary">What you asked for: </span>
              {note}
            </p>
          )}
          <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-secondary">
            <div className="h-full rounded-full bg-brand-solid transition-all duration-300" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <ul className="flex flex-col gap-1.5 text-sm">
            {PLANNING_STEPS.map((s, i) => (
              <li key={s} className={cx("flex items-center gap-2", i < stepsDone || ready ? "text-secondary" : i === stepsDone ? "text-primary" : "text-quaternary")}>
                {i < stepsDone || ready ? <Check className="size-4 text-fg-success-primary" /> : i === stepsDone ? <Spinner /> : <span className="size-4" />}
                {s}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      {round === 1 && (
        <>
          <p className="text-xs font-medium tracking-wide text-quaternary uppercase">While you wait</p>
          <Card>
            <CardHeader title="Your blog" description="Where readers find what Propaganda writes." />
            <CardBody className="grid gap-3 sm:grid-cols-2">
              <Choice selected={hosting === "here"} onSelect={() => setHosting("here")} title="Host it on Propaganda" hint={`Live now at ${TENANT.host}. Your own domain any time.`} />
              <Choice selected={hosting === "elsewhere"} onSelect={() => setHosting("elsewhere")} title="It lives somewhere else" hint="Framer, WordPress, Webflow… we publish to it." />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Who signs the posts" description="Every post carries a real person's name. Google checks; readers do too." />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <Input label="Name" defaultValue="Dana Okafor" />
              <Input label="Role" defaultValue="Head of Customs Operations" />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Your voice" description="Paste a post or a page you like the sound of. The Writer learns from it." />
            <CardBody>
              <Box label="Something that sounds like you" placeholder="Paste text, or a link to a page" rows={4} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Where Propaganda listens" description="Calls and Slack are where your best posts come from. Connect them now or later." />
            <CardBody className="flex flex-wrap gap-2">
              {["Granola", "Slack", "A transcript address", "Documents"].map((s) => (
                <Button key={s} color="secondary" size="sm">
                  Connect {s}
                </Button>
              ))}
            </CardBody>
          </Card>
        </>
      )}
    </div>
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
        <SectionTitle title="What it couldn't decide alone" lede="Answer here. Your answers count as feedback for the next round." />
        <div className="flex flex-col gap-4">
          {QUESTIONS.map((q) => (
            <Box key={q} label={q} rows={2} placeholder="Your answer" />
          ))}
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
              </span>
              <div className="ml-auto flex gap-2">
                <Button color="secondary" size="sm" isDisabled={round >= 5} onClick={() => setAsking(true)}>
                  Ask for changes
                </Button>
                <Button size="sm" iconTrailing={ArrowRight} onClick={onApprove}>
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
  draftProgress,
  onDecide,
  firstReady,
  onReview,
}: {
  pitches: Pitch[];
  decisions: Record<string, Decision>;
  draftProgress: (p: Pitch) => number;
  onDecide: (p: Pitch, d: Decision) => void;
  firstReady: Pitch | null;
  onReview: () => void;
}) {
  const approved = Object.values(decisions).filter((d) => d.kind === "approved").length;
  const rejected = Object.values(decisions).filter((d) => d.kind === "rejected").length;
  const waiting = pitches.filter((p) => !decisions[p.id]).length;
  const [open, setOpen] = useState<string | null>("p1");
  const sorted = useMemo(() => pitches, [pitches]);
  return (
    <div className="flex flex-col gap-5">
      <StepTitle
        title="Your first pitches"
        lede="The Strategist pitched these with your plan. Approve the ones you'd publish; a reason on a rejection shapes the next one. The 3 strongest are already being written."
      />
      <div className="flex flex-wrap gap-2 text-sm">
        <Badge color="success" size="md">{approved} approved</Badge>
        <Badge color="gray" size="md">{rejected} rejected</Badge>
        <Badge color="gray" size="md">{waiting} waiting</Badge>
      </div>

      {firstReady && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-brand-primary px-4 py-3 ring-1 ring-brand ring-inset">
          <CheckCircle className="size-5 text-fg-success-primary" />
          <span className="flex-1 text-sm text-primary">
            Your first draft is ready: <span className="font-medium">{firstReady.title}</span>
          </span>
          <Button size="sm" iconTrailing={ArrowRight} onClick={onReview}>
            Review it
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {sorted.map((p) => (
          <PitchCard
            key={p.id}
            p={p}
            decision={decisions[p.id]}
            draft={draftProgress(p)}
            open={open === p.id}
            onToggle={() => setOpen((o) => (o === p.id ? null : p.id))}
            onDecide={(d) => onDecide(p, d)}
          />
        ))}
      </div>
    </div>
  );
}

function PitchCard({
  p,
  decision,
  draft,
  open,
  onToggle,
  onDecide,
}: {
  p: Pitch;
  decision?: Decision;
  draft: number;
  open: boolean;
  onToggle: () => void;
  onDecide: (d: Decision) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const dropped = p.drafted && decision?.kind === "rejected";
  return (
    <Card className={cx(decision && "opacity-80")}>
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-3 px-5 py-4 text-left">
        <div className="min-w-0 flex-1">
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
          {p.drafted && !dropped && (
            <div className="mt-3 flex items-center gap-2 text-xs text-tertiary">
              {draft >= 1 ? (
                <>
                  <CheckCircle className="size-4 text-fg-success-primary" /> Draft ready
                </>
              ) : (
                <>
                  <Spinner /> The Writer is drafting it · {Math.round(draft * 100)}%
                  <span className="h-1 w-24 overflow-hidden rounded-full bg-secondary">
                    <span className="block h-full bg-brand-solid" style={{ width: `${Math.round(draft * 100)}%` }} />
                  </span>
                </>
              )}
            </div>
          )}
          {dropped && <p className="mt-3 text-xs text-quaternary">Draft dropped.</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {decision?.kind === "approved" && <Badge color="success" size="sm">Approved</Badge>}
          {decision?.kind === "rejected" && <Badge color="gray" size="sm">Rejected</Badge>}
          {decision?.kind === "later" && <Badge color="gray" size="sm">Not now</Badge>}
          <ChevronDown className={cx("size-4 text-quaternary transition", open && "rotate-180")} />
        </div>
      </button>
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
            <p className="border-t border-secondary px-5 py-3 text-sm text-tertiary">
              “{decision.reason}”. The Strategist is writing a replacement.
            </p>
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

// ---- 6. Review the first draft ----

function ReviewStep({ onPublish }: { onPublish: () => void }) {
  return (
    <div className="flex flex-col gap-5">
      <StepTitle title="Your first article" lede="Read it as a reader would. Approve, or send it back with a note." />
      <Card>
        <CardHeader title="Before you approve" description="What you asked for, and what the Writer checked." />
        <CardBody className="grid gap-4 text-sm md:grid-cols-2">
          <Field label="Your notes on the pitch">
            <ul className="list-disc space-y-1 pl-4">
              {ARTICLE.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </Field>
          <Field label="The Writer's checks">
            <p>House rules: all clear.</p>
            <p className="mt-1">1 number to confirm, highlighted below.</p>
          </Field>
        </CardBody>
      </Card>

      <Card>
        <article className="mx-auto max-w-[680px] px-5 py-8 font-serif">
          <p className="mb-2 font-sans text-xs tracking-wide text-quaternary uppercase">{ARTICLE.collection}</p>
          <h1 className="text-3xl leading-tight text-primary">{ARTICLE.title}</h1>
          <p className="mt-3 font-sans text-sm text-tertiary">By {ARTICLE.byline}</p>
          <div className="mt-6 flex flex-col gap-4 text-lg leading-relaxed text-secondary">
            {ARTICLE.paragraphs.map((p, i) => (
              <div key={i}>
                {p.h && <h2 className="mt-2 mb-2 text-xl text-primary">{p.h}</h2>}
                <p>
                  {p.t.includes(ARTICLE.flagged) ? (
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
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button color="tertiary">Send back with a note</Button>
        <Button color="secondary">Approve, publish on schedule (Mon 13 Oct)</Button>
        <Button iconLeading={Rocket02} onClick={onPublish}>
          Approve and publish now
        </Button>
      </div>
    </div>
  );
}

// ---- 7. Published ----

function PublishedStep({ onRestart }: { onRestart: () => void }) {
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
    <div className="flex flex-col gap-5">
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

      <Card>
        <CardBody className="flex flex-col items-center gap-4 py-12 text-center">
          <span className="grid size-14 place-items-center rounded-full bg-success-secondary">
            <CheckCircle className="size-7 text-fg-success-primary" />
          </span>
          <h2 className="font-title text-3xl text-primary">Your first article is live</h2>
          <p className="max-w-md text-sm text-tertiary">{ARTICLE.title}</p>
          <a
            href={ARTICLE.url}
            onClick={(e) => e.preventDefault()}
            className="flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 font-mono text-sm text-primary ring-1 ring-secondary ring-inset hover:bg-primary_hover"
          >
            {ARTICLE.url.replace("https://", "")} <LinkExternal01 className="size-4 text-quaternary" />
          </a>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="What happens next" />
        <CardBody>
          <ul className="flex flex-col gap-2 text-sm text-secondary">
            <li className="flex gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-fg-success-primary" />2 more drafts are waiting for your review.
            </li>
            <li className="flex gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-fg-success-primary" />Batch 2 arrives Monday morning: 4 pitches, written after today's decisions.
            </li>
            <li className="flex gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-fg-success-primary" />Your Launch: 1 of 15 live, day 1 of 30. It's at the top of Home.
            </li>
          </ul>
        </CardBody>
        <CardFooter className="flex flex-wrap justify-between gap-2">
          <button type="button" onClick={onRestart} className="text-sm text-tertiary hover:text-secondary">
            Restart the demo
          </button>
          <Button iconTrailing={ArrowRight}>Go to Home</Button>
        </CardFooter>
      </Card>
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
