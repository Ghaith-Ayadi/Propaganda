// Pipeline: idea → pitch → writing → review → scheduled. A board on the left,
// a full-height week on the right. Pitches open as a full brief in a drawer;
// a draft in review opens as the review page. Ideas the agent set aside never
// show up here: a pitch exists only when there's a reason behind it.

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, ChevronLeft, ChevronRight, Plus, Scales02, XClose } from "@untitledui/icons";
import { Button, Eyebrow, Excerpt, OriginalLink, Pill, SourceIcon, TypeIcon, TypeLabel, cx, inputClass } from "../bits";
import { bodyFor, claimOf, objectOf, sourceOf, topicName, useStore } from "../store";
import * as D from "../data";
import type { ContentObject, Pitch } from "../data";

const collName = (id: string) => D.collections.find((c) => c.id === id)?.name ?? id;
const collFor = (p: Pitch) => (p.topic === "erp" || p.topic === "pricing" ? "product" : "guides");

// ── Dates ──────────────────────────────────────────────────────────────

const day = (iso: string) => new Date(iso + "T12:00:00Z");
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (isoDate: string, n: number) => {
  const d = day(isoDate);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
const fmt = (isoDate: string, opts: Intl.DateTimeFormatOptions) => day(isoDate).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });
export const short = (isoDate: string) => fmt(isoDate, { month: "short", day: "numeric" });
/** Cadence slots: the days a post is expected. Two a week. */
const SLOT_DAYS = ["Tue", "Thu"];

// ── The board ──────────────────────────────────────────────────────────

type Column = { id: string; label: string; hint?: string };
const COLUMNS: Column[] = [
  { id: "pitched", label: "Pitched", hint: "Waiting on you: approve, add notes, or reject with a reason." },
  { id: "writing", label: "Writing" },
  { id: "review", label: "In review" },
  { id: "scheduled", label: "Scheduled" },
];

export function Pipeline() {
  const { s, go } = useStore();
  const [open, setOpen] = useState<string | null>(null);
  const blog = s.objects.filter((o) => o.type === "blog");
  const pitched = s.pitches.filter((p) => p.status === "new").sort((a, b) => (a.fit === b.fit ? 0 : a.fit === "Strong" ? -1 : 1));
  const byStep = (step: string) =>
    blog
      .filter((o) => (step === "scheduled" ? o.status === "scheduled" : o.status === "draft" && o.step === step))
      .sort((a, b) => a.date.localeCompare(b.date));
  const pitch = s.pitches.find((p) => p.id === open) ?? null;

  const openObject = (o: ContentObject) => go(o.step === "review" ? `review-${o.id}` : `post-${o.id}`);

  return (
    <div className="grid min-h-full xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-5 px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-title text-2xl text-primary">Pipeline</h1>
            <p className="mt-0.5 max-w-[70ch] text-sm text-tertiary">
              The agent only pitches ideas with a reason behind them. The rest are set aside with that reason, and you never see them.
            </p>
          </div>
          <Button size="sm" iconLeading={<Plus className="size-3.5" />} onClick={() => go("blog")}>
            Write something yourself
          </Button>
        </header>

        <div className="-mx-1 overflow-x-auto pb-2">
        <div className="grid min-w-[780px] grid-cols-4 items-start gap-3 px-1">
          {COLUMNS.map((c) => {
            const n = c.id === "pitched" ? pitched.length : byStep(c.id).length;
            return (
              <section key={c.id} className="flex min-w-0 flex-col gap-2 rounded-xl bg-primary/40 p-1">
                <h2 className="flex items-center justify-between px-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-quaternary">
                  {c.label}
                  <span className="tnum">{n}</span>
                </h2>
                {c.hint && n > 0 && <p className="-mt-1 px-1.5 text-xs text-tertiary">{c.hint}</p>}
                {c.id === "pitched"
                  ? pitched.map((p) => (
                      <BoardCard key={p.id} onClick={() => setOpen(p.id)} title={p.title}>
                        <Pill tone={p.fit === "Strong" ? "good" : p.fit === "Fair" ? "warn" : "bad"}>{p.fit} fit</Pill>
                        <Pill>{collName(collFor(p))}</Pill>
                        <span>{p.suggestedOwner}</span>
                        <span>by {short(p.suggestedDate)}</span>
                      </BoardCard>
                    ))
                  : byStep(c.id).map((o) => (
                      <BoardCard key={o.id} onClick={() => openObject(o)} title={o.title || "Untitled"}>
                        <Pill>{collName(o.group)}</Pill>
                        {o.step === "writing" && o.notes && o.notes.length > 0 && (
                          <Pill tone="warn">
                            {o.notes.length} reviewer {o.notes.length === 1 ? "note" : "notes"}
                          </Pill>
                        )}
                        <span>{o.writer ?? "You"}</span>
                        {o.reviewer && c.id !== "scheduled" && <span>→ {o.reviewer === D.me.name ? "you" : o.reviewer}</span>}
                        <span>
                          {c.id === "scheduled" ? "" : "by "}
                          {short(o.date)}
                        </span>
                      </BoardCard>
                    ))}
                {n === 0 && <div className="rounded-lg border border-dashed border-secondary px-3 py-4 text-center text-xs text-quaternary">Nothing here</div>}
              </section>
            );
          })}
        </div>
        </div>
      </div>

      <Week />

      {pitch && <PitchDrawer pitch={pitch} onClose={() => setOpen(null)} />}
    </div>
  );
}

