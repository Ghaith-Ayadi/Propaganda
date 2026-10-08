// #/welcome: a new tenant's first run, full screen, outside the nav. Workspace
// opens it right after a tenant is created (sign-in and naming the tenant
// happen there, components/workspace/). Replayable from the Site page.
//
//   1. Your blog     hosted here (address, optional own domain) or elsewhere
//   2. Strategy      the Strategist's questions        (handoffs.ts)
//   3. Sources       Connections                       (handoffs.ts)
//   4. Ready         what happens next
//
// Progress is a setting of the site (onboarding.step), so it resumes where it
// stopped, on any device. Finishing stamps onboarding.completed.

import { Suspense, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { NativeSelect } from "@/components/base/select/select-native";
import { useWorkspace } from "@/components/Workspace";
import { DomainSetup } from "@/components/site/DomainSetup";
import { PENDING_DOMAIN_KEY } from "@/components/site/domains";
import { PLATFORMS, platformLabel, setHosting, setPlatform, setPlatformUrl, useHosting } from "@/components/site/hosting";
import { setSetting, useSetting } from "@/lib/settings";
import { siteHost } from "@/lib/siteUrl";
import { goPage } from "@/lib/route";
import { track } from "@/lib/telemetry";
import { cx } from "@/utils/cx";
import { HANDOFFS, type Handoff } from "./handoffs";

const STEPS = ["Your blog", ...HANDOFFS.map((h) => h.label), "Ready"];
const LAST = STEPS.length - 1;

export function OnboardingFlow() {
  const { site } = useWorkspace();
  const saved = useSetting<number>("onboarding.step", 0) ?? 0;
  const [step, setStepState] = useState(() => Math.min(Math.max(0, Number(saved) || 0), LAST));
  // Settings load after the first render: resume at the saved step unless they've moved already.
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current) setStepState(Math.min(Math.max(0, Number(saved) || 0), LAST));
  }, [saved]);

  function setStep(n: number) {
    moved.current = true;
    const next = Math.min(Math.max(0, n), LAST);
    setStepState(next);
    void setSetting("onboarding.step", next);
    track("onboarding_step", { step: STEPS[next] });
  }

  function finish() {
    void setSetting("onboarding.completed", new Date().toISOString());
    void setSetting("onboarding.step", 0);
    track("onboarding_finished");
    goPage("home");
  }

  const handoff: Handoff | undefined = step >= 1 && step <= HANDOFFS.length ? HANDOFFS[step - 1] : undefined;

  return (
    <div className="h-dvh w-full overflow-y-auto bg-secondary">
      <div className="mx-auto flex min-h-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-md bg-brand-solid font-title text-base leading-none text-white">P</span>
            <span className="font-title text-lg text-primary">{site.name}</span>
          </div>
          <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs">
            {STEPS.map((s, i) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => i < step && setStep(i)}
                  disabled={i >= step}
                  className={cx(
                    "flex items-center gap-1.5 rounded-full px-2 py-0.5",
                    i === step ? "bg-primary text-primary ring-1 ring-primary ring-inset" : "text-quaternary",
                    i < step && "hover:text-secondary",
                  )}
                >
                  {i < step ? (
                    <Check className="size-3 text-fg-success-primary" />
                  ) : (
                    <span className={cx("size-1.5 rounded-full", i === step ? "bg-brand-solid" : "bg-quaternary")} />
                  )}
                  {s}
                </button>
              </li>
            ))}
          </ol>
        </header>

        <section className="flex flex-1 flex-col gap-6 rounded-2xl bg-primary p-6 shadow-xs ring-1 ring-secondary ring-inset sm:p-8">
          {step === 0 && <BlogStep />}
          {handoff && <HandoffStep key={handoff.id} handoff={handoff} onDone={() => setStep(step + 1)} />}
          {step === LAST && <ReadyStep />}

          <footer className="mt-auto flex items-center justify-between gap-3 border-t border-secondary pt-5">
            <Button color="tertiary" iconLeading={ArrowLeft} isDisabled={step === 0} onClick={() => setStep(step - 1)}>
              Back
            </Button>
            <div className="flex items-center gap-3">
              {step < LAST && (
                <Button color="link-gray" size="sm" onClick={finish}>
                  Finish later
                </Button>
              )}
              {step < LAST ? (
                <Button color="primary" iconTrailing={ArrowRight} onClick={() => setStep(step + 1)}>
                  {handoff?.component ? "Skip for now" : "Continue"}
                </Button>
              ) : (
                <Button color="primary" iconTrailing={ArrowRight} onClick={finish}>
                  Go to Home
                </Button>
              )}
            </div>
          </footer>
        </section>
      </div>
    </div>
  );
}

function StepHead({ title, lede }: { title: string; lede: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h1 className="font-title text-2xl text-primary">{title}</h1>
      <p className="text-sm text-tertiary">{lede}</p>
    </div>
  );
}

