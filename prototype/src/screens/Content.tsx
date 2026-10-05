// Two supporting screens, so the flows in Home and Inbox have somewhere to go.
// Content: every post with its flag state. Knowledge: what the Guardian guards.

import { Card, CardHead, Dot, Empty, Eyebrow, Pill, cx } from "../bits";
import { COUNTS_AGAINST, topicName, useStore } from "../store";
import * as D from "../data";
import type { FlagStatus } from "../data";

const statusLook: Record<FlagStatus, { label: string; tone: "good" | "warn" | "bad" | "info" | "neutral" }> = {
  open: { label: "Open", tone: "bad" },
  guardian: { label: "With the Guardian", tone: "info" },
  rejected: { label: "Guardian rejected", tone: "bad" },
  escalated: { label: "Escalated", tone: "info" },
  fixed: { label: "Fixed", tone: "good" },
  admitted: { label: "Reconciled", tone: "good" },
  contested: { label: "Contested", tone: "warn" },
  "not-worth-fixing": { label: "Not worth fixing", tone: "warn" },
  "cant-fix": { label: "Can't fix", tone: "neutral" },
};

export function Content() {
  const { s, d } = useStore();

  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-5 px-4 py-8 sm:px-6">
      <header>
        <h1 className="font-title text-2xl text-primary">Content</h1>
        <p className="mt-0.5 text-sm text-tertiary">
          {D.posts.length} recent posts of {D.totalContent} under watch. The content grade counts a post
          once, however many flags it carries.
        </p>
      </header>

      <Card pad={false}>
        <ul className="divide-y divide-[var(--color-border-secondary)]">
          {D.posts.map((p) => {
            const mine = s.flags.filter((f) => f.postId === p.id);
            const counting = mine.filter((f) => COUNTS_AGAINST.includes(f.status));
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
                <Dot tone={counting.length ? "bad" : mine.length ? "good" : "neutral"} />
                <span className="min-w-0 flex-1 truncate text-sm text-primary">{p.title}</span>
                <Pill tone="neutral">{topicName(p.topic)}</Pill>
                <span className="tnum shrink-0 text-xs text-quaternary">{p.date}</span>
                <span className="flex w-full flex-wrap gap-1.5 pl-5 sm:w-auto sm:pl-0">
                  {mine.map((f) => (
                    <Pill key={f.id} tone={statusLook[f.status].tone}>
                      {statusLook[f.status].label}
                    </Pill>
                  ))}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>

      <p className="text-xs text-quaternary">
        <span className="tnum">{d.content.denom - d.content.flagged}</span> of{" "}
        <span className="tnum">{d.content.denom}</span> posts clean, which is grade{" "}
        <span className="font-title text-sm text-primary">{d.content.grade}</span>.
      </p>
    </div>
  );
}

export function Knowledge() {
  const { s, d } = useStore();

  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-5 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-title text-2xl text-primary">Knowledge base</h1>
          <p className="mt-0.5 text-sm text-tertiary">
            What the Guardian guards. <span className="tnum">{d.kb.entries}</span> claims, grade{" "}
            <span className="font-title text-base text-primary">{d.kb.grade}</span>.
          </p>
        </div>
        <Pill tone="info">The Guardian is the only writer</Pill>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-4">
          <CardHead title="Contested" hint="In the knowledge base, but admitted on a thin argument." />
          {s.contested.length === 0 ? (
            <Empty title="Nothing contested" />
          ) : (
            <ul className="flex flex-col gap-2">
              {s.contested.map((k) => (
                <li key={k.id} className="rounded-lg border border-warning_subtle bg-warning-primary p-3">
                  <p className="text-sm text-primary">{k.claim}</p>
                  <p className="mt-1 text-xs text-secondary">{k.why}</p>
                  <p className="mt-1 text-xs text-quaternary">since {k.since}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="flex flex-col gap-4">
          <CardHead title="Contradictions" hint="Two claims inside the knowledge base that can't both hold." />
          {s.contradictions.length === 0 ? (
            <Empty title="No contradictions" />
          ) : (
            <ul className="flex flex-col gap-2">
              {s.contradictions.map((k) => (
                <li key={k.id} className="flex flex-col gap-2 rounded-lg border border-error_subtle bg-error-primary p-3">
                  <p className="text-sm text-primary">{k.a}</p>
                  <p className="text-xs text-quaternary">against</p>
                  <p className="text-sm text-primary">{k.b}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="flex flex-col gap-3">
        <CardHead title="Canon" hint="Positioning and pricing. Changing these needs a declared canon change, not a reconciliation." />
        <ul className="flex flex-col gap-2">
          {[
            "Ledgerline is not an ERP. It sits on top of your ERP.",
            "Scale and Enterprise are priced per entity. Growth was per seat, sold until 1 September 2026.",
            "SOC 2 Type I complete. Type II expected December 2026.",
          ].map((c) => (
            <li key={c} className={cx("rounded-lg bg-secondary px-3 py-2 text-sm text-primary")}>
              {c}
            </li>
          ))}
        </ul>
        <Eyebrow>Three claims the Guardian will not let content contradict</Eyebrow>
      </Card>
    </div>
  );
}
