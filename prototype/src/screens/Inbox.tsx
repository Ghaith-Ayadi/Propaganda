// Inbox: everything the agents raised that needs a person.
// Four lanes (Flags, Pitches, Knowledge, Review), a list on the left, the
// case on the right. The flag case is where the Guardian lives.

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  FileCheck02,
  Lightbulb01,
  Scales02,
  SearchLg,
  Shield01,
  X,
} from "@untitledui/icons";
import { Button, Card, Dot, Empty, Eyebrow, Pill, Quote, cx, inputClass } from "../bits";
import { NEEDS_ACTION, postTitle, topicName, useStore } from "../store";
import * as D from "../data";
import type { Flag, GuardianVerdict } from "../data";

type Lane = "flags" | "pitches" | "knowledge" | "review";

export function Inbox() {
  const { s, d, dispatch, toast, go } = useStore();
  const [lane, setLane] = useState<Lane>("flags");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const openFlags = useMemo(
    () => s.flags.filter((f) => NEEDS_ACTION.includes(f.status)),
    [s.flags],
  );
  const newPitches = s.pitches.filter((p) => p.status === "new");
  const knowledge = [
    ...s.contested.map((k) => ({ ...k, kind: "contested" as const })),
    ...s.contradictions.map((k) => ({ id: k.id, claim: `${k.a} / ${k.b}`, since: k.since, why: "Two claims in the knowledge base contradict each other.", kind: "contradiction" as const })),
  ];

  const lanes: Array<{ id: Lane; label: string; icon: React.ReactNode; count: number }> = [
    { id: "flags", label: "Flags", icon: <AlertTriangle className="size-4" />, count: openFlags.length },
    { id: "pitches", label: "Pitches", icon: <Lightbulb01 className="size-4" />, count: newPitches.length },
    { id: "knowledge", label: "Knowledge", icon: <Scales02 className="size-4" />, count: knowledge.length },
    { id: "review", label: "Review", icon: <FileCheck02 className="size-4" />, count: s.reviews.length },
  ];

  const filtered = openFlags.filter(
    (f) =>
      !q.trim() ||
      (f.claim + f.theme + postTitle(f.postId)).toLowerCase().includes(q.toLowerCase()),
  );
  const current = filtered.find((f) => f.id === selected) ?? filtered[0] ?? null;

  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-5 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-title text-2xl text-primary">Inbox</h1>
          <p className="mt-0.5 text-sm text-tertiary">
            {d.inboxTotal} things need you. Nothing here closes itself.
          </p>
        </div>
        <label className="flex w-full max-w-xs items-center gap-2 rounded-lg bg-primary px-2.5 py-1.5 text-sm shadow-xs ring-1 ring-inset ring-primary focus-within:ring-2 focus-within:ring-brand">
          <SearchLg className="size-4 shrink-0 text-quaternary" />
          <input
            id="inbox-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the inbox"
            className="w-full min-w-0 bg-transparent text-primary outline-none placeholder:text-placeholder"
          />
        </label>
      </header>

      <nav className="flex flex-wrap gap-1.5">
        {lanes.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => { setLane(l.id); setSelected(null); }}
            aria-pressed={lane === l.id}
            className={cx(
              "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition",
              lane === l.id
                ? "bg-primary text-primary shadow-xs ring-1 ring-inset ring-primary"
                : "text-tertiary hover:bg-primary_hover hover:text-secondary",
            )}
          >
            <span className={lane === l.id ? "text-brand-secondary" : "text-quaternary"}>{l.icon}</span>
            {l.label}
            <span className={cx("tnum rounded-full px-1.5 text-xs", l.count ? "bg-secondary text-secondary" : "text-quaternary")}>
              {l.count}
            </span>
          </button>
        ))}
      </nav>

      {lane === "flags" &&
        (filtered.length === 0 ? (
          <Card>
            <Empty title="No open flags" hint="Every inconsistency has been fixed, reconciled or logged. The weekly sweep runs Monday." />
          </Card>
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
            <Card pad={false} className="divide-y divide-[var(--color-border-secondary)]">
              {filtered.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setSelected(f.id)}
                  className={cx(
                    "flex w-full flex-col gap-1 px-4 py-3 text-left transition",
                    current?.id === f.id ? "bg-secondary" : "hover:bg-secondary",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <Dot tone={f.status === "escalated" ? "bad" : f.status === "rejected" ? "warn" : "info"} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-primary">{f.theme}</span>
                    <span className="tnum shrink-0 text-xs text-quaternary">{Math.round(f.confidence * 100)}%</span>
                  </span>
                  <span className="truncate text-xs text-tertiary">{postTitle(f.postId)}</span>
                  {f.status !== "open" && (
                    <span className="mt-0.5">
                      <Pill tone={f.status === "escalated" ? "bad" : "warn"}>
                        {f.status === "escalated" ? "Escalated" : "Guardian rejected"}
                      </Pill>
                    </span>
                  )}
                </button>
              ))}
            </Card>
            {current && <FlagCase key={current.id} flag={current} />}
          </div>
        ))}

      {lane === "pitches" &&
        (newPitches.length === 0 ? (
          <Card>
            <Empty title="No pitches waiting" hint="Ideas without a reason never reach this list." />
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {newPitches.map((p) => (
              <Card key={p.id} className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-title text-base text-primary">{p.title}</h3>
                  <Pill tone={p.origin === "internal" ? "info" : "neutral"}>
                    {p.origin === "internal" ? "From our knowledge" : "Search demand"}
                  </Pill>
                </div>
                <div>
                  <Eyebrow>Why it's worth writing</Eyebrow>
                  <p className="mt-1 text-sm text-secondary">{p.reason}</p>
                </div>
                <div className="flex flex-col gap-1.5">
                  {p.evidence.map((e) => (
                    <Quote key={e} label={p.origin === "internal" ? "From a call" : "Search data"}>
                      {e}
                    </Quote>
                  ))}
                </div>
                <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-secondary pt-3">
                  <Pill tone="neutral">{topicName(p.topic)}</Pill>
                  <span className="flex-1" />
                  <Button size="sm" kind="ghost" onClick={() => { dispatch({ type: "pitch", id: p.id, status: "ditched" }); toast("Ditched. The topic is already well covered."); }}>
                    Ditch
                  </Button>
                  <Button size="sm" onClick={() => { dispatch({ type: "pitch", id: p.id, status: "backlog" }); toast("Backlogged, ranked by your goals"); }}>
                    Backlog
                  </Button>
                  <Button size="sm" kind="primary" onClick={() => { dispatch({ type: "pitch", id: p.id, status: "accepted" }); toast("Accepted. A brief is on its way."); }}>
                    Accept
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        ))}

      {lane === "knowledge" &&
        (knowledge.length === 0 ? (
          <Card>
            <Empty title="The knowledge base is clean" hint="Nothing contested, nothing contradicting." />
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="max-w-[70ch] text-sm text-tertiary">
              These lower your knowledge base grade until someone settles them. This is the cost of
              arguing a flag away instead of fixing the content.
            </p>
            {knowledge.map((k) => (
              <Card key={k.id} className="flex flex-wrap items-start gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Pill tone={k.kind === "contested" ? "warn" : "bad"}>
                      {k.kind === "contested" ? "Contested" : "Contradiction"}
                    </Pill>
                    <span className="text-xs text-quaternary">since {k.since}</span>
                  </div>
                  <p className="mt-2 text-sm text-primary">{k.claim}</p>
                  <p className="mt-1 text-xs text-tertiary">{k.why}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button size="sm" onClick={() => toast("Asked for the source")}>
                    Ask for evidence
                  </Button>
                  <Button size="sm" kind="primary" onClick={() => { dispatch({ type: "kbResolve", id: k.id }); toast("Reconciled. The knowledge base grade improves."); }}>
                    Reconcile
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        ))}

      {lane === "review" &&
        (s.reviews.length === 0 ? (
          <Card>
            <Empty title="Nothing waiting on a human" hint="Drafts appear here once the agent has checked them for veracity." />
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {s.reviews.map((r) => (
              <Card key={r.id} className="flex flex-wrap items-center gap-4">
                <div className="min-w-0 flex-1">
                  <h3 className="font-title text-base text-primary">{r.title}</h3>
                  <p className="mt-0.5 text-xs text-tertiary">
                    {r.writer} · <span className="tnum">{r.words}</span> words ·{" "}
                    <span className="tnum">{r.suggestions}</span> agent suggestions to accept or reject · due {r.due}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Pill tone="neutral">{topicName(r.topic)}</Pill>
                  <Button size="sm" onClick={() => toast("The editor is not in this prototype")}>
                    Open in editor
                    <ArrowUpRight className="size-3.5" />
                  </Button>
                  <Button size="sm" kind="primary" onClick={() => { dispatch({ type: "publishReview", id: r.id }); toast(`Published to ${D.site.destination}. Coverage is up.`); }}>
                    Approve and publish
                  </Button>
                </div>
              </Card>
            ))}
            <button type="button" onClick={() => go("home")} className="self-start text-xs text-quaternary hover:text-tertiary">
              See how this moves coverage
            </button>
          </div>
        ))}
    </div>
  );
}

// ── The flag case, with the Guardian ────────────────────────────────────

type Phase = "choose" | "reason" | "drafting" | "ruled" | "not-worth" | "cant-fix";

export function FlagCase({ flag }: { flag: Flag }) {
  const { dispatch, toast } = useStore();
  const [phase, setPhase] = useState<Phase>(flag.status === "rejected" || flag.status === "escalated" ? "ruled" : "choose");
  const [reason, setReason] = useState("");
  const [verdict, setVerdict] = useState<GuardianVerdict | null>(
    flag.status === "rejected" ? "reject" : flag.status === "escalated" ? "escalate" : null,
  );

  const submit = () => {
    setPhase("drafting");
    setTimeout(() => {
      const v = flag.guardian.verdict;
      setVerdict(v);
      setPhase("ruled");
      if (v === "admit") {
        dispatch({ type: "flag", id: flag.id, status: "admitted" });
        dispatch({ type: "kbAdmit" });
        toast("Admitted. The flag is closed.");
      } else if (v === "contested") {
        dispatch({ type: "flag", id: flag.id, status: "contested" });
        dispatch({ type: "kbContest", claim: flag.claim, why: "Admitted on a thin argument." });
        toast("Admitted as contested. Your knowledge base grade drops.");
      } else if (v === "reject") {
        dispatch({ type: "flag", id: flag.id, status: "rejected", rejection: flag.guardian.reason });
        toast("The Guardian rejected it. The flag stays open.");
      } else {
        dispatch({ type: "flag", id: flag.id, status: "escalated" });
        toast("Escalated: this is a change of position.");
      }
    }, 1100);
  };

  return (
    <Card className="fade-up flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow>{flag.theme}</Eyebrow>
          <h2 className="mt-1 font-title text-xl text-primary">{postTitle(flag.postId)}</h2>
          <p className="mt-0.5 text-xs text-quaternary">
            Raised {flag.raised} · confidence <span className="tnum">{Math.round(flag.confidence * 100)}%</span>
          </p>
        </div>
        <Button size="sm" onClick={() => toast("The editor is not in this prototype")}>
          Open the post
          <ArrowUpRight className="size-3.5" />
        </Button>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-error_subtle bg-error-primary p-3">
          <Eyebrow>The content says</Eyebrow>
          <p className="mt-1.5 text-sm text-primary">{flag.claim}</p>
        </div>
        <div className="rounded-lg border border-secondary bg-secondary p-3">
          <Eyebrow>
            {flag.conflict.kind === "kb" ? "The knowledge base says" : flag.conflict.kind === "post" ? "Another post says" : "The source says"}
          </Eyebrow>
          <p className="mt-1.5 text-sm text-primary">{flag.conflict.quote}</p>
          <p className="mt-1.5 text-xs text-quaternary">{flag.conflict.label}</p>
        </div>
      </div>

      {phase === "choose" && (
        <div className="flex flex-col gap-2">
          <Eyebrow>How does this close?</Eyebrow>
          <Option
            title="Fix the content"
            desc="Edit the post so it matches. The flag closes and your grade improves."
            onClick={() => { dispatch({ type: "flag", id: flag.id, status: "fixed" }); toast("Fixed. The flag is closed."); }}
            kind="primary"
          />
          <Option
            title="It isn't inconsistent"
            desc="Argue why both can be true. The Guardian decides, not you."
            onClick={() => setPhase("reason")}
          />
          <Option
            title="True, but not worth fixing"
            desc="Closes the task. Still counts against your content grade, and stays in the notes."
            onClick={() => setPhase("not-worth")}
          />
          <Option
            title="Can't be fixed"
            desc="A sent email, a social image. Logged, and left out of the grade."
            onClick={() => setPhase("cant-fix")}
          />
        </div>
      )}

      {phase === "reason" && (
        <div className="flex flex-col gap-3 rounded-xl border border-secondary bg-secondary p-4">
          <div className="flex items-center gap-2">
            <Shield01 className="size-4 text-brand-secondary" />
            <span className="text-sm font-medium text-primary">Make the case to the Guardian</span>
          </div>
          <p className="text-xs text-tertiary">
            One sentence is enough. The Guardian builds the full reconciliation from your sources, and
            you confirm it before it rules.
          </p>
          <textarea
            id={`reason-${flag.id}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Both are true because…"
            className={cx(inputClass, "resize-y")}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" kind="ghost" onClick={() => setPhase("choose")}>
              Back
            </Button>
            <span className="flex-1" />
            <Button size="sm" kind="secondary" onClick={() => setReason(flag.guardian.draft)}>
              Use the suggested wording
            </Button>
            <Button size="sm" kind="primary" disabled={reason.trim().length < 12} onClick={submit}>
              Send to the Guardian
            </Button>
          </div>
        </div>
      )}

      {phase === "drafting" && (
        <div className="flex items-center gap-3 rounded-xl border border-secondary bg-secondary p-4">
          <span className="size-2 animate-pulse rounded-full bg-brand-solid" />
          <p className="text-sm text-secondary">The Guardian is reading the sources and your argument.</p>
        </div>
      )}

      {phase === "ruled" && verdict && (
        <Verdict verdict={verdict} flag={flag} onArgueAgain={() => { setPhase("reason"); setVerdict(null); }} onFix={() => { dispatch({ type: "flag", id: flag.id, status: "fixed" }); toast("Fixed. The flag is closed."); }} />
      )}

      {(phase === "not-worth" || phase === "cant-fix") && (
        <Confirm
          phase={phase}
          onBack={() => setPhase("choose")}
          onConfirm={() => {
            if (phase === "not-worth") {
              dispatch({ type: "flag", id: flag.id, status: "not-worth-fixing" });
              toast("Closed. It still counts against your content grade.");
            } else {
              dispatch({ type: "flag", id: flag.id, status: "cant-fix" });
              toast("Logged, and left out of the grade.");
            }
          }}
        />
      )}
    </Card>
  );
}

function Option({
  title,
  desc,
  onClick,
  kind,
}: {
  title: string;
  desc: string;
  onClick: () => void;
  kind?: "primary";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex items-start gap-3 rounded-xl border px-4 py-3 text-left transition",
        kind === "primary"
          ? "border-brand-solid bg-brand-primary hover:bg-brand-primary_alt"
          : "border-secondary bg-primary hover:bg-secondary",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-primary">{title}</span>
        <span className="block text-xs text-tertiary">{desc}</span>
      </span>
    </button>
  );
}

function Verdict({
  verdict,
  flag,
  onArgueAgain,
  onFix,
}: {
  verdict: GuardianVerdict;
  flag: Flag;
  onArgueAgain: () => void;
  onFix: () => void;
}) {
  const look = {
    admit: { tone: "good" as const, label: "Admitted", icon: <Check className="size-4" />, border: "border-success_subtle bg-success-primary" },
    contested: { tone: "warn" as const, label: "Admitted as contested", icon: <Scales02 className="size-4" />, border: "border-warning_subtle bg-warning-primary" },
    reject: { tone: "bad" as const, label: "Rejected", icon: <X className="size-4" />, border: "border-error_subtle bg-error-primary" },
    escalate: { tone: "info" as const, label: "Escalated", icon: <ArrowUpRight className="size-4" />, border: "border-brand bg-brand-primary" },
  }[verdict];

  return (
    <div className={cx("fade-up flex flex-col gap-3 rounded-xl border p-4", look.border)}>
      <div className="flex items-center gap-2">
        <Shield01 className="size-4 text-primary" />
        <span className="text-sm font-medium text-primary">The Guardian</span>
        <Pill tone={look.tone}>
          {look.icon}
          {look.label}
        </Pill>
      </div>
      <p className="max-w-[70ch] text-sm text-secondary">{flag.guardian.reason}</p>
      <div className="flex flex-wrap items-center gap-2">
        {verdict === "reject" && (
          <>
            <Button size="sm" kind="primary" onClick={onFix}>
              Fix the content instead
            </Button>
            <Button size="sm" onClick={onArgueAgain}>
              Argue again
            </Button>
          </>
        )}
        {verdict === "escalate" && (
          <Button size="sm" kind="primary" onClick={onArgueAgain}>
            Request a canon change
          </Button>
        )}
        {verdict === "contested" && (
          <p className="text-xs text-tertiary">
            It's in the knowledge base, and it will pull your knowledge base grade down until someone
            attaches the evidence.
          </p>
        )}
        {verdict === "admit" && (
          <p className="text-xs text-tertiary">The knowledge base now holds the distinction, so the next sweep won't raise it again.</p>
        )}
      </div>
    </div>
  );
}

function Confirm({ phase, onBack, onConfirm }: { phase: "not-worth" | "cant-fix"; onBack: () => void; onConfirm: () => void }) {
  const copy =
    phase === "not-worth"
      ? {
          title: "True, but not worth fixing",
          body: "The task closes. The inconsistency still counts against your content grade and stays in your notes, so this isn't a way around the grade.",
        }
      : {
          title: "Can't be fixed",
          body: "Nothing goes to the Guardian and nothing enters the knowledge base. It's logged, and left out of the content grade.",
        };
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-secondary bg-secondary p-4">
      <span className="text-sm font-medium text-primary">{copy.title}</span>
      <p className="max-w-[70ch] text-xs text-tertiary">{copy.body}</p>
      <div className="flex items-center gap-2">
        <Button size="sm" kind="ghost" onClick={onBack}>
          Back
        </Button>
        <Button size="sm" kind="primary" onClick={onConfirm}>
          Confirm
        </Button>
      </div>
    </div>
  );
}
