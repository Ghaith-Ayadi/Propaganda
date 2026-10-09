// #/goals[/<tab>][/<quarter>]: the quarter's four goals, the Strategist's
// proposal, the content batches and the plan drop.
// Tabs: (none) goals, "strategist", "batches", "plan". Quarter: "2026-q4".
// Data comes from lib/goals/useGoals.ts (a placeholder adapter until the
// goal tables exist).

import { useState, type ReactNode } from "react";
import { ArrowRight, CalendarDate } from "@untitledui/icons";
import { PageBody, PageHeader, PageTabs } from "@/components/shell/PageHeader";
import { NativeSelect } from "@/components/base/select/select-native";
import { Button } from "@/components/base/buttons/button";
import { goPage, usePageRest } from "@/lib/route";
import type { Proposal, QuarterKey } from "@/lib/goals/types";
import { joinState, nextQuarterClock, quarterLabel, quarterOf, quarterStart, shiftQuarter, shortDate } from "@/lib/goals/quarter";
import { goalsActions, useBatchPlan, useGoalsArePlaceholder, useGoalsContext, useLaunch, useProposal, useQuarterGoals, useQuarters, useStrategistState } from "@/lib/goals/useGoals";
import { useSuperadminAccount } from "@/lib/superadmin";
import { userMessage } from "@/lib/errors";
import { reportError } from "@/lib/telemetry";
import { toast } from "@/components/base/toast/toast";
import { LAUNCH_WHY } from "@/lib/goals/copy";
import { AuthorityExplainer, Card, PlaceholderBanner } from "./bits";
import { ChangeHistory, GoalCards } from "./GoalCards";
import { LaunchCard } from "./LaunchCard";
import { BatchesView, batchSummary } from "./BatchesView";
import { ProposalView } from "./ProposalView";
import { PlanDrop } from "./PlanDrop";

type Tab = "goals" | "strategist" | "batches" | "plan";
const TABS: { id: Tab; label: string }[] = [
  { id: "goals", label: "Goals" },
  { id: "strategist", label: "Strategist" },
  { id: "batches", label: "Batches" },
  { id: "plan", label: "Your plan" },
];

function parseRest(rest: string | null): { tab: Tab; quarter: QuarterKey | null } {
  const parts = (rest ?? "").split("/").filter(Boolean);
  let tab: Tab = "goals";
  let quarter: QuarterKey | null = null;
  for (const p of parts) {
    if (TABS.some((t) => t.id === p)) tab = p as Tab;
    const m = p.match(/^(\d{4})-q([1-4])$/i);
    if (m) quarter = `${Number(m[1])}-Q${Number(m[2]) as 1 | 2 | 3 | 4}`;
  }
  return { tab, quarter };
}

function restFor(tab: Tab, quarter: QuarterKey, current: QuarterKey): string | null {
  const parts = [tab === "goals" ? null : tab, quarter === current ? null : quarter.toLowerCase()].filter(Boolean);
  return parts.length ? parts.join("/") : null;
}

export function GoalsPage() {
  const ctx = useGoalsContext();
  const quarters = useQuarters();
  const thisQuarter = quarterOf(ctx.today);
  const parsed = parseRest(usePageRest());
  const quarter = parsed.quarter && quarters.includes(parsed.quarter) ? parsed.quarter : thisQuarter;
  const tab = parsed.tab;
  const nav = (t: Tab, q: QuarterKey = quarter) => goPage("goals", restFor(t, q, thisQuarter));

  const proposal = useProposal(quarter);
  const waiting = proposal && (proposal.status === "sent" || proposal.status === "changes_requested");

  return (
    <>
      <PageHeader
        title="Goals"
        description={`${quarterLabel(quarter)}${quarter === thisQuarter ? "" : quarter > thisQuarter ? ", next quarter" : ", past"}. What the agents rate every pitch against, and what Home reports on.`}
        actions={
          <NativeSelect
            size="sm"
            aria-label="Quarter"
            className="w-40"
            value={quarter}
            onChange={(e) => nav(tab, e.target.value as QuarterKey)}
            options={quarters.map((q) => ({ value: q, label: quarterLabel(q) + (q === thisQuarter ? " (now)" : q > thisQuarter ? " (next)" : "") }))}
          />
        }
        tabs={<PageTabs label="Goals sections" items={TABS.map((t) => ({ ...t, badge: t.id === "strategist" && waiting ? 1 : undefined }))} selected={tab} onChange={(id) => nav(id as Tab)} />}
      />

      <PageBody>
        <PlaceholderBanner />

        {tab === "goals" && <GoalsTab quarter={quarter} thisQuarter={thisQuarter} onTab={nav} />}
        {tab === "strategist" && <StrategistTab quarter={quarter} thisQuarter={thisQuarter} onTab={nav} />}
        {tab === "batches" && <BatchesTab quarter={quarter} onTab={nav} />}
        {tab === "plan" && <PlanDrop />}
      </PageBody>
    </>
  );
}

