// The Strategist's plan, shown so it can be read in a minute: the summary in
// one sentence, the three numbers that matter (each with its reason), the
// topics with the first pitches under each, the Launch, the searches and the
// watched sites, then its questions. Approve or ask for changes from the bar
// at the bottom, up to five rounds.
//
// Its questions are answered here, all together; the answers go back as a
// revision, and Approve stays locked while any are open (Ayadi, 2026-10-10;
// the Strategist decides with the answers instead of asking again, #103).

import { useState } from "react";
import { Label, TextArea, TextField } from "react-aria-components";
import { ArrowRight, CheckCircle, ChevronDown, Edit03, RefreshCw01 } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { toast } from "@/components/base/toast/toast";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/shell/Card";
import { goalsActions } from "@/lib/goals/useGoals";
import { quarterLabel } from "@/lib/goals/quarter";
import type { LaunchPlan, Proposal } from "@/lib/goals/types";
import type { PipelineItem } from "@/lib/pipeline/types";
import { userMessage } from "@/lib/errors";
import { reportError, track } from "@/lib/telemetry";
import { cx } from "@/utils/cx";
import { SectionTitle, Spinner } from "./bits";
import type { StrategistProgress } from "./progress";
import { MAX_ROUNDS } from "./state";

const fmt = (n: number) => n.toLocaleString("en-US");

