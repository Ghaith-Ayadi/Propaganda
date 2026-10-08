// One pitch: a full brief with a reason from the goals for every line, and
// the two decisions. Approve as is or with notes; a rejection needs a reason
// (the Pitcher reads them before the next batch).

import { useState } from "react";
import { Check, XClose } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Card, CardBody, CardFooter, CardHeader, CardSection, MetaList } from "@/components/shared/Card";
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

  const actions = pitch.decision ? (
    <Badge type="pill-color" color={pitch.decision.kind === "approved" ? "success" : "gray"} size="sm">
      {pitch.decision.kind === "approved" ? "Approved" : "Rejected"}
    </Badge>
  ) : mode === "idle" ? (
    <>
      <Button size="sm" color="secondary" iconLeading={XClose} onClick={() => setMode("reject")}>
        Reject
      </Button>
      <Button size="sm" color="secondary" onClick={() => setMode("notes")}>
        Approve with notes
      </Button>
      <Button size="sm" color="primary" iconLeading={Check} onClick={() => decide("approved")}>
        Approve
      </Button>
    </>
  ) : null;

  return (
    <Card>
      <CardHeader title={pitch.title} description={`${pitch.collection} · ${pitch.topic}`} actions={actions} />
      <CardBody>
        {pitch.decision?.note && (
          <p className="rounded-lg bg-secondary px-4 py-3 text-sm text-secondary">
            {pitch.decision.kind === "approved" ? "Your notes" : "Your reason"}: “{pitch.decision.note}”
          </p>
        )}

        {!pitch.decision && mode !== "idle" && (
          <CardSection label={mode === "notes" ? "Notes for the Writer" : "Why not?"}>
            <p className="mb-3 text-sm text-tertiary">
              {mode === "notes"
                ? "What to keep in mind while writing. The brief stays as it is."
                : "One line is enough. The Pitcher reads it before the next batch."}
            </p>
            <TextArea label={mode === "notes" ? "Notes" : "Reason"} value={note} onChange={setNote} autoFocus />
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
          </CardSection>
        )}

        <CardSection label="Why now">
          <Bullets items={pitch.reasons} />
        </CardSection>

        <CardSection label="Angle">
          <p className="text-md leading-7 text-secondary">{pitch.angle}</p>
        </CardSection>

        <CardSection label="Outline">
          <ol className="list-decimal pl-5 text-md leading-7 text-secondary">
            {pitch.outline.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ol>
        </CardSection>

        <CardSection label="Metadata">
          <MetaList
            items={[
              { label: pitch.decision?.kind === "approved" ? "Publishes" : "Publishes if approved", value: shortDate(parseDay(pitch.publishOn)) },
              { label: "Topic", value: pitch.topic },
              { label: "Collection", value: pitch.collection },
              { label: "Fit", value: <Badge type="pill-color" color={fit.color} size="sm">{fit.label}</Badge> },
              { label: "Draft", value: pitch.drafted ? "Ready" : "Written once approved" },
            ]}
          />
        </CardSection>
      </CardBody>
      {pitch.sources.length > 0 && (
        <CardFooter>
          <span className="mr-2 font-semibold text-secondary">Sources</span>
          {pitch.sources.map((s, i) => (
            <span key={s.label}>
              {i > 0 && " · "}
              {s.url ? (
                <a href={s.url} className="underline decoration-1 underline-offset-2 hover:text-primary">
                  {s.label}
                </a>
              ) : (
                s.label
              )}
            </span>
          ))}
        </CardFooter>
      )}
    </Card>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((r) => (
        <li key={r} className="flex gap-2 text-md text-secondary">
          <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-fg-quaternary" />
          {r}
        </li>
      ))}
    </ul>
  );
}
