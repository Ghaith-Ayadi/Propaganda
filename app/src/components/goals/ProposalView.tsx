// The Strategist's proposal for a quarter: every number with one line of why
// and what it's based on. The tenant edits any of it in place, then approves
// (a new goal version, the quarter recalculated) or asks for changes.
// agents/strategist.md sections 4 and 5.

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash01 } from "@untitledui/icons";
import type { Proposal, ProposalEdit, ProposedSearch, ProposedTopic, WatchedSite } from "@/lib/goals/types";
import { goalsActions } from "@/lib/goals/useGoals";
import { quarterLabel, shortDate } from "@/lib/goals/quarter";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { toast } from "@/components/base/toast/toast";
import { reportError } from "@/lib/telemetry";
import { Card, Reason } from "./bits";
import { cx } from "@/utils/cx";

const STATUS: Record<Proposal["status"], { label: string; color: "gray" | "brand" | "warning" | "success" }> = {
  draft: { label: "Draft", color: "gray" },
  sent: { label: "Waiting on you", color: "brand" },
  changes_requested: { label: "Revision asked for", color: "warning" },
  approved: { label: "Approved", color: "success" },
  superseded: { label: "Replaced", color: "gray" },
};

export function ProposalView({ proposal }: { proposal: Proposal }) {
  const [draft, setDraft] = useState<Proposal>(proposal);
  const [reason, setReason] = useState("");
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(proposal), [proposal]);

  const editable = proposal.status === "sent" || proposal.status === "draft";
  const edits = useMemo(() => diff(proposal, draft), [proposal, draft]);
  const lowSum = draft.topics.reduce((a, t) => a + t.low, 0);
  const problems = [
    lowSum > draft.volume.value && `The topics' low ends add up to ${lowSum}, more than the ${draft.volume.value} total.`,
    draft.topics.some((t) => t.low > t.high) && "A topic's low end is above its high end.",
  ].filter(Boolean) as string[];

  const set = (patch: Partial<Proposal>) => setDraft((d) => ({ ...d, ...patch }));

  const approve = async () => {
    setBusy(true);
    try {
      const withReason = edits.map((e, i) => (i === 0 && reason ? { ...e, reason } : e));
      const v = await goalsActions.approveProposal(proposal.id, draft, withReason);
      toast.add({
        type: "success",
        title: v.version === 1 ? `${quarterLabel(proposal.quarter)} goals approved` : `${quarterLabel(proposal.quarter)} goals, version ${v.version}`,
        description: v.version === 1 ? "The first batch is in your inbox tomorrow morning." : "The quarter's scores were recalculated; the graphs mark today.",
      });
    } catch (err) {
      reportError("goals.approve", err);
      toast.add({ type: "error", title: "Couldn't approve the goals", description: "Try again in a moment." });
    } finally {
      setBusy(false);
    }
  };

  const ask = async () => {
    setBusy(true);
    try {
      await goalsActions.requestChanges(proposal.id, note);
      setAsking(false);
      toast.add({ type: "success", title: "Sent to the Strategist", description: "A revision comes back here." });
    } catch (err) {
      reportError("goals.requestChanges", err);
      toast.add({ type: "error", title: "Couldn't send that", description: "Try again in a moment." });
    } finally {
      setBusy(false);
    }
  };

  const s = STATUS[proposal.status];
  return (
    <div className="space-y-4">
      <Card
        title={`The Strategist's proposal for ${quarterLabel(proposal.quarter)}`}
        aside={
          <Badge type="pill-color" color={s.color} size="sm">
            {s.label}
          </Badge>
        }
      >
        <p className="text-lg text-primary">{proposal.summary}</p>
        <p className="mt-2 text-sm text-tertiary">
          Covers {shortDate(proposal.covers.from)} to {shortDate(proposal.covers.to)}, {proposal.covers.weeks} weeks
          {proposal.covers.prorated ? ", prorated to the weeks left" : ""}. Written {shortDate(proposal.createdAt)}.
          {proposal.approvedAt && ` Approved by ${proposal.approvedBy} on ${shortDate(proposal.approvedAt)}.`}
        </p>
        {proposal.changeRequest && (
          <p className="mt-3 rounded-lg bg-secondary p-3 text-sm text-secondary">
            You asked: "{proposal.changeRequest}". The Strategist is revising.
          </p>
        )}
        {proposal.questions.length > 0 && (
          <div className="mt-4 rounded-xl bg-brand-primary_alt p-4">
            <p className="text-sm font-semibold text-brand-secondary">What it couldn't decide alone</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-secondary">
              {proposal.questions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card title="Volume" subtitle="Planned posts for the quarter. Bonus posts come on top.">
        <NumberCell value={draft.volume.value} editable={editable} onChange={(v) => set({ volume: { ...draft.volume, value: v } })} unit="posts" />
        <Reason {...draft.volume} />
        <div className="mt-4 border-t border-secondary pt-4">
          <NumberCell value={draft.batches.value} editable={false} onChange={() => {}} unit="weekly batches" small />
          <Reason {...draft.batches} />
        </div>
      </Card>

      <Card title="Topics" subtitle="About four, ranked, each a range. The low end is what counts as on target. The Strategist pitches across all of them, and Goals shows how many it pitched next to what's done.">
        <TopicList topics={draft.topics} editable={editable} onChange={(topics) => set({ topics })} />
      </Card>

      <Card title="Ranking" subtitle="Ten searches we can actually win, and the same ten as prompts for AI answers.">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-sm text-secondary">On page one by quarter end</p>
            <NumberCell
              value={draft.ranking.pageOneTarget.value}
              editable={editable}
              onChange={(v) => set({ ranking: { ...draft.ranking, pageOneTarget: { ...draft.ranking.pageOneTarget, value: v } } })}
              unit={`of ${draft.ranking.searches.length}`}
              small
            />
            <Reason {...draft.ranking.pageOneTarget} />
          </div>
          <div>
            <p className="text-sm text-secondary">AI answers that mention you</p>
            {draft.ranking.aiMentionTarget.value == null ? <p className="font-title text-3xl text-quaternary">No target</p> : (
              <NumberCell
                value={draft.ranking.aiMentionTarget.value}
                editable={editable}
                onChange={(v) => set({ ranking: { ...draft.ranking, aiMentionTarget: { ...draft.ranking.aiMentionTarget, value: v } } })}
                unit={`of ${draft.ranking.searches.length}`}
                small
              />
            )}
            <Reason {...draft.ranking.aiMentionTarget} />
          </div>
        </div>
        <SearchList searches={draft.ranking.searches} topics={draft.topics.map((t) => t.name)} editable={editable} onChange={(searches) => set({ ranking: { ...draft.ranking, searches } })} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Readership" subtitle="Minutes read across every post.">
          {draft.readership.value == null ? <p className="font-title text-3xl text-quaternary">No target yet</p> : (
            <NumberCell value={draft.readership.value} editable={editable} onChange={(v) => set({ readership: { ...draft.readership, value: v } })} unit="minutes" />
          )}
          <Reason {...draft.readership} />
        </Card>
        <Card title="Consistency" subtitle="Not proposed, not editable.">
          <p className="font-title text-3xl text-primary">A</p>
          <Reason why="Everything you publish stays true and agrees with itself. Always the target." />
        </Card>
      </div>

      <Card title="Sites we watch" subtitle="The Scout reads these every day for timely posts. Each one is tied to a topic.">
        <SiteList sites={draft.watchedSites} topics={draft.topics.map((t) => t.name)} editable={editable} onChange={(watchedSites) => set({ watchedSites })} />
      </Card>

      {editable && (
        <Card>
          {edits.length > 0 && (
            <div className="mb-4">
              <p className="text-sm font-semibold text-secondary">Your changes ({edits.length})</p>
              <ul className="mt-1 text-sm text-tertiary">
                {edits.map((e) => (
                  <li key={e.field + e.to}>
                    {e.field}: {e.from} → {e.to}
                  </li>
                ))}
              </ul>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why? (optional, e.g. we don't do pricing content)"
                className="mt-3 w-full rounded-lg bg-primary px-3 py-2 text-sm text-primary shadow-xs ring-1 ring-primary outline-none ring-inset placeholder:text-placeholder focus:ring-2 focus:ring-brand"
              />
              <p className="mt-1 text-xs text-quaternary">Your edits are kept, and the next proposal reads them. That's how it learns your taste.</p>
            </div>
          )}
          {problems.length > 0 && (
            <ul className="mb-4 space-y-1 text-sm text-error-primary">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {asking ? (
            <div className="space-y-3">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                autoFocus
                placeholder="What should change? e.g. we launch the close checklist on 12 Nov, give it its own topic."
                className="w-full rounded-lg bg-primary px-3.5 py-3 text-md text-primary shadow-xs ring-1 ring-primary outline-none ring-inset placeholder:text-placeholder focus:ring-2 focus:ring-brand"
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" color="secondary" onClick={() => setAsking(false)}>
                  Cancel
                </Button>
                <Button size="sm" color="primary" isDisabled={!note.trim() || busy} onClick={() => void ask()}>
                  Send to the Strategist
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
              <Button size="md" color="secondary" onClick={() => setAsking(true)}>
                Ask for changes
              </Button>
              <Button size="md" color="primary" isDisabled={problems.length > 0 || busy} isLoading={busy} onClick={() => void approve()}>
                {edits.length ? `Approve with ${edits.length} ${edits.length === 1 ? "change" : "changes"}` : "Approve"}
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ── editable pieces ─────────────────────────────────────────────────────────

const INPUT =
  "rounded-lg bg-primary px-2.5 py-1.5 text-primary shadow-xs ring-1 ring-primary outline-none ring-inset focus:ring-2 focus:ring-brand tabular-nums";

function NumberCell({ value, editable, onChange, unit, small }: { value: number; editable: boolean; onChange: (v: number) => void; unit?: string; small?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      {editable ? (
        <input
          type="number"
          min={0}
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(Math.max(0, Math.round(Number(e.target.value) || 0)))}
          className={cx(INPUT, "font-title", small ? "w-20 text-2xl" : "w-28 text-4xl")}
          aria-label={unit}
        />
      ) : (
        <span className={cx("font-title text-primary tabular-nums", small ? "text-3xl" : "text-5xl")}>{value}</span>
      )}
      {unit && <span className="text-sm text-tertiary">{unit}</span>}
    </div>
  );
}

function TopicList({ topics, editable, onChange }: { topics: ProposedTopic[]; editable: boolean; onChange: (t: ProposedTopic[]) => void }) {
  const [name, setName] = useState("");
  const upd = (i: number, patch: Partial<ProposedTopic>) => onChange(topics.map((t, k) => (k === i ? { ...t, ...patch } : t)));
  return (
    <>
      <ol className="divide-y divide-secondary">
        {topics.map((t, i) => (
          <li key={t.name} className="py-3 first:pt-0">
            <div className="flex flex-wrap items-center gap-3">
              <span className="w-5 text-sm text-quaternary">{i + 1}</span>
              <span className="min-w-0 flex-1 font-medium text-primary">{t.name}</span>
              {editable ? (
                <span className="flex items-center gap-2 text-sm text-tertiary">
                  <input type="number" min={0} aria-label={`${t.name} low`} value={t.low} onChange={(e) => upd(i, { low: Math.max(0, Number(e.target.value) || 0) })} className={cx(INPUT, "w-16 text-sm")} />
                  to
                  <input type="number" min={0} aria-label={`${t.name} high`} value={t.high} onChange={(e) => upd(i, { high: Math.max(0, Number(e.target.value) || 0) })} className={cx(INPUT, "w-16 text-sm")} />
                  posts
                  <Button size="sm" color="tertiary" iconLeading={Trash01} aria-label={`Remove ${t.name}`} onClick={() => onChange(topics.filter((_, k) => k !== i))} />
                </span>
              ) : (
                <span className="text-sm text-tertiary tabular-nums">
                  {t.low} to {t.high} posts
                </span>
              )}
            </div>
            <div className="pl-8">
              <Reason why={t.why} basis={t.basis} origin={t.origin} />
            </div>
          </li>
        ))}
      </ol>
      {editable && (
        <AddRow
          placeholder="Add a topic"
          value={name}
          onChange={setName}
          onAdd={() => {
            onChange([...topics, { name: name.trim(), low: 1, high: 2, why: "Added by you.", basis: "" }]);
            setName("");
          }}
          disabled={!name.trim() || topics.some((t) => t.name === name.trim())}
        />
      )}
    </>
  );
}

function SearchList({ searches, topics, editable, onChange }: { searches: ProposedSearch[]; topics: string[]; editable: boolean; onChange: (s: ProposedSearch[]) => void }) {
  const [q, setQ] = useState("");
  return (
    <div className="mt-5 border-t border-secondary pt-4">
      <p className="mb-2 text-sm font-semibold text-secondary">The {searches.length} searches</p>
      <ul className="divide-y divide-secondary">
        {searches.map((s, i) => (
          <li key={s.query} className="flex items-start gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-primary">{s.query}</p>
              <p className="text-xs text-tertiary">
                {s.topic}
                {s.volume != null && ` · ${s.volume.toLocaleString("en-US")} searches a month`}
                {s.difficulty != null && ` · difficulty ${s.difficulty}`}
              </p>
              <p className="text-xs text-quaternary">{s.why}</p>
            </div>
            {editable && <Button size="sm" color="tertiary" iconLeading={Trash01} aria-label={`Remove ${s.query}`} onClick={() => onChange(searches.filter((_, k) => k !== i))} />}
          </li>
        ))}
      </ul>
      {editable && searches.length < 10 && (
        <AddRow
          placeholder="Add a search"
          value={q}
          onChange={setQ}
          onAdd={() => {
            onChange([...searches, { query: q.trim(), topic: topics[0] ?? "", position: null, why: "Added by you." }]);
            setQ("");
          }}
          disabled={!q.trim()}
        />
      )}
    </div>
  );
}

function SiteList({ sites, topics, editable, onChange }: { sites: WatchedSite[]; topics: string[]; editable: boolean; onChange: (s: WatchedSite[]) => void }) {
  const [url, setUrl] = useState("");
  return (
    <>
      <ul className="divide-y divide-secondary">
        {sites.map((s, i) => (
          <li key={s.url} className="flex items-start gap-3 py-2.5 first:pt-0">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-primary">{s.url.replace(/^https?:\/\//, "")}</p>
              <p className="text-xs text-tertiary">
                {s.topic} · {s.why}
              </p>
            </div>
            {editable && <Button size="sm" color="tertiary" iconLeading={Trash01} aria-label={`Stop watching ${s.url}`} onClick={() => onChange(sites.filter((_, k) => k !== i))} />}
          </li>
        ))}
      </ul>
      {editable && sites.length < 8 && (
        <AddRow
          placeholder="https://… a site to watch"
          value={url}
          onChange={setUrl}
          onAdd={() => {
            const u = /^https?:\/\//.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
            onChange([...sites, { url: u, topic: topics[0] ?? "", why: "Added by you." }]);
            setUrl("");
          }}
          disabled={!url.trim()}
        />
      )}
    </>
  );
}

function AddRow({ placeholder, value, onChange, onAdd, disabled }: { placeholder: string; value: string; onChange: (v: string) => void; onAdd: () => void; disabled: boolean }) {
  return (
    <form
      className="mt-3 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!disabled) onAdd();
      }}
    >
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} className={cx(INPUT, "min-w-0 flex-1 text-sm placeholder:text-placeholder")} />
      <Button type="submit" size="sm" color="secondary" iconLeading={Plus} isDisabled={disabled}>
        Add
      </Button>
    </form>
  );
}

/** What the tenant changed, one line per number or list. */
function diff(a: Proposal, b: Proposal): ProposalEdit[] {
  const out: ProposalEdit[] = [];
  const num = (field: string, x: number | null, y: number | null) => x !== y && out.push({ field, from: String(x ?? "none"), to: String(y ?? "none") });
  num("Volume", a.volume.value, b.volume.value);
  num("Batches", a.batches.value, b.batches.value);
  num("Ranking: page one", a.ranking.pageOneTarget.value, b.ranking.pageOneTarget.value);
  num("Ranking: AI answers", a.ranking.aiMentionTarget.value, b.ranking.aiMentionTarget.value);
  num("Readership", a.readership.value, b.readership.value);
  for (const t of b.topics) {
    const o = a.topics.find((x) => x.name === t.name);
    if (!o) out.push({ field: "Topics", from: "none", to: `${t.name} ${t.low} to ${t.high}` });
    else if (o.low !== t.low || o.high !== t.high) out.push({ field: t.name, from: `${o.low} to ${o.high}`, to: `${t.low} to ${t.high}` });
  }
  for (const o of a.topics) if (!b.topics.some((t) => t.name === o.name)) out.push({ field: "Topics", from: o.name, to: "removed" });
  const qa = new Set(a.ranking.searches.map((s) => s.query));
  const qb = new Set(b.ranking.searches.map((s) => s.query));
  for (const q of qb) if (!qa.has(q)) out.push({ field: "Searches", from: "none", to: q });
  for (const q of qa) if (!qb.has(q)) out.push({ field: "Searches", from: q, to: "removed" });
  const sa = new Set(a.watchedSites.map((s) => s.url));
  const sb = new Set(b.watchedSites.map((s) => s.url));
  for (const u of sb) if (!sa.has(u)) out.push({ field: "Watched sites", from: "none", to: u });
  for (const u of sa) if (!sb.has(u)) out.push({ field: "Watched sites", from: u, to: "removed" });
  return out;
}