function BlogStep() {
  const { site } = useWorkspace();
  const { hosting, platform, url } = useHosting();
  const pending = useSetting<string>(PENDING_DOMAIN_KEY, "") ?? "";
  const [ownDomain, setOwnDomain] = useState(Boolean(pending || site.domain));
  const host = siteHost({ slug: site.slug, domain: "" });

  return (
    <div className="flex flex-col gap-5">
      <StepHead title="Your blog" lede="Where should readers find what Propaganda writes?" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Choice
          selected={hosting === "propaganda"}
          onSelect={() => void setHosting("propaganda")}
          title="Host it on Propaganda"
          hint={`Live now at ${host}. Your own domain any time.`}
        />
        <Choice
          selected={hosting === "elsewhere"}
          onSelect={() => void setHosting("elsewhere")}
          title="It lives somewhere else"
          hint="Framer, WordPress, Webflow… Propaganda publishes to it."
        />
      </div>

      {hosting === "propaganda" ? (
        <div className="flex flex-col gap-4 rounded-xl bg-secondary p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-secondary">
              {site.domain ? (
                <>Your blog is at <span className="font-mono text-primary">{site.domain}</span>.</>
              ) : (
                <>Your blog is at <span className="font-mono text-primary">{host}</span>.</>
              )}
            </p>
            {!site.domain && !ownDomain && (
              <Button color="secondary" size="sm" onClick={() => setOwnDomain(true)}>
                Use my own domain
              </Button>
            )}
          </div>
          {(ownDomain || site.domain) && (
            <div className="rounded-xl bg-primary p-4 ring-1 ring-secondary ring-inset">
              <DomainSetup compact />
              <p className="mt-4 text-xs text-tertiary">You can carry on while DNS catches up. The Site page keeps checking.</p>
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-4 rounded-xl bg-secondary p-4 sm:grid-cols-2">
          <NativeSelect label="Platform" value={platform || "other"} onChange={(e) => void setPlatform(e.target.value)} options={PLATFORMS} />
          <Input
            label="Blog address"
            placeholder="https://yourcompany.com/blog"
            defaultValue={url}
            onBlur={(e) => void setPlatformUrl((e.target as HTMLInputElement).value.trim())}
          />
          <p className="text-xs text-tertiary sm:col-span-2">
            We'll read what's already on {platform ? platformLabel(platform) : "it"} so the first plan starts from what you have.
          </p>
        </div>
      )}
    </div>
  );
}

function Choice({ selected, onSelect, title, hint }: { selected: boolean; onSelect: () => void; title: string; hint: string }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cx(
        "flex flex-col gap-1 rounded-xl p-4 text-left ring-1 ring-inset transition",
        selected ? "bg-brand-primary ring-brand" : "bg-primary ring-secondary hover:bg-primary_hover",
      )}
    >
      <span className="text-sm font-semibold text-primary">{title}</span>
      <span className="text-xs text-tertiary">{hint}</span>
    </button>
  );
}

function HandoffStep({ handoff, onDone }: { handoff: Handoff; onDone: () => void }) {
  const Step = handoff.component;
  return (
    <div className="flex flex-col gap-5">
      <StepHead title={handoff.title} lede={handoff.lede} />
      {Step ? (
        <Suspense fallback={<p className="text-sm text-tertiary">Loading…</p>}>
          <Step onDone={onDone} />
        </Suspense>
      ) : (
        <div className="rounded-xl border border-dashed border-secondary bg-secondary p-5">
          <p className="text-xs font-medium tracking-wide text-quaternary uppercase">What this step will ask</p>
          <ul className="mt-3 space-y-2 text-sm text-secondary">
            {handoff.placeholder.map((line) => (
              <li key={line} className="flex gap-2">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-quaternary" />
                {line}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-tertiary">This step is being built. Continue for now; it will show up here and on the {handoff.label === "Strategy" ? "Goals" : "Connections"} page.</p>
        </div>
      )}
    </div>
  );
}

function ReadyStep() {
  const { site } = useWorkspace();
  const { hosting, platform } = useHosting();
  const pending = useSetting<string>(PENDING_DOMAIN_KEY, "") ?? "";
  const lines = [
    hosting === "propaganda"
      ? site.domain
        ? `Your blog is live at ${site.domain}.`
        : pending
          ? `Your blog is at ${siteHost({ slug: site.slug, domain: "" })}; ${pending} goes live once its DNS is in. The Site page shows where it stands.`
          : `Your blog is live at ${siteHost({ slug: site.slug, domain: "" })}.`
      : `Propaganda will publish to ${platformLabel(platform)}.`,
    "The Strategist drafts this quarter's plan from your answers.",
    "Your first briefs land in the Inbox for you to approve.",
  ];
  return (
    <div className="flex flex-col gap-5">
      <StepHead title="You're set" lede="Here's what happens next." />
      <ul className="flex flex-col gap-2">
        {lines.map((l) => (
          <li key={l} className="flex items-start gap-2.5 rounded-lg bg-secondary px-3 py-2.5 text-sm text-secondary">
            <Check className="mt-0.5 size-4 shrink-0 text-fg-success-primary" />
            {l}
          </li>
        ))}
      </ul>
    </div>
  );
}
