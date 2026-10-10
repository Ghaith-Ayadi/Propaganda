import { useState } from "react";
import { Globe01 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import {
  AGENTS,
  WRITER_RULE,
  useTaste,
  useVoiceSuggestion,
  useVoiceGuide,
} from "@/lib/tenantConfig";
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
      <ModelKeyCard />
    </div>
  );
}

function RosterCard() {
  const [open, setOpen] = useState<string | null>("writer");
  return (
    <Card title="The agents" description="Eight agents, each with one job. They run on the server, and every model call is logged to the cost log.">
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
                <div className="text-sm font-medium text-primary">{a.name}</div>
                <div className="text-xs text-tertiary">{a.job}</div>
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
  const { suggestion, apply, dismiss, showExample } = useVoiceSuggestion();
  return (
    <div className="space-y-4 border-t border-secondary bg-secondary/40 px-4 py-4">
      <div>
        <div className="mb-1 type-eyebrow text-quaternary">Voice guide</div>
        <TextArea
          label="Voice guide"
          rows={8}
          value={guide}
          onChange={setGuide}
          placeholder="Plain sentences about how this tenant sounds: who is speaking, how formal, what to avoid. Left empty, the Writer uses the default voice."
        />
        <p className="mt-1.5 text-xs text-tertiary">
          The Writer's first job is to read your published content and propose this. Edit it any time; it applies to the next draft.
        </p>
      </div>
      <div className="rounded-lg border border-secondary bg-primary p-3">
        <div className="mb-1 type-eyebrow text-quaternary">Suggested change</div>
        {suggestion ? (
          <>
            <p className="text-sm text-primary">{suggestion.reason}</p>
            <p className="mt-1 text-sm text-secondary">Add: “{suggestion.addition}”</p>
            <p className="mt-1 text-xs text-tertiary">Built from {suggestion.editCount} reviewer edits. The guide stays as it is until you apply this.</p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" color="primary" onClick={apply}>Apply</Button>
              <Button size="sm" color="secondary" onClick={dismiss}>Dismiss</Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-tertiary">
              When reviewers make the same edit again and again, the Writer proposes a line for the guide here. Nothing yet.
            </p>
            <Button size="sm" color="link-gray" className="mt-2" onClick={showExample}>Show an example</Button>
          </>
        )}
        <div className="mt-2"><Note>Placeholder: suggestions are not read from the server yet, and nothing here is saved.</Note></div>
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
  const [taste, setNotes] = useTaste();
  return (
    <Card
      title="Taste"
      description="What the Pitcher has learned from your yes and no on pitches and drafts. It reads this before every batch."
    >
      <div className="space-y-4">
        <div>
          <div className="mb-1 type-eyebrow text-quaternary">Summary, written by the Pitcher</div>
          {taste.summary ? (
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
            value={taste.myNotes}
            onChange={setNotes}
            placeholder="Things you always want or never want pitched. Only you can edit your notes; the Pitcher reads everyone's."
          />
        </div>
        <Note>Placeholder: the summary and notes are not read from or saved to the server yet.</Note>
      </div>
    </Card>
  );
}

function ModelsCard() {
  return (
    <Card
      title="Models"
      description="On Propaganda's account, the Strategist runs on Claude Fable and every other agent on DeepSeek V4 Pro. With your Anthropic key below, they all run on Claude with your key, on your bill: the Strategist on Fable, the others on Sonnet."
    />
  );
}
