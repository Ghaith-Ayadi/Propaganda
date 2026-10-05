// Onboarding: five steps, ending on the first sweep running.
// Sign in, name the site, connect where content lives, pick topics and goals,
// drop in the first documents, then watch the first sweep.

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  File02,
  Globe01,
  Mail01,
  Microphone01,
  Plus,
  Target04,
  UploadCloud01,
  X,
} from "@untitledui/icons";
import { Button, Card, Dot, Eyebrow, Field, Pill, cx, inputClass } from "../bits";
import { useStore } from "../store";
import * as D from "../data";

const STEPS = ["Sign in", "Your site", "Content", "Focus", "Documents", "First sweep"] as const;

export function Onboarding() {
  const { go, toast } = useStore();
  const [step, setStep] = useState(0);

  // Step 1
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  // Step 2
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  // Step 3
  const [destination, setDestination] = useState<string | null>(null);
  // Step 4
  const [picked, setPicked] = useState<string[]>(["close", "ap"]);
  const [goal, setGoal] = useState(10);
  // Step 5
  const [dropped, setDropped] = useState<string[]>([]);

  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  const canNext = [
    codeSent && code.length >= 4,
    name.trim().length > 1 && host.trim().length > 3,
    destination !== null,
    picked.length >= 2,
    true,
    true,
  ][step];

  return (
    <div className="min-h-full bg-secondary">
      <div className="mx-auto flex min-h-full max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-md bg-brand-solid font-title text-base leading-none text-white">P</span>
            <span className="font-title text-lg text-primary">Propaganda</span>
          </div>
          <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {STEPS.map((s, i) => (
              <li key={s} className="flex items-center gap-2">
                <span
                  className={cx(
                    "flex items-center gap-1.5 rounded-full px-2 py-0.5",
                    i === step ? "bg-primary text-primary ring-1 ring-inset ring-primary" : "text-quaternary",
                  )}
                >
                  {i < step ? <Check className="size-3 text-success-primary" /> : <Dot tone={i === step ? "info" : "neutral"} />}
                  {s}
                </span>
              </li>
            ))}
          </ol>
        </header>

        <Card className="fade-up flex flex-1 flex-col gap-6 p-6 sm:p-8">
          {step === 0 && (
            <Step
              title="Sign in"
              lede="No passwords. Google, or a code in your inbox."
            >
              <div className="flex flex-col gap-3">
                <Button kind="secondary" className="justify-center" iconLeading={<Globe01 className="size-4" />} onClick={() => { setCodeSent(true); setCode("482913"); setEmail(D.me.email); }}>
                  Continue with Google
                </Button>
                <div className="flex items-center gap-3 text-xs text-quaternary">
                  <span className="h-px flex-1 bg-[var(--color-border-secondary)]" />
                  or
                  <span className="h-px flex-1 bg-[var(--color-border-secondary)]" />
                </div>
                <Field label="Work email">
                  <input
                    id="ob-email"
                    className={inputClass}
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Field>
                {!codeSent ? (
                  <Button kind="primary" className="self-start" iconLeading={<Mail01 className="size-4" />} disabled={!email.includes("@")} onClick={() => setCodeSent(true)}>
                    Email me a code
                  </Button>
                ) : (
                  <Field label="Six-digit code" hint={`Sent to ${email || "your inbox"}. In the prototype, any six digits work.`}>
                    <input
                      id="ob-code"
                      className={cx(inputClass, "tnum tracking-[0.4em]")}
                      placeholder="······"
                      inputMode="numeric"
                      maxLength={6}
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    />
                  </Field>
                )}
              </div>
            </Step>
          )}

          {step === 1 && (
            <Step title="Your site" lede="One site per company. You can add more later.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Company">
                  <input id="ob-name" className={inputClass} placeholder="Ledgerline" value={name} onChange={(e) => { setName(e.target.value); if (!host) setHost(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, "") + ".io"); }} />
                </Field>
                <Field label="Where your blog lives" hint="Used for the audit and for published links.">
                  <input id="ob-host" className={inputClass} placeholder="ledgerline.io" value={host} onChange={(e) => setHost(e.target.value)} />
                </Field>
              </div>
              <Field label="Who writes here" hint="Everyone invited can do and see everything. Roles come later.">
                <div className="flex flex-wrap items-center gap-2">
                  {D.team.slice(0, 3).map((t) => (
                    <Pill key={t.email} tone="neutral">{t.email}</Pill>
                  ))}
                  <Button size="sm" kind="ghost" iconLeading={<Plus className="size-3.5" />} onClick={() => toast("Invite sent")}>
                    Invite
                  </Button>
                </div>
              </Field>
            </Step>
          )}

          {step === 2 && (
            <Step title="Content" lede="Propaganda reads what you have already published, going back years. That first read is the baseline for consistency.">
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  { id: "framer", label: "Framer", hint: "Read and publish" },
                  { id: "rss", label: "Sitemap or RSS", hint: "Read only" },
                  { id: "none", label: "Nothing yet", hint: "Write here instead" },
                ].map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setDestination(o.id)}
                    className={cx(
                      "flex flex-col gap-1 rounded-xl border p-4 text-left transition",
                      destination === o.id
                        ? "border-brand-solid bg-brand-primary"
                        : "border-secondary bg-primary hover:bg-secondary",
                    )}
                  >
                    <span className="text-sm font-medium text-primary">{o.label}</span>
                    <span className="text-xs text-tertiary">{o.hint}</span>
                  </button>
                ))}
              </div>
              {destination && destination !== "none" && (
                <div className="rounded-xl border border-secondary bg-secondary p-4">
                  <Eyebrow>Found on {host || "your site"}</Eyebrow>
                  <p className="mt-1.5 text-sm text-secondary">
                    <strong className="tnum text-primary">{D.totalContent} posts</strong> back to March 2023. Propaganda publishes one way: it pushes, never pulls back.
                  </p>
                </div>
              )}
            </Step>
          )}

          {step === 3 && (
            <Step title="Focus" lede="Pick the topics worth writing about this quarter, then say how much you intend to publish. Ranges, not fixed numbers.">
              <div className="flex flex-col gap-2">
                {D.topics.map((t) => {
                  const on = picked.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setPicked((p) => (on ? p.filter((x) => x !== t.id) : [...p, t.id]))}
                      className={cx(
                        "flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition",
                        on ? "border-brand-solid bg-brand-primary" : "border-secondary bg-primary hover:bg-secondary",
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-primary">{t.name}</span>
                        <span className="block text-xs text-tertiary">
                          Suggested {t.range[0]}–{t.range[1]} posts this quarter
                        </span>
                      </span>
                      <span className={cx("grid size-5 shrink-0 place-items-center rounded-md ring-1 ring-inset", on ? "bg-brand-solid ring-brand_alt" : "ring-primary")}>
                        {on && <Check className="size-3 text-white" />}
                      </span>
                    </button>
                  );
                })}
              </div>
              <Field label={`Publishing goal for ${D.QUARTER}`} hint="Coverage is published ÷ goal. The strategy agent recommends 10.">
                <div className="flex items-center gap-3">
                  <input
                    id="ob-goal"
                    type="range"
                    min={2}
                    max={30}
                    value={goal}
                    onChange={(e) => setGoal(+e.target.value)}
                    className="w-full accent-[var(--color-bg-brand-solid)]"
                  />
                  <span className="tnum w-20 shrink-0 text-sm text-primary">{goal} posts</span>
                </div>
              </Field>
              <div className="flex items-start gap-2 rounded-xl border border-secondary bg-secondary p-4">
                <Target04 className="mt-0.5 size-4 shrink-0 text-brand-secondary" />
                <p className="text-xs text-secondary">
                  <strong className="text-primary">Consistency is on for every site</strong> and can't be turned off. Coverage and performance are optional; you can add them later.
                </p>
              </div>
            </Step>
          )}

          {step === 4 && (
            <Step title="Documents" lede="Call transcripts and internal documents are what Propaganda checks your content against. Drop them in however you like: email forwarding, an integration, or straight from your machine.">
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  setDropped(D.sources.slice(0, 3).map((s) => s.title));
                }}
                className="grid place-items-center gap-2 rounded-xl border border-dashed border-secondary bg-secondary px-6 py-10 text-center"
              >
                <UploadCloud01 className="size-5 text-quaternary" />
                <p className="text-sm text-secondary">Drop Markdown or text files here</p>
                <Button size="sm" onClick={() => setDropped(D.sources.slice(0, 3).map((s) => s.title))}>
                  Choose files
                </Button>
                <p className="text-xs text-quaternary">
                  Or forward to <span className="font-mono">drop@{host || "ledgerline"}.propaganda.pub</span>
                </p>
              </div>
              {dropped.length > 0 && (
                <ul className="flex flex-col gap-1.5">
                  {dropped.map((t) => (
                    <li key={t} className="flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm text-secondary">
                      <File02 className="size-4 shrink-0 text-quaternary" />
                      <span className="min-w-0 flex-1 truncate">{t}</span>
                      <Check className="size-4 shrink-0 text-success-primary" />
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-tertiary">
                <Microphone01 className="mr-1 inline size-3.5 -translate-y-px" />
                Transcripts are read from the day you connect. Older calls are never backfilled.
              </p>
            </Step>
          )}

          {step === 5 && <FirstSweep onDone={() => { toast("Your first sweep is done"); go("home"); }} />}

          {step < 5 && (
            <footer className="mt-auto flex items-center justify-between gap-3 border-t border-secondary pt-5">
              <Button kind="ghost" iconLeading={<ArrowLeft className="size-4" />} onClick={back} disabled={step === 0}>
                Back
              </Button>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => go("home")} className="text-xs text-quaternary hover:text-tertiary">
                  Skip the tour
                </button>
                <Button kind="primary" disabled={!canNext} onClick={next}>
                  Continue
                  <ArrowRight className="size-4" />
                </Button>
              </div>
            </footer>
          )}
        </Card>
      </div>
    </div>
  );
}

