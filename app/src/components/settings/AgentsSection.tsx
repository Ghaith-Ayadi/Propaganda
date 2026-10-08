import { useState } from "react";
import { Globe01 } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { Toggle } from "@/components/base/toggle/toggle";
import {
  AGENTS,
  STAGES,
  WRITER_RULE,
  type StageMode,
  useStageModes,
  useVoiceGuide,
  useWesternOnly,
} from "@/lib/tenantConfig";
import { Card, Note, Row, Segmented, TextArea } from "./ui";

export function AgentsSection() {
  return (
    <div className="space-y-6">
      <StagesCard />
      <RosterCard />
      <ModelsCard />
    </div>
  );
}

function StagesCard() {
  const [modes, setMode] = useStageModes();
  return (
    <Card title="How far the agents go" description="Each stage on its own. Off means the stage does not run at all.">
      {STAGES.map((s) => (
        <Row key={s.id} title={s.name} hint={s.what}>
          <Segmented<StageMode>
            label={s.name}
            value={modes[s.id]}
            onChange={(m) => setMode(s.id, m)}
            options={[
              { value: "off", label: "Off" },
              { value: "ask", label: "Ask me" },
              { value: "auto", label: "On its own" },
            ]}
          />
        </Row>
      ))}
    </Card>
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
              <Badge size="sm" color={a.model === "Opus" ? "brand" : "gray"}>{a.model}</Badge>
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
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-quaternary">Voice guide</div>
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
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-quaternary">House rule, always on</div>
        <p className="text-sm text-primary">{WRITER_RULE.rule}</p>
        <p className="mt-1 text-xs text-tertiary">{WRITER_RULE.instead}</p>
      </div>
    </div>
  );
}

function ModelsCard() {
  const [western, setWestern] = useWesternOnly();
  return (
    <Card title="Models" description="Which model providers the agents may use.">
      <Toggle
        isSelected={western}
        onChange={setWestern}
        label="Western models only 🦅"
        hint="Off by default. When on, background jobs only use Western providers. It does not change your price."
      />
    </Card>
  );
}
