// Inbox: everything the agents raised that needs a person.
// Four lanes (Flags, Pitches, Knowledge, Review). A flag is always about one
// object (a blog post, a newsletter, a social post) and always contrasts it
// with a knowledge base claim or another piece of content. A pitch is a full
// brief, opened in a panel.

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Edit05,
  FileCheck02,
  Lightbulb01,
  Lock01,
  Scales02,
  SearchLg,
  Shield01,
  X,
  XClose,
} from "@untitledui/icons";
import {
  Button,
  Card,
  Dot,
  Empty,
  Eyebrow,
  Excerpt,
  OriginalLink,
  Pill,
  SourceIcon,
  TypeIcon,
  TypeLabel,
  cx,
  inputClass,
} from "../bits";
import { NEEDS_ACTION, claimOf, objectOf, sourceOf, topicName, useStore } from "../store";
import * as D from "../data";
import type { Flag, GuardianVerdict, Pitch } from "../data";

type Lane = "flags" | "pitches" | "knowledge" | "review";

export function Inbox() {
  const { s, d, dispatch, toast, go } = useStore();
  const [lane, setLane] = useState<Lane>("flags");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [pitchOpen, setPitchOpen] = useState<string | null>(null);

  const openFlags = useMemo(() => s.flags.filter((f) => NEEDS_ACTION.includes(f.status)), [s.flags]);
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
    (f) => !q.trim() || (f.excerpt.text + f.theme + objectOf(f.objectId).title).toLowerCase().includes(q.toLowerCase()),
  );
  const current = filtered.find((f) => f.id === selected) ?? filtered[0] ?? null;
  const pitch = s.pitches.find((p) => p.id === pitchOpen) ?? null;

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-5 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-title text-2xl text-primary">Inbox</h1>
          <p className="mt-0.5 text-sm text-tertiary">{d.inboxTotal} things need you. Nothing here closes itself.</p>
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
              lane === l.id ? "bg-primary text-primary shadow-xs ring-1 ring-inset ring-primary" : "text-tertiary hover:bg-primary_hover hover:text-secondary",
            )}
          >
            <span className={lane === l.id ? "text-brand-secondary" : "text-quaternary"}>{l.icon}</span>
            {l.label}
            <span className={cx("tnum rounded-full px-1.5 text-xs", l.count ? "bg-secondary text-secondary" : "text-quaternary")}>{l.count}</span>
          </button>
        ))}
      </nav>

      {lane === "flags" &&
        (filtered.length === 0 ? (
          <Card>
            <Empty title="No open flags" hint="Every inconsistency has been fixed, reconciled or logged. The weekly sweep runs Monday." />
          </Card>
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,330px)_minmax(0,1fr)]">
            <Card pad={false} className="divide-y divide-[var(--color-border-secondary)]">
              {filtered.map((f) => {
                const o = objectOf(f.objectId);
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setSelected(f.id)}
                    className={cx("flex w-full gap-3 px-4 py-3 text-left transition", current?.id === f.id ? "bg-secondary" : "hover:bg-secondary")}
                  >
                    <TypeIcon type={o.type} className="mt-0.5 size-4" />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-sm font-medium text-primary">{o.title}</span>
                      <span className="truncate text-xs text-tertiary">{f.theme}</span>
                      {(f.status !== "open" || !D.objectTypes[o.type].fixable) && (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {f.status === "rejected" && <Pill tone="bad">Guardian rejected</Pill>}
                          {f.status === "escalated" && <Pill tone="info">With the topic owner</Pill>}
                          {!D.objectTypes[o.type].fixable && (
                            <Pill tone="neutral">
                              <Lock01 className="size-3" />
                              Can't be fixed
                            </Pill>
                          )}
                        </span>
                      )}
                    </span>
                    <span className="tnum shrink-0 text-xs text-quaternary">{Math.round(f.confidence * 100)}%</span>
                  </button>
                );
              })}
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
          <Card pad={false} className="divide-y divide-[var(--color-border-secondary)]">
            {newPitches.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPitchOpen(p.id)}
                className="flex w-full flex-wrap items-start gap-x-4 gap-y-2 px-5 py-4 text-left transition hover:bg-secondary"
              >
                <TypeIcon type={p.type} className="mt-1 size-4" />
                <span className="min-w-0 flex-1">
                  <span className="block font-title text-base text-primary">{p.title}</span>
                  <span className="mt-0.5 block text-sm text-tertiary">{p.reason}</span>
                </span>
                <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <Pill tone="neutral">{topicName(p.topic)}</Pill>
                  <Pill tone={p.origin === "internal" ? "info" : "neutral"}>{p.origin === "internal" ? `${p.evidence.length} sources` : "Search demand"}</Pill>
                  <ArrowUpRight className="size-4 text-quaternary" />
                </span>
              </button>
            ))}
          </Card>
        ))}

      {lane === "knowledge" &&
        (knowledge.length === 0 ? (
          <Card>
            <Empty title="The knowledge base is clean" hint="Nothing contested, nothing contradicting." />
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="max-w-[70ch] text-sm text-tertiary">
              These lower your knowledge base grade until someone settles them. This is the cost of arguing a flag
              away instead of fixing the content.
            </p>
            {knowledge.map((k) => (
              <Card key={k.id} className="flex flex-wrap items-start gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Pill tone={k.kind === "contested" ? "warn" : "bad"}>{k.kind === "contested" ? "Contested" : "Contradiction"}</Pill>
                    <span className="text-xs text-quaternary">since {k.since}</span>
                  </div>
                  <p className="mt-2 text-sm text-primary">{k.claim}</p>
                  <p className="mt-1 text-xs text-tertiary">{k.why}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button size="sm" onClick={() => toast("Asked the topic owner for a source")}>Ask for evidence</Button>
                  <Button size="sm" kind="primary" onClick={() => { dispatch({ type: "kbResolve", id: k.id }); toast("Settled. The knowledge base grade improves."); }}>
                    Settle it
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
                <TypeIcon type="blog" />
                <div className="min-w-0 flex-1">
                  <h3 className="font-title text-base text-primary">{r.title}</h3>
                  <p className="mt-0.5 text-xs text-tertiary">
                    {r.writer} · <span className="tnum">{r.words}</span> words · <span className="tnum">{r.suggestions}</span> agent
                    suggestions to accept or reject · due {r.due}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Pill tone="neutral">{topicName(r.topic)}</Pill>
                  <Button size="sm" onClick={() => go(`post-${r.objectId}`)}>
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

      {pitch && <PitchPanel pitch={pitch} onClose={() => setPitchOpen(null)} />}
    </div>
  );
}

// ── The flag case ──────────────────────────────────────────────────────

type Phase = "choose" | "edit" | "reason" | "drafting" | "ruled" | "not-worth";

export function FlagCase({ flag }: { flag: Flag }) {
  const { dispatch, toast, go } = useStore();
  const o = objectOf(flag.objectId);
  const type = D.objectTypes[o.type];
  const [phase, setPhase] = useState<Phase>(flag.status === "rejected" || flag.status === "escalated" ? "ruled" : "choose");
  const [reason, setReason] = useState("");
  const [fix, setFix] = useState(flag.fix ?? "");
  const [verdict, setVerdict] = useState<GuardianVerdict | null>(
    flag.status === "rejected" ? "reject" : flag.status === "escalated" ? "escalate" : null,
  );

  const applyFix = () => {
    dispatch({ type: "applyFix", id: flag.id, fix });
    toast(`Fixed. ${type.label} updated, and the flag is closed.`);
  };

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
        dispatch({ type: "kbContest", claim: flag.excerpt.text, why: "Admitted on a thin argument." });
        toast("Admitted as contested. Your knowledge base grade drops.");
      } else if (v === "reject") {
        dispatch({ type: "flag", id: flag.id, status: "rejected", rejection: flag.guardian.reason });
        toast("The Guardian rejected it. The flag stays open.");
      } else {
        dispatch({ type: "flag", id: flag.id, status: "escalated" });
        toast("Sent to the topic owner: this is a change of position.");
      }
    }, 1100);
  };

  return (
    <Card className="fade-up flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <TypeLabel type={o.type} />
            <span className="tnum text-xs text-quaternary">{o.type === "newsletter" ? "sent" : "published"} {o.date}</span>
          </div>
          <h2 className="mt-1.5 font-title text-xl text-primary">{o.title}</h2>
          <p className="mt-0.5 text-xs text-quaternary">
            {flag.theme} · raised {flag.raised} · confidence <span className="tnum">{Math.round(flag.confidence * 100)}%</span>
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-3">
          <OriginalLink url={o.url} label="View live" />
          <Button size="sm" onClick={() => go(`post-${o.id}`)}>Open in editor</Button>
        </span>
      </header>

      <div className="grid gap-5 xl:grid-cols-2">
        <Excerpt
          excerpt={flag.excerpt}
          head={
            <>
              <TypeIcon type={o.type} className="size-3.5" />
              <span className="font-medium text-secondary">This {type.label.toLowerCase()} says</span>
            </>
          }
        />
        <Against flag={flag} />
      </div>

      {!type.fixable && phase === "choose" && (
        <div className="flex items-start gap-3 rounded-xl border border-secondary bg-secondary p-4">
          <Lock01 className="mt-0.5 size-4 shrink-0 text-tertiary" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-primary">{type.label}: can't be fixed</p>
            <p className="mt-0.5 text-xs text-tertiary">
              {type.why} This flag is logged and left out of your content grade. It still counts as a mistake the
              team made, in the notes.
            </p>
          </div>
        </div>
      )}

      {phase === "choose" && (
        <div className="flex flex-col gap-3">
          {type.fixable && flag.fix && (
            <div className="flex flex-col gap-3 rounded-xl border border-brand-solid bg-primary p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-primary">The fix</span>
                <span className="text-xs text-quaternary">Applied as a suggestion in the editor</span>
              </div>
              <Excerpt
                excerpt={flag.excerpt}
                replace={fix}
                head={
                  <>
                    <Edit05 className="size-3.5" />
                    Proposed edit
                  </>
                }
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" kind="primary" onClick={applyFix}>
                  <Check className="size-3.5" />
                  Apply the fix
                </Button>
                <Button size="sm" onClick={() => setPhase("edit")}>
                  Edit it
                </Button>
              </div>
            </div>
          )}
          <Eyebrow>{type.fixable ? "Or close it another way" : "How does this close?"}</Eyebrow>
          <div className="grid gap-2 sm:grid-cols-2">
            <Option title="It isn't inconsistent" desc="Argue why both can be true. The Guardian decides, not you." onClick={() => setPhase("reason")} />
            {type.fixable ? (
              <Option title="True, but not worth fixing" desc="Closes the task. Still counts against your content grade." onClick={() => setPhase("not-worth")} />
            ) : (
              <Option
                title="Acknowledge"
                desc="Logged as a mistake that can't be undone. Out of the grade."
                onClick={() => { dispatch({ type: "flag", id: flag.id, status: "cant-fix" }); toast("Logged. It stays in the notes, out of the grade."); }}
              />
            )}
          </div>
        </div>
      )}

      {phase === "edit" && (
        <div className="flex flex-col gap-3 rounded-xl border border-brand-solid bg-primary p-4">
          <span className="text-sm font-medium text-primary">Edit the fix</span>
          <p className="text-xs text-tertiary">Replaces: “{flag.excerpt.text}”</p>
          <textarea id={`fix-${flag.id}`} rows={2} value={fix} onChange={(e) => setFix(e.target.value)} className={cx(inputClass, "resize-y")} />
          <Excerpt excerpt={flag.excerpt} replace={fix} head={<>Preview</>} />
          <div className="flex items-center gap-2">
            <Button size="sm" kind="ghost" onClick={() => setPhase("choose")}>Back</Button>
            <Button size="sm" kind="primary" disabled={!fix.trim()} onClick={applyFix}>Apply the fix</Button>
          </div>
        </div>
      )}

      {phase === "reason" && (
        <div className="flex flex-col gap-3 rounded-xl border border-secondary bg-secondary p-4">
          <div className="flex items-center gap-2">
            <Shield01 className="size-4 text-brand-secondary" />
            <span className="text-sm font-medium text-primary">Make the case to the Guardian</span>
          </div>
          <p className="text-xs text-tertiary">
            One sentence is enough. The Guardian builds the full reconciliation from your sources, and you confirm it before it rules.
          </p>
          <textarea id={`reason-${flag.id}`} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Both are true because…" className={cx(inputClass, "resize-y")} />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" kind="ghost" onClick={() => setPhase("choose")}>Back</Button>
            <span className="flex-1" />
            <Button size="sm" onClick={() => setReason(flag.guardian.draft)}>Use the suggested wording</Button>
            <Button size="sm" kind="primary" disabled={reason.trim().length < 12} onClick={submit}>Send to the Guardian</Button>
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
        <Verdict
          verdict={verdict}
          flag={flag}
          fixable={type.fixable}
          onArgueAgain={() => { setPhase("reason"); setVerdict(null); }}
          onFix={() => setPhase("choose")}
        />
      )}

      {phase === "not-worth" && (
        <div className="flex flex-col gap-3 rounded-xl border border-secondary bg-secondary p-4">
          <span className="text-sm font-medium text-primary">True, but not worth fixing</span>
          <p className="max-w-[70ch] text-xs text-tertiary">
            The task closes. The inconsistency still counts against your content grade and stays in your notes, so this isn't a way around the grade.
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" kind="ghost" onClick={() => setPhase("choose")}>Back</Button>
            <Button size="sm" kind="primary" onClick={() => { dispatch({ type: "flag", id: flag.id, status: "not-worth-fixing" }); toast("Closed. It still counts against your content grade."); }}>
              Confirm
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/** The other side of the flag: a knowledge base claim with its evidence, or another piece of content. */
function Against({ flag }: { flag: Flag }) {
  if (flag.against.kind === "content") {
    const other = objectOf(flag.against.objectId);
    return (
      <div className="flex min-w-0 flex-col gap-2">
        <Excerpt
          excerpt={flag.against.excerpt}
          mark="neutral"
          head={
            <>
              <TypeIcon type={other.type} className="size-3.5" />
              <span className="font-medium text-secondary">Contradicts another {D.objectTypes[other.type].label.toLowerCase()}</span>
            </>
          }
        />
        <p className="text-xs text-tertiary">
          “{other.title}”, {other.date}. Neither is in the knowledge base yet, so one of them has to give.
        </p>
      </div>
    );
  }
  const c = claimOf(flag.against.claimId);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs text-tertiary">
          <Scales02 className="size-3.5" />
          <span className="font-medium text-secondary">Contradicts the knowledge base</span>
        </span>
        <Pill tone={c.status === "Settled" ? "good" : "warn"}>{c.status}</Pill>
      </div>
      <div className="rounded-lg border border-secondary bg-primary px-3 py-2.5">
        <p className="text-sm text-primary">{c.text}</p>
        <p className="mt-1 text-xs text-quaternary">
          {topicName(c.topic)} · added by {c.addedBy} · since {c.since}
        </p>
      </div>
      <details className="group">
        <summary className="cursor-pointer list-none text-xs font-medium text-tertiary hover:text-secondary">
          <span className="group-open:hidden">Show the evidence ({c.evidence.length})</span>
          <span className="hidden group-open:inline">Hide the evidence</span>
        </summary>
        <div className="mt-2 flex flex-col gap-3">
          {c.evidence.map((e) => {
            const src = sourceOf(e.sourceId);
            return (
              <Excerpt
                key={e.url}
                excerpt={e}
                mark="neutral"
                head={
                  <>
                    <SourceIcon kind={src.kind} />
                    {src.title}, {src.date}
                  </>
                }
              />
            );
          })}
        </div>
      </details>
    </div>
  );
}

function Option({ title, desc, onClick }: { title: string; desc: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-start gap-0.5 rounded-xl border border-secondary bg-primary px-4 py-3 text-left transition hover:bg-secondary">
      <span className="text-sm font-medium text-primary">{title}</span>
      <span className="text-xs text-tertiary">{desc}</span>
    </button>
  );
}

function Verdict({
  verdict,
  flag,
  fixable,
  onArgueAgain,
  onFix,
}: {
  verdict: GuardianVerdict;
  flag: Flag;
  fixable: boolean;
  onArgueAgain: () => void;
  onFix: () => void;
}) {
  const { toast } = useStore();
  const look = {
    admit: { tone: "good" as const, label: "Admitted", icon: <Check className="size-4" />, border: "border-success_subtle bg-success-primary" },
    contested: { tone: "warn" as const, label: "Admitted as contested", icon: <Scales02 className="size-4" />, border: "border-warning_subtle bg-warning-primary" },
    reject: { tone: "bad" as const, label: "Rejected", icon: <X className="size-4" />, border: "border-error_subtle bg-error-primary" },
    escalate: { tone: "info" as const, label: "Sent to the topic owner", icon: <ArrowUpRight className="size-4" />, border: "border-brand bg-brand-primary" },
  }[verdict];

  return (
    <div className={cx("fade-up flex flex-col gap-3 rounded-xl border p-4", look.border)}>
      <div className="flex flex-wrap items-center gap-2">
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
            {fixable && <Button size="sm" kind="primary" onClick={onFix}>See the fix</Button>}
            <Button size="sm" onClick={onArgueAgain}>Argue again</Button>
          </>
        )}
        {verdict === "escalate" && (
          <p className="text-xs text-tertiary">
            The owner of {topicName(objectOf(flag.objectId).topic)} decides. If they change the position, the knowledge base changes
            and every piece that relies on the old one gets re-checked.{" "}
            <button type="button" className="font-medium text-brand-secondary hover:underline" onClick={() => toast("Nudged the topic owner")}>
              Nudge them
            </button>
          </p>
        )}
        {verdict === "contested" && (
          <p className="text-xs text-tertiary">It's in the knowledge base, and it pulls the knowledge base grade down until someone attaches the evidence.</p>
        )}
        {verdict === "admit" && <p className="text-xs text-tertiary">The knowledge base holds the distinction now, so the next sweep won't raise it again.</p>}
      </div>
    </div>
  );
}

// ── The pitch, as a full brief ─────────────────────────────────────────

function PitchPanel({ pitch: p, onClose }: { pitch: Pitch; onClose: () => void }) {
  const { s, dispatch, toast, go } = useStore();
  const topic = s.topics.find((t) => t.id === p.topic);
  const [owner, setOwner] = useState(p.suggestedOwner);
  const [date, setDate] = useState(p.suggestedDate);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const decide = (status: "accepted" | "backlog" | "ditched", text: string) => {
    dispatch({ type: "pitch", id: p.id, status });
    toast(text);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-overlay/40 backdrop-blur-[2px]" onClick={onClose}>
      <aside
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={p.title}
        className="fade-up flex h-full w-full max-w-[760px] flex-col border-l border-secondary bg-primary shadow-2xl"
      >
        <header className="flex items-start gap-3 border-b border-secondary px-6 py-5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Eyebrow>Pitch</Eyebrow>
              <Pill tone={p.origin === "internal" ? "info" : "neutral"}>{p.origin === "internal" ? "From our knowledge" : "Search demand"}</Pill>
            </div>
            <h2 className="mt-2 font-title text-2xl text-primary">{p.title}</h2>
            <p className="mt-1 text-sm text-secondary">{p.reason}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-quaternary hover:bg-primary_hover hover:text-secondary">
            <XClose className="size-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="flex flex-col gap-7">
            {/* The brief's header: the facts a writer needs before starting */}
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              <Fact label="Format"><TypeLabel type={p.type} /></Fact>
              <Fact label="Topic">
                <span className="text-sm text-primary">{topicName(p.topic)}</span>
                {topic && (
                  <span className="tnum block text-xs text-tertiary">
                    {topic.published} published of {topic.range[0]}–{topic.range[1]}
                  </span>
                )}
              </Fact>
              <Fact label="Length"><span className="tnum text-sm text-primary">{p.words[0].toLocaleString()}–{p.words[1].toLocaleString()} words</span></Fact>
              <Fact label="Writer">
                <select id={`owner-${p.id}`} value={owner} onChange={(e) => setOwner(e.target.value)} className={cx(inputClass, "py-1.5")}>
                  {D.team.map((t) => <option key={t.email}>{t.name}</option>)}
                  <option>Agent</option>
                </select>
              </Fact>
              <Fact label="Publish by">
                <input id={`date-${p.id}`} type="date" value={date} onChange={(e) => setDate(e.target.value)} className={cx(inputClass, "tnum py-1.5")} />
              </Fact>
              <Fact label="Keywords">
                <span className="flex flex-wrap gap-1">{p.keywords.map((k) => <Pill key={k}>{k}</Pill>)}</span>
              </Fact>
            </dl>

            <Section title="Angle"><p className="text-sm leading-relaxed text-primary">{p.angle}</p></Section>
            <Section title="Who it's for"><p className="text-sm leading-relaxed text-primary">{p.audience}</p></Section>

            <Section title="Outline">
              <ol className="flex flex-col gap-2">
                {p.outline.map((line, i) => (
                  <li key={line} className="flex gap-3 text-sm text-primary">
                    <span className="tnum w-5 shrink-0 text-right text-quaternary">{i + 1}.</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ol>
            </Section>

            {p.claimIds.length > 0 && (
              <Section title="Knowledge it relies on" hint="The draft is checked against these. If one changes, the post gets re-checked.">
                <ul className="flex flex-col gap-2">
                  {p.claimIds.map((id) => {
                    const c = claimOf(id);
                    return (
                      <li key={id} className="flex items-start gap-3 rounded-lg border border-secondary px-3 py-2.5">
                        <Scales02 className="mt-0.5 size-4 shrink-0 text-quaternary" />
                        <span className="min-w-0 flex-1 text-sm text-primary">{c.text}</span>
                        <Pill tone={c.status === "Settled" ? "good" : "warn"}>{c.status}</Pill>
                      </li>
                    );
                  })}
                </ul>
              </Section>
            )}

            {p.evidence.length > 0 && (
              <Section title={`Sources (${p.evidence.length})`} hint="Quoted here for the writer. Quotes never go into the published piece.">
                <div className="flex flex-col gap-4">
                  {p.evidence.map((e) => {
                    const src = sourceOf(e.sourceId);
                    return (
                      <Excerpt
                        key={e.url}
                        excerpt={e}
                        mark="neutral"
                        head={
                          <>
                            <SourceIcon kind={src.kind} />
                            <span className="text-secondary">{src.title}</span>
                            <span className="text-quaternary">· {src.date}</span>
                          </>
                        }
                      />
                    );
                  })}
                </div>
              </Section>
            )}

            {p.search && (
              <Section title="Search demand">
                <div className="overflow-x-auto rounded-lg border border-secondary">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-secondary text-left text-xs text-quaternary">
                        <th className="px-3 py-2 font-medium">Keyword</th>
                        <th className="px-3 py-2 text-right font-medium">Searches / mo</th>
                        <th className="px-3 py-2 text-right font-medium">Difficulty</th>
                        <th className="px-3 py-2 text-right font-medium">We rank</th>
                      </tr>
                    </thead>
                    <tbody className="tnum">
                      {p.search.map((k) => (
                        <tr key={k.keyword} className="border-t border-secondary">
                          <td className="px-3 py-2 text-primary">{k.keyword}</td>
                          <td className="px-3 py-2 text-right text-secondary">{k.volume.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right text-secondary">{k.difficulty}</td>
                          <td className="px-3 py-2 text-right text-tertiary">{k.rank}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            )}

            <Section title="What we already have" hint="Why this isn't a duplicate.">
              <ul className="flex flex-col gap-2">
                {p.related.map((r) => {
                  const o = objectOf(r.objectId);
                  return (
                    <li key={r.objectId} className="flex items-start gap-3 rounded-lg bg-secondary px-3 py-2.5">
                      <TypeIcon type={o.type} className="mt-0.5 size-4" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-primary">{o.title}</span>
                        <span className="block text-xs text-tertiary">{r.overlap}</span>
                      </span>
                      <OriginalLink url={o.url} label="Open" />
                    </li>
                  );
                })}
              </ul>
            </Section>
          </div>
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-secondary px-6 py-4">
          <Button kind="ghost" onClick={() => decide("ditched", "Ditched")}>Ditch</Button>
          <Button onClick={() => decide("backlog", "Backlogged, ranked by your goals")}>Backlog</Button>
          <span className="flex-1" />
          <span className="text-xs text-tertiary">
            {owner} · by {date}
          </span>
          <Button
            kind="primary"
            onClick={() => {
              const id = "n" + p.id;
              dispatch({
                type: "newPost",
                obj: { id, type: p.type, group: p.topic === "close" || p.topic === "controls" ? "guides" : "product", title: p.title, topic: p.topic, date, url: "", status: "draft", briefId: p.id },
                body: [""],
              });
              decide("accepted", `Draft created for ${owner}, due ${date}`);
              go(`post-${id}`);
            }}
          >
            Accept and start a draft
          </Button>
        </footer>
      </aside>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-quaternary">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <div>
        <h3 className="text-sm font-semibold text-primary">{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-tertiary">{hint}</p>}
      </div>
      {children}
    </section>
  );
}