export function StrategyView({
  proposal,
  round,
  pitches,
  progress,
  failedAsk,
}: {
  proposal: Proposal;
  /** The person's last change request, when its run failed: shown with "Send it again". */
  failedAsk?: { request: string; error: string } | null;
  round: number;
  /** The Strategist's first pitches (briefs it pitched). */
  pitches: PipelineItem[];
  progress: StrategistProgress | null;
}) {
  const [asking, setAsking] = useState(false);
  const [ask, setAsk] = useState("");
  const [answers, setAnswers] = useState<string[]>(() => proposal.questions.map(() => ""));
  const [busy, setBusy] = useState(false);
  const questions = proposal.questions;
  const lastRound = round >= MAX_ROUNDS;
  // Open questions block approval, every round (as on Goals, #102), except the
  // last: no answer can be sent then, so it would never unlock.
  const mustAnswer = questions.length > 0 && !lastRound;
  const allAnswered = answers.every((a) => a.trim());
  const pitching = progress?.proposalId === proposal.id ? progress.pitches : null;

  const revise = async (note: string, what: string) => {
    setBusy(true);
    try {
      await goalsActions.requestChanges(proposal.id, note);
      track("getting_started_revision", { round, what });
    } catch (err) {
      reportError("Getting started: revision not asked", err);
      toast.add({ type: "error", title: "Couldn't send that", description: userMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    setBusy(true);
    try {
      await goalsActions.approveProposal(proposal.id, proposal, []);
      track("getting_started_plan_approved", { round, pitches: pitches.length });
    } catch (err) {
      reportError("Getting started: plan not approved", err);
      toast.add({ type: "error", title: "Couldn't approve the plan", description: userMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const answerNote = () => ["Answers to your questions:", ...questions.map((q, i) => `${i + 1}. ${q}\n${answers[i].trim()}`)].join("\n\n");

  const numbers = [
    proposal.launch && {
      value: fmt(proposal.launch.target),
      label: `posts in your Launch, over ${proposal.launch.publishOverDays} days`,
      why: `Written within ${proposal.launch.produceByDay} days and spread out, so the blog is never quiet for long.`,
      basis: "The Launch rules for a new blog.",
    },
    {
      value: fmt(proposal.volume.value),
      label: `posts in ${quarterLabel(proposal.quarter)}`,
      why: proposal.volume.why,
      basis: proposal.volume.basis,
    },
    {
      value: `${proposal.ranking.pageOneTarget.value} of ${proposal.ranking.searches.length}`,
      label: "target searches on page one",
      why: proposal.ranking.pageOneTarget.why,
      basis: proposal.ranking.pageOneTarget.basis,
    },
  ].filter(Boolean) as { value: string; label: string; why: string; basis: string }[];

  return (
    <div className="flex flex-col gap-8">
      {failedAsk && (
        <div className="flex flex-col gap-3 rounded-lg bg-secondary px-4 py-3 text-sm text-primary sm:flex-row sm:items-center">
          <p className="flex-1">
            <span className="font-medium">Your last request didn't go through.</span> {failedAsk.error} This is still the plan from before.
          </p>
          <Button size="sm" color="secondary" iconLeading={RefreshCw01} isDisabled={busy || lastRound} onClick={() => void revise(failedAsk.request, "retry")}>
            Send it again
          </Button>
        </div>
      )}
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge color="gray" size="sm">{quarterLabel(proposal.quarter)} plan</Badge>
          <Badge color="gray" size="sm">Round {round} of {MAX_ROUNDS}</Badge>
        </div>
        <p className="font-serif text-2xl leading-snug text-primary md:text-[28px] md:leading-[36px]">{proposal.summary}</p>
      </div>

      <div className={cx("grid gap-4", numbers.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2")}>
        {numbers.map((n) => (
          <NumberTile key={n.label} {...n} />
        ))}
      </div>

      <section>
        <SectionTitle title="Your topics" lede="Up to four, so readers and Google can tell what you're about. Under each, the first posts the Strategist pitched." />
        <div className="grid gap-4 md:grid-cols-2">
          {proposal.topics.map((t, i) => {
            const mine = pitches.filter((p) => p.topics[0] === t.name);
            return (
              <Card key={t.name}>
                <CardHeader title={`${i + 1}. ${t.name}`} description={t.low === t.high ? `${t.low} posts` : `${t.low} to ${t.high} posts`} />
                <CardBody className="flex flex-col gap-3">
                  <p className="text-sm text-secondary">{t.why}</p>
                  <div className="border-t border-secondary pt-3">
                    <p className="mb-2 text-xs font-medium tracking-wide text-quaternary uppercase">First pitches</p>
                    {mine.length ? (
                      <ul className="flex flex-col gap-2">
                        {mine.map((p) => (
                          <li key={p.id} className="flex items-start gap-2 text-sm">
                            <Edit03 className="mt-0.5 size-4 shrink-0 text-quaternary" />
                            <span className="flex-1 text-primary">{p.title}</span>
                          </li>
                        ))}
                      </ul>
                    ) : pitching && pitching.topics > 0 && pitching.topicsDone >= pitching.topics ? (
                      <p className="text-sm text-tertiary">No first pitches here. The Pitcher writes for this topic in its next batch, once you approve.</p>
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
            );
          })}
        </div>
      </section>

      {proposal.launch && (
        <section>
          <SectionTitle
            title={`Your Launch, the first ${proposal.launch.publishOverDays} days`}
            lede={`${proposal.launch.target} posts written in ${proposal.launch.produceByDay} days and published over ${proposal.launch.publishOverDays}, so the blog is never quiet for long.`}
          />
          <LaunchLine launch={proposal.launch} />
        </section>
      )}

      {proposal.ranking.searches.length > 0 && (
        <section>
          <SectionTitle title="Searches to win" lede="Long-tail first: a new blog ranks slowly." />
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-secondary text-left text-xs text-tertiary">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">Search</th>
                    <th className="px-3 py-2.5 font-medium">A month</th>
                    <th className="px-3 py-2.5 font-medium">You today</th>
                    <th className="px-5 py-2.5 font-medium">Why</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-secondary">
                  {proposal.ranking.searches.map((s) => (
                    <tr key={s.query}>
                      <td className="px-5 py-2.5 text-primary">{s.query}</td>
                      <td className="px-3 py-2.5 text-secondary tabular-nums">{s.volume != null ? fmt(s.volume) : "–"}</td>
                      <td className="px-3 py-2.5 text-tertiary">{s.position != null ? `#${s.position}` : "Not in the top 100"}</td>
                      <td className="px-5 py-2.5 text-tertiary">{s.why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <CardFooter>Volumes and rankings from DataForSEO, this week.</CardFooter>
          </Card>
        </section>
      )}

      {proposal.watchedSites.length > 0 && (
        <section>
          <SectionTitle title="Sites the Scout watches" />
          <div className="flex flex-wrap gap-2">
            {proposal.watchedSites.map((w) => (
              <Badge key={w.url} color="gray" size="md">
                {w.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              </Badge>
            ))}
          </div>
        </section>
      )}

      {questions.length > 0 && (
        <section>
          <SectionTitle
            title="What it couldn't decide alone"
            lede={
              lastRound
                ? "That was the last round. Approve the plan as it is; you can change it any time on Goals."
                : `Answer ${questions.length === 1 ? "it" : questions.length === 2 ? "both" : `all ${questions.length}`} and send them together. The Strategist folds your answers into the plan, and approving unlocks then.`
            }
          />
          {lastRound ? (
            <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-secondary">
              {questions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col gap-4">
              {questions.map((q, i) => (
                <TextField key={q} value={answers[i] ?? ""} onChange={(v) => setAnswers((a) => a.map((x, j) => (j === i ? v : x)))} className="flex flex-col gap-1.5">
                  <Label className="text-sm font-medium text-secondary">{q}</Label>
                  <TextArea
                    rows={2}
                    placeholder="Your answer"
                    className="w-full resize-y rounded-lg bg-primary px-3.5 py-2.5 text-md text-primary shadow-xs ring-1 ring-primary outline-none ring-inset placeholder:text-placeholder focus:ring-2 focus:ring-brand"
                  />
                </TextField>
              ))}
              <div>
                <Button size="sm" isDisabled={!allAnswered || busy || lastRound} isLoading={busy} onClick={() => void revise(answerNote(), "answers")}>
                  Send answers
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      <div className="sticky bottom-0 z-20 -mx-4 border-t border-secondary bg-primary/95 backdrop-blur md:-mx-8 lg:mr-0">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 md:px-8 lg:pr-0">
          {asking ? (
            <>
              <input
                autoFocus
                value={ask}
                onChange={(e) => setAsk(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setAsking(false)}
                placeholder="What should change?"
                className="min-w-[16rem] flex-1 rounded-lg bg-primary px-3.5 py-2 text-sm text-primary shadow-xs ring-1 ring-primary outline-none ring-inset focus:ring-2 focus:ring-brand"
              />
              <Button color="tertiary" size="sm" onClick={() => setAsking(false)}>
                Cancel
              </Button>
              <Button size="sm" isDisabled={!ask.trim() || busy} isLoading={busy} onClick={() => void revise(ask.trim(), "changes")}>
                Send to the Strategist
              </Button>
            </>
          ) : (
            <>
              <span className="text-sm text-tertiary">
                Round {round} of {MAX_ROUNDS}
                {pitches.length > 0
                  ? ` · ${pitches.length} pitches ready`
                  : pitching
                    ? ` · pitching topic ${Math.min(pitching.topicsDone + 1, pitching.topics)} of ${pitching.topics}`
                    : " · pitches on their way"}
                {mustAnswer && ` · Answer its ${questions.length === 1 ? "question" : `${questions.length} questions`} to approve`}
              </span>
              <div className="ml-auto flex gap-2">
                <Button color="secondary" size="sm" isDisabled={lastRound || busy} onClick={() => setAsking(true)}>
                  Ask for changes
                </Button>
                <Button size="sm" iconTrailing={ArrowRight} isDisabled={mustAnswer || busy} isLoading={busy} onClick={() => void approve()}>
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

function NumberTile({ value, label, why, basis }: { value: string; label: string; why: string; basis: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardBody className="flex flex-col gap-1">
        <span className="type-figure text-primary">{value}</span>
        <span className="text-sm text-secondary">{label}</span>
        <button type="button" onClick={() => setOpen((o) => !o)} className="mt-2 flex items-center gap-1 self-start text-xs text-tertiary hover:text-secondary">
          Why <ChevronDown className={cx("size-3.5 transition", open && "rotate-180")} />
        </button>
        {open && (
          <div className="mt-1 flex flex-col gap-1.5 text-sm">
            <p className="text-secondary">{why}</p>
            {basis && <p className="text-xs text-quaternary">From: {basis}</p>}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/** The Launch on a line: batches on days 1, 8 and 15, posts spread over the days. */
function LaunchLine({ launch }: { launch: LaunchPlan }) {
  const days = Math.max(launch.publishOverDays, 2);
  const batches = [1, 8, 15].filter((d) => d <= launch.produceByDay);
  const publish = Array.from({ length: launch.target }, (_, i) => Math.round(3 + (i * (days - 3)) / Math.max(launch.target - 1, 1)));
  const at = (d: number) => `${((d - 1) / (days - 1)) * 100}%`;
  return (
    <Card>
      <CardBody className="py-6">
        <div className="relative h-14">
          <div className="absolute top-6 right-0 left-0 h-px bg-border-primary" />
          {batches.map((d, i) => (
            <div key={d} className="absolute top-0 flex -translate-x-1/2 flex-col items-center" style={{ left: at(d) }}>
              <span className="mb-1 text-xs whitespace-nowrap text-secondary">Batch {i + 1}</span>
              <span className="size-3 rounded-full bg-brand-solid ring-4 ring-primary" />
            </div>
          ))}
          {publish.map((d, i) => (
            <span key={i} className="absolute top-[22px] size-2 -translate-x-1/2 rounded-full bg-fg-quaternary" style={{ left: at(d) }} />
          ))}
          <div className="absolute top-9 left-0 text-xs text-quaternary">Today</div>
          <div className="absolute top-9 right-0 text-xs text-quaternary">Day {days}</div>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-tertiary">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-brand-solid" /> Batch of pitches
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-fg-quaternary" /> A post goes live
          </span>
          <span className="flex items-center gap-1.5">
            <CheckCircle className="size-3.5" /> Batch 1 is today's
          </span>
        </div>
      </CardBody>
    </Card>
  );
}