function Step({ title, lede, children }: { title: string; lede: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-title text-2xl text-primary">{title}</h1>
        <p className="max-w-[60ch] text-sm text-tertiary">{lede}</p>
      </div>
      {children}
    </div>
  );
}

const SWEEP = [
  { label: `Reading ${D.totalContent} published posts`, detail: "Baseline for the content grade" },
  { label: "Reading 3 documents", detail: "22 insights" },
  { label: "Building the knowledge base", detail: `${D.kb.entries} claims` },
  { label: "Checking content against the knowledge base", detail: "12 flags raised" },
  { label: "Looking for things worth writing", detail: "4 pitches with a reason" },
];

function FirstSweep({ onDone }: { onDone: () => void }) {
  const { d } = useStore();
  const [done, setDone] = useState(0);

  useEffect(() => {
    if (done >= SWEEP.length) return;
    const t = setTimeout(() => setDone((d) => d + 1), done === 0 ? 500 : 900);
    return () => clearTimeout(t);
  }, [done]);

  const finished = done >= SWEEP.length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-title text-2xl text-primary">First sweep</h1>
        <p className="max-w-[60ch] text-sm text-tertiary">
          This runs once, now, and then weekly. Everything it finds lands in your inbox.
        </p>
      </div>
      <ol className="flex flex-col gap-0.5">
        {SWEEP.map((s, i) => {
          const state = i < done ? "done" : i === done ? "running" : "waiting";
          return (
            <li
              key={s.label}
              className={cx(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 transition",
                state === "running" && "bg-secondary",
              )}
            >
              <span className="grid size-5 shrink-0 place-items-center">
                {state === "done" ? (
                  <Check className="size-4 text-success-primary" />
                ) : state === "running" ? (
                  <span className="size-2 animate-pulse rounded-full bg-brand-solid" />
                ) : (
                  <span className="size-1.5 rounded-full bg-quaternary" />
                )}
              </span>
              <span className={cx("min-w-0 flex-1 text-sm", state === "waiting" ? "text-quaternary" : "text-primary")}>
                {s.label}
              </span>
              <span className="shrink-0 text-xs text-tertiary">{state === "done" ? s.detail : ""}</span>
            </li>
          );
        })}
      </ol>
      {finished && (
        <div className="fade-up flex flex-wrap items-center justify-between gap-3 rounded-xl border border-secondary bg-secondary p-4">
          <p className="text-sm text-secondary">
            <strong className="text-primary">{d.inboxTotal} things need you.</strong> Your content grade starts at {d.content.grade}.
          </p>
          <Button kind="primary" onClick={onDone}>
            Go to the inbox
            <ArrowRight className="size-4" />
          </Button>
        </div>
      )}
      {!finished && (
        <button type="button" onClick={onDone} className="self-start text-xs text-quaternary hover:text-tertiary">
          <X className="mr-1 inline size-3" />
          Leave it running
        </button>
      )}
    </div>
  );
}
