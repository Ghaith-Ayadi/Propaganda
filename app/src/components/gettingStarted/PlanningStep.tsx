// Step 3: the Strategist writes the plan. Its steps tick off as the worker
// reports them, the plan's outline fills in, and below it the setup the
// Strategist doesn't need, each part saved or skipped on its own.

import { useState, type ReactNode } from "react";
import { ArrowRight, Check, CheckCircle, RefreshCw01 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { toast } from "@/components/base/toast/toast";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/shell/Card";
import { useWorkspace } from "@/components/Workspace";
import { DomainSetup } from "@/components/site/DomainSetup";
import { setHosting, useHosting } from "@/components/site/hosting";
import { goalsActions } from "@/lib/goals/useGoals";
import { goPage } from "@/lib/route";
import { setSetting, useSetting } from "@/lib/settings";
import { siteHost } from "@/lib/siteUrl";
import { useVoiceGuide } from "@/lib/tenantConfig";
import { reportError } from "@/lib/telemetry";
import { userMessage } from "@/lib/errors";
import { cx } from "@/utils/cx";
import { Choice, Shimmer, Spinner, StepTitle } from "./bits";
import { PLAN_STEPS, type StrategistProgress } from "./progress";
import { MAX_ROUNDS, type FirstDay } from "./state";
import { useNow } from "./TodayPanel";

/** About how long the Strategist takes, for the bar when the worker hasn't answered. */
const EXPECTED_MS = 3 * 60_000;

export function PlanningStep({ day, progress }: { day: FirstDay; progress: StrategistProgress | null }) {
  const now = useNow();
  const st = day.strategist;
  const round = st?.rounds ?? 1;
  const revising = round > 1;
  const steps = progress?.proposalId === st?.id && progress?.steps.length ? progress.steps : null;
  const stepsDone = steps ? steps.filter((s) => s.state === "done").length : null;
  const started = st ? Date.parse(st.created) : now;
  const fraction = stepsDone != null ? stepsDone / steps!.length : Math.min((now - started) / EXPECTED_MS, 0.92);
  const labels = steps ? steps.map((s) => s.label) : PLAN_STEPS;
  const doneCount = stepsDone ?? Math.floor(fraction * PLAN_STEPS.length);

  return (
    <div className="flex flex-col gap-10">
      <section>
        <StepTitle
          title={day.failed ? "The Strategist stopped" : revising ? `Revising your plan, round ${round} of ${MAX_ROUNDS}` : "The Strategist is writing your plan"}
          lede={day.failed ? "Nothing was lost. Ask it again; your answers are saved." : "About 3 minutes. Your plan opens here as soon as it's ready."}
        />
        {day.failed ? (
          <Retry />
        ) : (
          <>
            {revising && st?.request && (
              <p className="mb-4 text-sm whitespace-pre-line text-secondary">
                <span className="font-medium text-primary">What you asked for: </span>
                {st.request}
              </p>
            )}
            <div className="mb-3 h-1 overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full bg-brand-solid transition-all duration-500" style={{ width: `${Math.round(fraction * 100)}%` }} />
            </div>
            <ul className="mb-8 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
              {labels.map((s, i) => (
                <li key={s} className={cx("flex items-center gap-1.5", i < doneCount ? "text-tertiary" : i === doneCount ? "text-primary" : "text-quaternary")}>
                  {i < doneCount ? <Check className="size-4 text-fg-success-primary" /> : i === doneCount ? <Spinner /> : <span className="size-1.5 rounded-full bg-fg-quaternary" />}
                  {s}
                </li>
              ))}
            </ul>
            <PlanTakingShape fraction={fraction} />
          </>
        )}
      </section>

      {!revising && <WhileYouWait />}
    </div>
  );
}

function Retry() {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      iconLeading={RefreshCw01}
      isLoading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await goalsActions.askStrategist("onboarding");
        } catch (err) {
          reportError("Strategist not asked again", err);
          toast.add({ type: "error", title: "Couldn't reach the Strategist", description: userMessage(err) });
        } finally {
          setBusy(false);
        }
      }}
    >
      Ask the Strategist again
    </Button>
  );
}