function BoardCard({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full flex-col gap-2 rounded-lg border border-secondary bg-primary px-3 py-2.5 text-left shadow-xs transition hover:border-primary"
    >
      <span className="text-sm font-medium leading-snug text-primary">{title}</span>
      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-tertiary">{children}</span>
    </button>
  );
}

// ── The week ───────────────────────────────────────────────────────────

function Week() {
  const { s, go } = useStore();
  const monday = "2026-10-05";
  const [start, setStart] = useState(monday);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const blog = s.objects.filter((o) => o.type === "blog" && o.status !== "draft" || (o.type === "blog" && o.step === "review"));
  const inWeek = blog.filter((o) => o.date >= days[0] && o.date <= days[6]);
  const published = inWeek.filter((o) => o.status === "published").length;

  return (
    <aside className="flex min-w-0 flex-col border-t border-secondary bg-primary xl:sticky xl:top-0 xl:h-screen xl:border-t-0 xl:border-l" aria-label="This week">
      <div className="flex items-center justify-between gap-2 border-b border-secondary px-5 pt-6 pb-3">
        <div>
          <Eyebrow>{start === monday ? "This week" : "Week of"}</Eyebrow>
          <h2 className="font-title text-xl text-primary">
            {short(days[0])} to {fmt(days[6], { day: "numeric" })}
          </h2>
        </div>
        <div className="flex gap-1">
          <button type="button" aria-label="Previous week" onClick={() => setStart(addDays(start, -7))} className="grid size-8 place-items-center rounded-md ring-1 ring-inset ring-primary text-secondary hover:bg-primary_hover">
            <ChevronLeft className="size-4" />
          </button>
          <button type="button" aria-label="Next week" onClick={() => setStart(addDays(start, 7))} className="grid size-8 place-items-center rounded-md ring-1 ring-inset ring-primary text-secondary hover:bg-primary_hover">
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
      <div className="tnum border-b border-secondary px-5 py-2.5 text-xs text-tertiary">
        Cadence goal {D.cadence} a week · {inWeek.length} planned · {published} published
      </div>
      <ol className="flex-1 overflow-y-auto">
        {days.map((dd) => {
          const name = fmt(dd, { weekday: "short" });
          const posts = inWeek.filter((o) => o.date === dd);
          const today = dd === D.TODAY;
          return (
            <li key={dd} className="flex flex-col gap-2 border-b border-secondary px-5 py-3">
              <div className="flex justify-between text-xs text-tertiary">
                <span className={cx("font-semibold", today ? "text-brand-secondary" : "text-primary")}>
                  {name} {short(dd)}
                </span>
                {today && <span>today</span>}
              </div>
              {posts.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => go(o.step === "review" ? `review-${o.id}` : `post-${o.id}`)}
                  className={cx(
                    "flex flex-col gap-1 rounded-lg px-3 py-2.5 text-left ring-1 ring-inset ring-transparent transition hover:ring-secondary",
                    o.status === "published" ? "bg-success-primary" : "bg-secondary",
                  )}
                >
                  <span className="text-sm font-medium leading-snug text-primary">{o.title}</span>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-tertiary">
                    <Pill>{collName(o.group)}</Pill>
                    {o.writer && <span>{o.writer}</span>}
                  </span>
                  <span className="text-xs text-tertiary">
                    <span className="tnum font-mono text-[11px]">9:00</span>{" "}
                    {o.status === "published" ? "Published" : o.status === "scheduled" ? "Scheduled" : today ? "In review, due today" : "In review"}
                  </span>
                </button>
              ))}
              {posts.length === 0 && SLOT_DAYS.includes(name) && dd >= D.TODAY && (
                <div className="rounded-lg border border-dashed border-secondary px-3 py-2.5 text-xs text-tertiary">
                  Open slot. Approve a pitch to fill it.
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

// ── The pitch, as a full brief ─────────────────────────────────────────

const CHIPS = ["Don't focus on…", "Take a different angle:", "Structure it like this:", "Mention…", "Provide examples here"];

export function PitchDrawer({ pitch: p, onClose }: { pitch: Pitch; onClose: () => void }) {
  const { s, dispatch, toast } = useStore();
  const topic = s.topics.find((t) => t.id === p.topic);
  const [owner, setOwner] = useState(p.suggestedOwner);
  const [reviewer, setReviewer] = useState(p.reviewer);
  const [date, setDate] = useState(p.suggestedDate);
  const [lineNotes, setLineNotes] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [why, setWhy] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const allNotes = useMemo(
    () => [
      ...Object.entries(lineNotes)
        .filter(([, v]) => v.trim())
        .map(([i, v]) => `${v.trim()}, on “${p.outline[Number(i)]}”`),
      ...notes.split("\n").map((x) => x.trim()).filter(Boolean),
    ],
    [lineNotes, notes, p.outline],
  );

  const approve = () => {
    dispatch({
      type: "pitch",
      id: p.id,
      status: "accepted",
      draft: { id: "n" + p.id, type: p.type, group: collFor(p), title: p.title, topic: p.topic, date, url: "", status: "draft", briefId: p.id, step: "writing", writer: owner, reviewer, notes: allNotes },
    });
    toast(owner === "Agent" ? `Approved. The writer agent starts now, due ${short(date)}.` : `Approved. ${owner} has it, due ${short(date)}.`);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-overlay/40 backdrop-blur-[2px]" onClick={onClose}>
      <aside onClick={(e) => e.stopPropagation()} role="dialog" aria-label={p.title} className="fade-up flex h-full w-full max-w-[720px] flex-col border-l border-secondary bg-primary shadow-2xl">
        <header className="flex items-start gap-3 border-b border-secondary px-6 py-5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Eyebrow>Pitch</Eyebrow>
              <Pill tone={p.fit === "Strong" ? "good" : p.fit === "Fair" ? "warn" : "bad"}>{p.fit} fit</Pill>
              <Pill>{collName(collFor(p))}</Pill>
              <span className="text-xs text-tertiary">from the {p.origin === "internal" ? "calls and documents" : "search data"}</span>
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
            <Section title="Why this, why now">
              <ul className="flex flex-col gap-1.5">
                {p.reasons.map(([g, t]) => (
                  <li key={g} className="grid gap-x-3 rounded-lg bg-secondary px-3 py-2 text-sm sm:grid-cols-[110px_minmax(0,1fr)]">
                    <span className="font-medium text-primary">{g}</span>
                    <span className="text-secondary">{t}</span>
                  </li>
                ))}
              </ul>
            </Section>

            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              <Fact label="Writer">
                <select id={`owner-${p.id}`} value={owner} onChange={(e) => setOwner(e.target.value)} className={cx(inputClass, "py-1.5")}>
                  <option>Agent</option>
                  {D.team.map((t) => <option key={t.email}>{t.name}</option>)}
                </select>
              </Fact>
              <Fact label="Reviewer">
                <select id={`reviewer-${p.id}`} value={reviewer} onChange={(e) => setReviewer(e.target.value)} className={cx(inputClass, "py-1.5")}>
                  {D.team.map((t) => <option key={t.email}>{t.name}</option>)}
                </select>
              </Fact>
              <Fact label="Publish by">
                <input id={`date-${p.id}`} type="date" value={date} onChange={(e) => setDate(e.target.value)} className={cx(inputClass, "tnum py-1.5")} />
              </Fact>
              <Fact label="Format"><TypeLabel type={p.type} /></Fact>
              <Fact label="Topic">
                <span className="text-sm text-primary">{topicName(p.topic)}</span>
                {topic && <span className="tnum block text-xs text-tertiary">{topic.published} published of {topic.range[0]}–{topic.range[1]}</span>}
              </Fact>
              <Fact label="Length"><span className="tnum text-sm text-primary">{p.words[0].toLocaleString()}–{p.words[1].toLocaleString()} words</span></Fact>
            </dl>

            <Section title="Angle"><p className="text-sm leading-relaxed text-primary">{p.angle}</p></Section>
            <Section title="Who it's for"><p className="text-sm leading-relaxed text-primary">{p.audience}</p></Section>

            <Section title="Outline" hint="Hover a line to leave a note on it.">
              <ol className="flex flex-col gap-0.5">
                {p.outline.map((line, i) => (
                  <li key={line} className="group flex flex-col gap-1 rounded-md px-2 py-1.5 hover:bg-secondary">
                    <div className="flex items-baseline gap-3 text-sm text-primary">
                      <span className="tnum w-5 shrink-0 text-right text-quaternary">{i + 1}.</span>
                      <span className="min-w-0 flex-1">{line}</span>
                      {lineNotes[i] === undefined && (
                        <button type="button" onClick={() => setLineNotes((n) => ({ ...n, [i]: "" }))} className="shrink-0 text-xs text-tertiary opacity-0 transition group-hover:opacity-100 focus:opacity-100">
                          + Note
                        </button>
                      )}
                    </div>
                    {lineNotes[i] !== undefined && (
                      <textarea
                        id={`line-${p.id}-${i}`}
                        autoFocus
                        value={lineNotes[i]}
                        onChange={(e) => setLineNotes((n) => ({ ...n, [i]: e.target.value }))}
                        placeholder="Note on this section"
                        rows={1}
                        className="ml-8 resize-y rounded-md bg-warning-primary px-2 py-1.5 text-sm text-primary outline-none placeholder:text-placeholder"
                      />
                    )}
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
              <Section title={`Sources (${p.evidence.length})`} hint="Quoted here for the writer, each linked to the moment it was said.">
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

            <Section title="Notes for the writer">
              <div className="flex flex-wrap gap-1.5">
                {CHIPS.map((c) => (
                  <button key={c} type="button" onClick={() => setNotes((n) => (n ? n + "\n" : "") + c + " ")} className="rounded-full px-2.5 py-1 text-xs text-tertiary ring-1 ring-inset ring-primary transition hover:text-primary">
                    {c}
                  </button>
                ))}
              </div>
              <textarea id={`notes-${p.id}`} value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Optional. Leave empty to approve as is." className={cx(inputClass, "resize-y")} />
            </Section>
          </div>
        </div>

        <footer className="border-t border-secondary px-6 py-4">
          {rejecting ? (
            <div className="flex flex-col gap-2.5 rounded-xl bg-error-primary p-3">
              <label htmlFor={`why-${p.id}`} className="text-[11px] font-semibold uppercase tracking-wider text-error-primary">Why reject it? Required.</label>
              <textarea
                id={`why-${p.id}`}
                autoFocus
                value={why}
                onChange={(e) => setWhy(e.target.value)}
                rows={2}
                placeholder="e.g. We don't write about SOC 2 until Type II is done. Our readers are controllers, not auditors."
                className={cx(inputClass, "resize-y")}
              />
              <p className="text-xs text-secondary">Your reasons teach Propaganda your strategy and taste, so the next pitches fit better.</p>
              <div className="flex items-center gap-2">
                <Button kind="ghost" size="sm" onClick={() => setRejecting(false)}>Cancel</Button>
                <span className="flex-1" />
                <Button
                  kind="danger"
                  size="sm"
                  disabled={why.trim().length < 10}
                  onClick={() => {
                    dispatch({ type: "pitch", id: p.id, status: "rejected" });
                    toast("Rejected. The reason goes into how pitches are rated.");
                    onClose();
                  }}
                >
                  Reject pitch
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button kind="danger" onClick={() => setRejecting(true)}>Reject…</Button>
              <span className="flex-1" />
              <span className="text-xs text-tertiary">
                {owner === "Agent" ? "Writer agent" : owner} · {reviewer === D.me.name ? "you review" : `${reviewer} reviews`} · by {short(date)}
              </span>
              <Button kind="primary" onClick={approve}>{allNotes.length ? "Approve with notes" : "Approve as is"}</Button>
            </div>
          )}
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

// ── Review ─────────────────────────────────────────────────────────────

type Mark = { text: string; kind: "ok" | "bad" | "kb" };

function marked(para: string, marks: Mark[]) {
  const out: React.ReactNode[] = [];
  let rest = para;
  let k = 0;
  while (rest) {
    const hits = marks.map((m) => ({ m, at: rest.indexOf(m.text) })).filter((h) => h.at >= 0).sort((a, b) => a.at - b.at);
    if (!hits.length) {
      out.push(rest);
      break;
    }
    const { m, at } = hits[0];
    out.push(rest.slice(0, at));
    out.push(
      <mark
        key={k++}
        className={cx(
          "bg-transparent text-inherit",
          m.kind === "ok" && "bg-success-primary border-b-2 border-[var(--color-bg-success-solid)]",
          m.kind === "bad" && "bg-error-primary border-b-2 border-[var(--color-border-error)]",
          m.kind === "kb" && "bg-secondary border-b-2 border-dotted border-[var(--color-fg-quaternary)]",
        )}
      >
        {m.text}
      </mark>,
    );
    rest = rest.slice(at + m.text.length);
  }
  return out;
}

export function Review({ id }: { id: string }) {
  const { s, dispatch, toast, go } = useStore();
  const o = s.objects.find((x) => x.id === id)!;
  const notes = D.reviewNotes[id] ?? { checks: [], remember: [] };
  const [remembered, setRemembered] = useState<Record<string, "yes" | "no">>({});
  const body = bodyFor(s, id).filter(Boolean);
  const marks: Mark[] = [
    ...notes.checks.map((c) => ({ text: c.text, kind: c.ok ? ("ok" as const) : ("bad" as const) })),
    ...notes.remember.map((t) => ({ text: t, kind: "kb" as const })),
  ];
  const wrong = notes.checks.filter((c) => !c.ok).length;
  const writer = o.writer === "Agent" ? "The writer agent" : o.writer;

  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-5 px-4 py-8 sm:px-6">
      <button type="button" onClick={() => go("pipeline")} className="inline-flex items-center gap-1.5 self-start text-sm text-tertiary hover:text-secondary">
        <ArrowLeft className="size-4" />
        Pipeline
      </button>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-title text-2xl text-primary">Review</h1>
          <p className="mt-0.5 text-sm text-tertiary">
            {writer} sent this for review. {o.reviewer === D.me.name ? "You're the reviewer." : `${o.reviewer} reviews it.`} Due {short(o.date)}.
          </p>
        </div>
        <Button size="sm" onClick={() => go(`post-${id}`)}>
          Open in the editor
          <ArrowUpRight className="size-3.5" />
        </Button>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <article className="rounded-xl border border-secondary bg-primary px-5 py-8 sm:px-12">
          <div className="mb-2 flex items-center gap-2 text-xs text-tertiary">
            <TypeIcon type={o.type} className="size-3.5" />
            {collName(o.group)}
          </div>
          <h2 className="mb-5 font-title text-3xl leading-tight text-primary">{o.title}</h2>
          {body.map((para, i) => (
            <p key={i} className="mb-4 max-w-[65ch] text-[15px] leading-relaxed text-primary">
              {marked(para, marks)}
            </p>
          ))}
        </article>

        <aside className="flex min-w-0 flex-col gap-3">
          {o.notes && o.notes.length > 0 && (
            <RailBox title="Your notes at the pitch">
              {o.notes.map((n) => (
                <p key={n} className="border-l-2 border-[var(--color-bg-warning-solid)] pl-2.5 text-sm text-secondary">
                  {n} <span className="text-success-primary">Done.</span>
                </p>
              ))}
            </RailBox>
          )}
          <RailBox title="Source check">
            {notes.checks.map((c) =>
              c.ok ? (
                <p key={c.text} className="flex gap-2 text-sm text-secondary">
                  <span className="text-success-primary">✓</span>
                  <span>
                    “{c.text}”. {c.note}
                  </span>
                </p>
              ) : (
                <div key={c.text} className="border-l-2 border-[var(--color-border-error)] pl-2.5 text-sm text-secondary">
                  <strong className="font-semibold text-primary">{c.source ? "Doesn't match its source." : "No source."}</strong> {c.note}
                  {c.source && <span className="mt-0.5 block text-xs text-tertiary">{c.source}</span>}
                </div>
              ),
            )}
          </RailBox>
          {notes.remember.length > 0 && (
            <RailBox title="About us, said here">
              {notes.remember.map((t) => (
                <div key={t} className="flex flex-col gap-2">
                  <p className="border-l-2 border-secondary pl-2.5 text-sm text-primary">“{t}”</p>
                  {remembered[t] ? (
                    <p className="text-xs text-tertiary">{remembered[t] === "yes" ? "Remembered. Later posts get checked against it." : "Left out of the knowledge base."}</p>
                  ) : (
                    <>
                      <p className="text-xs text-tertiary">First time we say this in public. Remember it, so later posts stay consistent with it?</p>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => { setRemembered((r) => ({ ...r, [t]: "yes" })); dispatch({ type: "kbAdmit" }); toast("Sent to the Guardian as a new claim"); }}>Remember</Button>
                        <Button size="sm" kind="ghost" onClick={() => setRemembered((r) => ({ ...r, [t]: "no" }))}>Not a fact</Button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </RailBox>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => { dispatch({ type: "sendBack", id }); toast(`Sent back to ${o.writer === "Agent" ? "the writer agent" : o.writer}`); go("pipeline"); }}>
              Send back
            </Button>
            <Button kind="primary" onClick={() => { dispatch({ type: "approveReview", id }); toast(`Approved. Scheduled for ${short(o.date)}.`); go("pipeline"); }}>
              Approve and schedule
            </Button>
          </div>
          {wrong > 0 && <p className="text-xs text-tertiary">{wrong} {wrong === 1 ? "thing doesn't" : "things don't"} hold up yet. You can still approve.</p>}
        </aside>
      </div>
    </div>
  );
}

function RailBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 rounded-xl border border-secondary bg-primary p-4">
      <Eyebrow>{title}</Eyebrow>
      {children}
    </section>
  );
}
