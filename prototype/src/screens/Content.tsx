// Two supporting screens, so the flows in Home and Inbox have somewhere to go.
// Content: every post with its flag state. Knowledge: what the Guardian guards.

import { Card, CardHead, Dot, Empty, OriginalLink, Pill, TypeIcon, cx } from "../bits";
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
  "cant-fix": { label: "Acknowledged, can't fix", tone: "neutral" },
};

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
        <Pill tone="info">Only the Guardian writes here</Pill>
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

      <Card pad={false}>
        <div className="border-b border-secondary px-5 py-4">
          <CardHead title="Claims" hint="Each one with the evidence behind it. Content is checked against these." />
        </div>
        <ul className="divide-y divide-[var(--color-border-secondary)]">
          {D.claims.map((c) => (
            <li key={c.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-5 py-3">
              <span className="min-w-0 flex-1 text-sm text-primary">{c.text}</span>
              <Pill tone={c.status === "Settled" ? "good" : "warn"}>{c.status}</Pill>
              <span className="w-full text-xs text-quaternary">
                {topicName(c.topic)} · added by {c.addedBy} · {c.evidence.length} {c.evidence.length === 1 ? "source" : "sources"} ·{" "}
                <OriginalLink url={c.evidence[0].url} label="first source" />
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
