// One pitch: a full brief with a reason from the goals for every line, and
// the two decisions. Approve as is or with notes; a rejection needs a reason
// (the Pitcher reads them before the next batch).

import { useState } from "react";
import { Check, FileCheck02, XClose } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { parseDay, shortDate } from "@/components/shared/quarter";
import { reportError } from "@/lib/telemetry";
import { TextArea } from "./bits";
import type { Fit, InboxSource, Pitch } from "./data";

export const fitBadge: Record<Fit, { label: string; color: "success" | "warning" | "gray" }> = {
  strong: { label: "Strong fit", color: "success" },
  fair: { label: "Fair fit", color: "warning" },
  weak: { label: "Weak fit", color: "gray" },
};

export function PitchDetail({ pitch, source }: { pitch: Pitch; source: InboxSource }) {
  const [mode, setMode] = useState<"idle" | "notes" | "reject">("idle");
  const [note, setNote] = useState("");
  const fit = fitBadge[pitch.fit];

  const decide = (kind: "approved" | "rejected") => {
    source.decidePitch(pitch.id, kind, note.trim()).catch((err) => reportError("Inbox.pitch", err));
    setMode("idle");
    setNote("");
  };

  return (
    <article className="flex flex-col gap-6">
      <header>
        <div className="flex flex-wrap items-center gap-2 text-sm text-secondary">
          <span>
            {pitch.collection} <span className="text-tertiary">· {pitch.topic}</span>
          </span>
          <Badge type="pill-color" color={fit.color} size="sm">{fit.label}</Badge>
          {pitch.drafted && (
            <Badge type="pill-color" color="gray" size="sm">
              <FileCheck02 className="mr-1 size-3" /> Draft ready
            </Badge>
          )}
        </div>
        <h2 className="mt-2 font-title text-2xl leading-tight text-primary">{pitch.title}</h2>
        <p className="mt-1 text-sm text-tertiary">Publishes {shortDate(parseDay(pitch.publishOn))} if approved</p>
      </header>

      <section>
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-tertiary uppercase">Why now</h3>
        <ul className="flex flex-col gap-1.5">
          {pitch.reasons.map((r) => (
            <li key={r} className="flex gap-2 text-md text-secondary">
              <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-fg-quaternary" />
              {r}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl bg-secondary px-5 py-4">
        <h3 className="text-xs font-semibold tracking-wide text-tertiary uppercase">The angle</h3>
        <p className="mt-1 text-md leading-7 text-primary">{pitch.angle}</p>
        <h3 className="mt-4 text-xs font-semibold tracking-wide text-tertiary uppercase">Outline</h3>
        <ol className="mt-1 list-decimal pl-5 text-md leading-7 text-secondary">
          {pitch.outline.map((o) => (
            <li key={o}>{o}</li>
          ))}
        </ol>
        <h3 className="mt-4 text-xs font-semibold tracking-wide text-tertiary uppercase">Sources</h3>
        <ul className="mt-1 text-sm text-secondary">
          {pitch.sources.map((s) => (
            <li key={s.label}>{s.url ? <a href={s.url} className="underline">{s.label}</a> : s.label}</li>
          ))}
        </ul>
      </section>

      {pitch.decision ? (
        <div className="rounded-xl border border-secondary px-5 py-4 text-sm text-secondary">
          {pitch.decision.kind === "approved" ? "Approved" : "Rejected"}
          {pitch.decision.note && <>: “{pitch.decision.note}”</>}
        </div>
      ) : mode === "idle" ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" color="primary" iconLeading={Check} onClick={() => decide("approved")}>
            Approve
          </Button>
          <Button size="sm" color="secondary" onClick={() => setMode("notes")}>
            Approve with notes
          </Button>
          <Button size="sm" color="secondary" iconLeading={XClose} onClick={() => setMode("reject")}>
            Reject
          </Button>
        </div>
      ) : (
        <section className="rounded-xl border border-primary px-5 py-4 shadow-xs">
          <p className="text-md text-primary">{mode === "notes" ? "Notes for the Writer" : "Why not?"}</p>
          <p className="mt-1 text-sm text-tertiary">
            {mode === "notes"
              ? "What to keep in mind while writing. The brief stays as it is."
              : "One line is enough. The Pitcher reads it before the next batch."}
          </p>
          <div className="mt-3">
            <TextArea label={mode === "notes" ? "Notes" : "Reason"} value={note} onChange={setNote} autoFocus />
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              color={mode === "notes" ? "primary" : "primary-destructive"}
              isDisabled={!note.trim()}
              onClick={() => decide(mode === "notes" ? "approved" : "rejected")}
            >
              {mode === "notes" ? "Approve" : "Reject"}
            </Button>
            <Button size="sm" color="secondary" onClick={() => setMode("idle")}>
              Cancel
            </Button>
          </div>
        </section>
      )}
    </article>
  );
}