// ── Goals tab ───────────────────────────────────────────────────────────────

function GoalsTab({ quarter, thisQuarter, onTab }: { quarter: QuarterKey; thisQuarter: QuarterKey; onTab: (t: Tab, q?: QuarterKey) => void }) {
  const ctx = useGoalsContext();
  const goals = useQuarterGoals(quarter);
  const launch = useLaunch();
  const proposal = useProposal(quarter);
  const plan = useBatchPlan(quarter);
  const joinedHere = quarterOf(ctx.joinedAt) === quarter;
  const join = joinedHere ? joinState(ctx.joinedAt) : null;
  const showLaunch = launch && quarterOf(launch.startedAt) === quarter;

  return (
    <div className="space-y-4">
      {proposal && (proposal.status === "sent" || proposal.status === "changes_requested") && <ProposalBanner proposal={proposal} onOpen={() => onTab("strategist")} />}
      {showLaunch && <LaunchCard launch={launch} />}

      {join?.kind === "prorated" && goals.current && (
        <Note>
          {quarterLabel(quarter).split(" ")[0]} goals cover {join.weeksLeft} weeks, from {shortDate(join.from)}. You joined in week {join.week}, so every target is {Math.round(join.factor * 100)}% of a full quarter.
        </Note>
      )}
      {goals.rolledOver && <Note>These are last quarter's goals, prorated: nothing was approved for {quarterLabel(quarter)} yet. Nothing stops in the meantime.</Note>}

      {!goals.current ? (
        <NoGoals quarter={quarter} thisQuarter={thisQuarter} join={join} proposal={proposal} onTab={onTab} />
      ) : (
        <>
          {plan && (
            <button type="button" onClick={() => onTab("batches")} className="flex w-full items-center justify-between gap-3 rounded-xl bg-primary px-4 py-3 text-left text-sm shadow-xs ring-1 ring-secondary hover:bg-primary_hover">
              <span className="text-secondary">
                {batchSummary(plan)}
                {plan.bonus.count > 0 && <span className="text-tertiary"> +{plan.bonus.count} bonus ({[...new Set(plan.bonus.sources)].join(", ")}).</span>}
              </span>
              <ArrowRight className="size-4 shrink-0 text-fg-quaternary" aria-hidden />
            </button>
          )}
          <GoalCards goals={goals} />
          <ChangeHistory goals={goals} />
        </>
      )}

      {quarter === thisQuarter && <NextQuarterCard quarter={quarter} onTab={onTab} />}
    </div>
  );
}

function ProposalBanner({ proposal, onOpen }: { proposal: Proposal; onOpen: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-brand-primary_alt p-5 ring-1 ring-brand ring-inset md:flex-row md:items-center md:justify-between">
      <div>
        <p className="font-medium text-brand-secondary">
          {proposal.status === "changes_requested" ? "The Strategist is revising" : `The Strategist proposed ${quarterLabel(proposal.quarter)}'s goals`}
        </p>
        <p className="mt-0.5 text-sm text-secondary">{proposal.summary}</p>
      </div>
      <Button size="sm" color="primary" iconTrailing={ArrowRight} onClick={onOpen}>
        {proposal.status === "changes_requested" ? "See it" : "Review and approve"}
      </Button>
    </div>
  );
}

function NoGoals({
  quarter,
  thisQuarter,
  join,
  proposal,
  onTab,
}: {
  quarter: QuarterKey;
  thisQuarter: QuarterKey;
  join: ReturnType<typeof joinState> | null;
  proposal: Proposal | null;
  onTab: (t: Tab, q?: QuarterKey) => void;
}) {
  if (join?.kind === "next_quarter") {
    return (
      <Card title={`No goals for ${quarterLabel(quarter)}`} subtitle={`You joined in week ${join.week} of 13, too late for a fair quarter.`}>
        <p className="text-sm text-secondary">
          Your first full quarter is {quarterLabel(join.firstQuarter)}, starting {shortDate(join.startsOn)}. The Launch runs now, and posts published before then show on Content but aren't graded.
        </p>
        <Button className="mt-4" size="sm" color="secondary" iconTrailing={ArrowRight} onClick={() => onTab("strategist", join.firstQuarter)}>
          {quarterLabel(join.firstQuarter)} proposal
        </Button>
      </Card>
    );
  }
  if (quarter > thisQuarter) return <NextQuarterEmpty quarter={quarter} thisQuarter={thisQuarter} onTab={onTab} />;
  return (
    <Card title="No goals yet" subtitle={quarter < thisQuarter ? "Nothing was set for this quarter." : "Until goals are approved, pitches are rated on Volume and timeliness only."}>
      {proposal && quarter === thisQuarter && (
        <Button size="sm" color="primary" iconTrailing={ArrowRight} onClick={() => onTab("strategist")}>
          See the proposal
        </Button>
      )}
    </Card>
  );
}

/** In the current quarter: when next quarter's plan is drafted and due. */
function NextQuarterCard({ quarter, onTab }: { quarter: QuarterKey; onTab: (t: Tab, q?: QuarterKey) => void }) {
  const ctx = useGoalsContext();
  const next = shiftQuarter(quarter, 1);
  const proposal = useProposal(next);
  const goals = useQuarterGoals(next);
  const clock = nextQuarterClock(quarter);
  const late = !goals.current && ctx.today >= clock.nagFrom;
  return (
    <Card
      title={`Next: ${quarterLabel(next)}`}
      subtitle="You never arrive at a quarter without a plan."
      aside={<CalendarDate className="size-5 text-fg-quaternary" aria-hidden />}
    >
      <ol className="grid gap-3 text-sm sm:grid-cols-3">
        <Step done={ctx.today >= clock.draftOn || !!proposal} label="The Strategist drafts it" day={clock.draftOn} />
        <Step done={!!goals.current} label="You approve it" day={clock.approveBy} warn={late} />
        <Step done={ctx.today >= clock.firstBatchBy && !!goals.current} label="Batch 1 in your inbox" day={clock.firstBatchBy} />
      </ol>
      {late && <p className="mt-3 text-sm text-warning-primary">{quarterLabel(next)} goals aren't approved yet.</p>}
      <p className="mt-3 text-xs text-quaternary">If a quarter starts with nothing approved, this quarter's goals roll over, prorated, with a banner. Nothing stops.</p>
      {(proposal || goals.current) && (
        <Button className="mt-4" size="sm" color="secondary" iconTrailing={ArrowRight} onClick={() => onTab(goals.current ? "goals" : "strategist", next)}>
          {goals.current ? `${quarterLabel(next)} goals` : `Review the ${quarterLabel(next)} draft`}
        </Button>
      )}
    </Card>
  );
}

function Step({ done, label, day, warn }: { done: boolean; label: string; day: string; warn?: boolean }) {
  return (
    <li className="rounded-xl p-3 ring-1 ring-secondary ring-inset">
      <p className={done ? "font-medium text-success-primary" : warn ? "font-medium text-warning-primary" : "font-medium text-secondary"}>{done ? "✓ " : ""}{label}</p>
      <p className="text-tertiary">by {shortDate(day)}</p>
    </li>
  );
}

function NextQuarterEmpty({ quarter, thisQuarter, onTab }: { quarter: QuarterKey; thisQuarter: QuarterKey; onTab: (t: Tab, q?: QuarterKey) => void }) {
  const clock = nextQuarterClock(thisQuarter);
  return (
    <Card title={`${quarterLabel(quarter)} isn't planned yet`} subtitle={`The Strategist drafts it on ${shortDate(clock.draftOn)}, four weeks before ${quarterLabel(quarter)} starts on ${shortDate(quarterStart(quarter))}.`}>
      <p className="text-sm text-secondary">
        It starts from the planned posts pushed from {quarterLabel(thisQuarter)}, what you rejected and why, and the bonus posts that earned a slot. Anything you already know about {quarterLabel(quarter)} helps: drop it in Your plan.
      </p>
      <Button className="mt-4" size="sm" color="secondary" iconTrailing={ArrowRight} onClick={() => onTab("plan")}>
        Your plan
      </Button>
    </Card>
  );
}

// ── Strategist tab ──────────────────────────────────────────────────────────

/**
 * What the Strategist is doing (asked, writing, or failed), and for the
 * superadmin a "Run the Strategist now" button: a manual run, for testing.
 */
function StrategistStatus({ quarter }: { quarter: QuarterKey }) {
  const state = useStrategistState();
  const sample = useGoalsArePlaceholder();
  const admin = useSuperadminAccount();
  const [asking, setAsking] = useState(false);
  if (sample) return null;
  const working = state && (state.status === "requested" || state.status === "running");
  const failed = state?.status === "failed";
  if (!working && !failed && !admin) return null;
  const run = async () => {
    setAsking(true);
    try {
      await goalsActions.askStrategist("revision", "Run by hand from the Goals page.", quarter);
      toast.add({ type: "success", title: "The Strategist is on it", description: "The proposal shows here when it's done, usually within a few minutes." });
    } catch (err) {
      reportError("goals.runStrategist", err);
      toast.add({ type: "error", title: "Couldn't start the Strategist", description: userMessage(err) });
    } finally {
      setAsking(false);
    }
  };
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-secondary px-4 py-3 text-sm md:flex-row md:items-center md:justify-between">
      <p className="text-secondary">
        {working
          ? "The Strategist is writing a proposal. It shows here when it's done."
          : failed
            ? "The Strategist's last run didn't finish, so nothing changed. It's in Admin > Runs."
            : "Admin: start a Strategist run for this tenant now."}
      </p>
      {admin && (
        <Button size="sm" color="secondary" isLoading={asking} isDisabled={asking || !!working} onClick={() => void run()}>
          Run the Strategist now
        </Button>
      )}
    </div>
  );
}

function StrategistTab({ quarter, thisQuarter, onTab }: { quarter: QuarterKey; thisQuarter: QuarterKey; onTab: (t: Tab, q?: QuarterKey) => void }) {
  const proposal = useProposal(quarter);
  const launch = useLaunch();
  if (!proposal) {
    return (
      <div className="space-y-4">
        <StrategistStatus quarter={quarter} />
        {quarter > thisQuarter ? (
          <NextQuarterEmpty quarter={quarter} thisQuarter={thisQuarter} onTab={onTab} />
        ) : (
          <Card title="No proposal for this quarter" subtitle="The Strategist proposes goals once you've answered its questions, and again two weeks before each quarter." />
        )}
      </div>
    );
  }
  const preLaunch = proposal.kind === "onboarding" && proposal.status !== "approved" && !launch;
  return (
    <div className="space-y-4">
      <StrategistStatus quarter={quarter} />
      {preLaunch && (
        <Card title="Your Launch starts when you approve" subtitle={LAUNCH_WHY}>
          <ul className="list-disc space-y-1 pl-5 text-sm text-secondary">
            <li>The morning after you approve: 5 to 8 briefs in your inbox, the 3 strongest already written.</li>
            <li>15 posts written in 20 days, in three batches (day 1, 8 and 15), published over 30 days.</li>
            <li>Up to four topics, buying-intent posts first, a named person on every byline.</li>
            <li>The first public post goes out once 3 are approved, unless you pick a date.</li>
          </ul>
          <div className="mt-4">
            <AuthorityExplainer compact />
          </div>
        </Card>
      )}
      <ProposalView key={proposal.id + proposal.status} proposal={proposal} />
      <p className="text-center text-sm text-tertiary">
        Have a plan of your own?{" "}
        <button type="button" className="font-medium text-brand-secondary hover:underline" onClick={() => onTab("plan")}>
          Give it to the Strategist
        </button>
      </p>
    </div>
  );
}

// ── Batches tab ─────────────────────────────────────────────────────────────

function BatchesTab({ quarter, onTab }: { quarter: QuarterKey; onTab: (t: Tab, q?: QuarterKey) => void }) {
  const plan = useBatchPlan(quarter);
  if (!plan)
    return (
      <Card title="No batches yet" subtitle="Batches come from approved goals: the quarter's planned posts, always delivered in batches.">
        <Button size="sm" color="secondary" iconTrailing={ArrowRight} onClick={() => onTab("strategist")}>
          The Strategist's proposal
        </Button>
      </Card>
    );
  return <BatchesView plan={plan} />;
}

function Note({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-secondary px-4 py-3 text-sm text-secondary">{children}</p>;
}