/** The plan's outline, filling in as the Strategist gets there. No content until it's real. */
function PlanTakingShape({ fraction }: { fraction: number }) {
  const lit = (at: number) => fraction >= at;
  return (
    <div className="flex flex-col gap-5" aria-hidden>
      <div className="flex flex-col gap-2">
        <Shimmer className="h-6 w-full" />
        <Shimmer className="h-6 w-2/3" />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {[0.2, 0.4, 0.6].map((at) => (
          <div key={at} className={cx("rounded-xl p-4 ring-1 ring-secondary ring-inset transition-opacity", lit(at) ? "opacity-100" : "opacity-40")}>
            <Shimmer className="mb-2 h-7 w-12" />
            <Shimmer className="h-4 w-3/4" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {[0.5, 0.6, 0.7, 0.8].map((at) => (
          <div key={at} className={cx("rounded-xl p-4 ring-1 ring-secondary ring-inset transition-opacity", lit(at) ? "opacity-100" : "opacity-40")}>
            <Shimmer className="mb-2 h-5 w-1/2" />
            <Shimmer className="h-4 w-1/4" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- while you wait ----

function WhileYouWait() {
  const { site } = useWorkspace();
  const { hosting } = useHosting();
  const [ownDomain, setOwnDomain] = useState(false);
  const host = siteHost({ slug: site.slug, domain: site.domain });
  const [name, setName] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const savedName = useSetting<string>("author.name", "") ?? "";
  const savedRole = useSetting<string>("author.tagline", "") ?? "";
  const [guide, setGuide] = useVoiceGuide();
  const [voice, setVoice] = useState<string | null>(null);

  return (
    <section className="border-t border-secondary pt-8">
      <StepTitle title="While you wait" lede="Four things the Strategist doesn't need. Save each one, or skip it: they all live in Settings later." />
      <div className="flex flex-col gap-4">
        <SaveCard id="blog" title="Your blog" summary={hosting === "elsewhere" ? "Lives on another site" : `Hosted on Propaganda at ${host}`}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Choice selected={hosting !== "elsewhere"} onSelect={() => void setHosting("propaganda")} title="Host it on Propaganda" hint={`Live now at ${host}. Your own domain any time.`} />
            <Choice selected={hosting === "elsewhere"} onSelect={() => void setHosting("elsewhere")} title="It lives somewhere else" hint="Framer, WordPress, Webflow… Set it up on the Site page." />
          </div>
          {hosting !== "elsewhere" && !site.domain && (
            <div className="mt-4">
              {ownDomain ? (
                <DomainSetup compact />
              ) : (
                <Button size="sm" color="link-gray" onClick={() => setOwnDomain(true)}>
                  Use my own domain
                </Button>
              )}
            </div>
          )}
        </SaveCard>

        <SaveCard
          id="byline"
          title="Who signs the posts"
          description="Every post carries a real person's name. Google checks; readers do too."
          summary={[savedName, savedRole].filter(Boolean).join(", ") || "Saved"}
          onSave={async () => {
            if (name != null) await setSetting("author.name", name.trim());
            if (role != null) await setSetting("author.tagline", role.trim());
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Name" value={name ?? savedName} onChange={setName} />
            <Input label="Role" placeholder="Head of Operations" value={role ?? savedRole} onChange={setRole} />
          </div>
        </SaveCard>

        <SaveCard
          id="voice"
          title="Your voice"
          description="A few plain sentences on how you sound: who is speaking, how formal, what to avoid. The Writer reads it before every draft."
          summary="Voice guide saved"
          onSave={async () => {
            if (voice != null) setGuide(voice.trim());
          }}
        >
          <textarea
            rows={4}
            value={voice ?? guide}
            onChange={(e) => setVoice(e.target.value)}
            placeholder="We write like an operator talking to another operator: plain, specific, no hype. Numbers over adjectives."
            className="w-full resize-y rounded-lg bg-primary px-3.5 py-2.5 text-md text-primary shadow-xs ring-1 ring-primary outline-none ring-inset placeholder:text-placeholder focus:ring-2 focus:ring-brand"
          />
        </SaveCard>

        <SaveCard
          id="listen"
          title="Where Propaganda listens"
          description="Calls and Slack are where your best posts come from. Connections opens in this tab; come back here from the nav."
          summary="Set up on the Connections page"
          saveLabel="Done"
        >
          <Button size="sm" color="secondary" iconTrailing={ArrowRight} onClick={() => goPage("connections")}>
            Open Connections
          </Button>
        </SaveCard>
      </div>
    </section>
  );
}

/** A setup card with its own Save: once saved (or skipped) it folds to one line, with Edit. Kept per tenant. */
function SaveCard({
  id,
  title,
  description,
  summary,
  saveLabel = "Save",
  onSave,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  summary: string;
  saveLabel?: string;
  onSave?: () => Promise<void> | void;
  children: ReactNode;
}) {
  const key = `onboarding.setup.${id}`;
  const state = useSetting<string>(key, "") ?? "";
  const [busy, setBusy] = useState(false);
  const mark = (v: string) => void setSetting(key, v);

  if (state === "saved" || state === "skipped") {
    return (
      <div className="flex items-center gap-3 rounded-xl px-5 py-3.5 ring-1 ring-secondary ring-inset">
        {state === "saved" ? <CheckCircle className="size-5 text-fg-success-primary" /> : <span className="size-5 rounded-full ring-1 ring-secondary ring-inset" />}
        <span className="text-sm font-medium text-primary">{title}</span>
        <span className="flex-1 truncate text-sm text-tertiary">{state === "saved" ? summary : "Skipped for now"}</span>
        <Button size="sm" color="link-gray" onClick={() => mark("")}>
          Edit
        </Button>
      </div>
    );
  }
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody>{children}</CardBody>
      <CardFooter className="flex justify-end gap-2">
        <Button size="sm" color="tertiary" onClick={() => mark("skipped")}>
          Skip
        </Button>
        <Button
          size="sm"
          iconLeading={Check}
          isLoading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave?.();
              mark("saved");
            } catch (err) {
              reportError(`Getting started: ${title} not saved`, err);
              toast.add({ type: "error", title: `Couldn't save ${title.toLowerCase()}`, description: userMessage(err) });
            } finally {
              setBusy(false);
            }
          }}
        >
          {saveLabel}
        </Button>
      </CardFooter>
    </Card>
  );
}
