import { useState } from "react";
import { Globe01 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import {
  AGENTS,
  WRITER_RULE,
  useVoiceGuide,
} from "@/lib/tenantConfig";
import { toast } from "@/components/base/toast/toast";
import { userMessage } from "@/lib/errors";
import { useTaste } from "@/lib/taste";
import { reportError } from "@/lib/telemetry";
import { BYOK_ENABLED } from "@/lib/modelKey";
import { ModelKeyCard } from "./ModelKeyCard";
import { Card, Note, TextArea } from "./ui";

// "How far the agents go" (per-stage Off / Ask me / On its own) and "Western
// models only" were removed until an agent reads them (Ayadi, 2026-10-10): they
// saved settings nothing acted on. Their hooks stay in lib/tenantConfig; the
// cards are in git history.
export function AgentsSection() {
  return (
    <div className="space-y-6">
      <RosterCard />
      <TasteCard />
      <ModelsCard />
      {BYOK_ENABLED && <ModelKeyCard />}
    </div>
  );
}

function RosterCard() {
  const [open, setOpen] = useState<string | null>("writer");
  return (
    <Card title="What we do for you" description="Eight jobs. They run on our servers, and every model call is logged to the cost log.">
      <ul className="divide-y divide-secondary rounded-lg border border-secondary">
        {AGENTS.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              aria-expanded={open === a.id}
              onClick={() => setOpen(open === a.id ? null : a.id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-primary_hover"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-primary">{a.job}</div>
              </div>
              {a.internet && <Globe01 aria-label="Can search the web" className="size-4 text-quaternary" />}
            </button>
            {open === a.id && a.id === "writer" && <WriterPanel />}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function WriterPanel() {
  const [guide, setGuide] = useVoiceGuide();
  return (
    <div className="space-y-4 border-t border-secondary bg-secondary/40 px-4 py-4">
      <div>
        <div className="mb-1 type-eyebrow text-quaternary">Voice guide</div>
        <TextArea
          label="Voice guide"
          rows={8}
          value={guide}
          onChange={setGuide}
          placeholder="Plain sentences about how this tenant sounds: who is speaking, how formal, what to avoid. Left empty, we use the default voice."
        />
        <p className="mt-1.5 text-xs text-tertiary">
          Our first job is to read your published content and propose this. Edit it any time; it applies to the next draft.
        </p>
      </div>
      <div className="rounded-lg border border-secondary bg-primary p-3">
        <div className="mb-1 type-eyebrow text-quaternary">House rule, always on</div>
        <p className="text-sm text-primary">{WRITER_RULE.rule}</p>
        <p className="mt-1 text-xs text-tertiary">{WRITER_RULE.instead}</p>
      </div>
    </div>
  );
}

function TasteCard() {
  const { taste, error, saveNotes } = useTaste();
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const notes = draft ?? taste?.notes ?? "";
  const dirty = draft !== null && draft.trim() !== (taste?.notes ?? "").trim();

  async function save() {
    setSaving(true);
    try {
      await saveNotes(notes);
      setDraft(null);
      toast.add({ type: "success", title: "Saved. We read it before the next batch." });
    } catch (err) {
      reportError("settings.saveTaste", err);
      toast.add({ type: "error", title: userMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      title="Taste"
      description="What we've learned from your yes and no on pitches and drafts. We read this before every batch."
    >
      <div className="space-y-4">
        <div>
          <div className="mb-1 type-eyebrow text-quaternary">Summary, written by us</div>
          {!taste ? (
            <p className="text-sm text-tertiary">Loading…</p>
          ) : taste.summary ? (
            <p className="whitespace-pre-wrap text-sm text-primary">{taste.summary}</p>
          ) : (
            <p className="text-sm text-tertiary">Empty until the first batch has been reviewed.</p>
          )}
        </div>
        <div>
          <div className="mb-1 type-eyebrow text-quaternary">Your notes</div>
          <TextArea
            label="Your taste notes"
            rows={4}
            value={notes}
            onChange={setDraft}
            placeholder="Things you always want or never want pitched. Everyone on this tenant shares these notes."
          />
          <div className="mt-2 flex items-center gap-3">
            <Button size="sm" color="primary" isDisabled={!dirty || !taste} isLoading={saving} onClick={() => void save()}>
              Save notes
            </Button>
            {error != null && <span className="text-xs text-error-primary">{userMessage(error)}</span>}
          </div>
        </div>
      </div>
    </Card>
  );
}

function ModelsCard() {
  return (
    <Card
      title="Models"
      description="We pick the model for each job, and every call is logged to the cost log."
    />
  );
}
