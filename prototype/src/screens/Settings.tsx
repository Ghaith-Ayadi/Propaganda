// Settings: there is a lot more in 0.2, so it's a page with sections rather
// than the old dialog. Site, people, content sources, goals, agents, plan.

import { useState } from "react";
import {
  Building02,
  CpuChip01,
  CreditCard01,
  Database01,
  Target04,
  Users01,
} from "@untitledui/icons";
import { Button, Card, CardHead, Eyebrow, Field, Pill, Segmented, Toggle, cx, inputClass } from "../bits";
import { useStore } from "../store";
import * as D from "../data";

type Section = "site" | "people" | "sources" | "goals" | "agents" | "plan";

const SECTIONS: Array<{ id: Section; label: string; icon: React.ReactNode }> = [
  { id: "site", label: "Site", icon: <Building02 className="size-4" /> },
  { id: "people", label: "People", icon: <Users01 className="size-4" /> },
  { id: "sources", label: "Sources", icon: <Database01 className="size-4" /> },
  { id: "goals", label: "Goals", icon: <Target04 className="size-4" /> },
  { id: "agents", label: "Agents", icon: <CpuChip01 className="size-4" /> },
  { id: "plan", label: "Plan", icon: <CreditCard01 className="size-4" /> },
];

export function Settings() {
  const { s, toast } = useStore();
  const [section, setSection] = useState<Section>("site");
  const [levels, setLevels] = useState<Record<string, string>>(
    Object.fromEntries(D.autonomy.map((a) => [a.stage, a.level])),
  );
  const [sweepWeekly, setSweepWeekly] = useState(true);
  const [emailDrop, setEmailDrop] = useState(true);
  const [perfMode, setPerfMode] = useState<"growth" | "numbers">(D.performance.mode);
  const [goal, setGoal] = useState(D.coverage.internal.goal);

  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-5 px-4 py-8 sm:px-6">
      <header>
        <h1 className="font-title text-2xl text-primary">Settings</h1>
        <p className="mt-0.5 text-sm text-tertiary">
          Everyone invited to {D.site.name} can change all of this. Roles come later.
        </p>
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,200px)_minmax(0,1fr)]">
        <nav className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
          {SECTIONS.map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setSection(x.id)}
              aria-pressed={section === x.id}
              className={cx(
                "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition",
                section === x.id
                  ? "bg-primary text-primary shadow-xs ring-1 ring-inset ring-primary"
                  : "text-tertiary hover:bg-primary_hover hover:text-secondary",
              )}
            >
              <span className={section === x.id ? "text-brand-secondary" : "text-quaternary"}>{x.icon}</span>
              {x.label}
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-col gap-4">
          {section === "site" && (
            <>
              <Card className="flex flex-col gap-4">
                <CardHead title="Site" hint="One site per company." />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Name">
                    <input id="set-name" className={inputClass} defaultValue={D.site.name} />
                  </Field>
                  <Field label="Blog address">
                    <input id="set-host" className={inputClass} defaultValue={D.site.blogUrl} />
                  </Field>
                </div>
                <Field label="Where Propaganda publishes" hint="One way: Propaganda pushes, it never pulls back.">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone="good">{D.site.destination} connected</Pill>
                    <Button size="sm" onClick={() => toast("Reconnected")}>Reconnect</Button>
                    <Button size="sm" kind="ghost" onClick={() => toast("Disconnected")}>Disconnect</Button>
                  </div>
                </Field>
              </Card>
              <Card className="flex flex-col gap-3">
                <CardHead title="Danger" hint="Deleting a site removes its content, flags and knowledge base." />
                <Button kind="danger" size="sm" className="self-start" onClick={() => toast("Not in the prototype")}>
                  Delete {D.site.name}
                </Button>
              </Card>
            </>
          )}

          {section === "people" && (
            <Card className="flex flex-col gap-4">
              <CardHead
                title="People"
                hint="One type of user: everyone can do and see everything."
                right={<Button size="sm" kind="primary" onClick={() => toast("Invite sent")}>Invite</Button>}
              />
              <ul className="divide-y divide-[var(--color-border-secondary)] overflow-hidden rounded-xl border border-secondary">
                {D.team.map((t) => (
                  <li key={t.email} className="flex items-center gap-3 bg-primary px-4 py-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-medium text-secondary">
                      {t.initials}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-primary">{t.name}</span>
                      <span className="block truncate text-xs text-tertiary">{t.email}</span>
                    </span>
                    <span className="shrink-0 text-xs text-quaternary">{t.lastSeen}</span>
                    <Button size="sm" kind="ghost" onClick={() => toast("Removed")}>
                      Remove
                    </Button>
                  </li>
                ))}
                {D.pendingInvites.map((e) => (
                  <li key={e} className="flex items-center gap-3 bg-secondary px-4 py-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-xs text-quaternary ring-1 ring-inset ring-secondary">
                      ?
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-tertiary">{e}</span>
                    <Pill tone="warn">Invited</Pill>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {section === "sources" && (
            <>
              <Card className="flex flex-col gap-4">
                <CardHead title="How documents arrive" hint="Propaganda receives documents. Getting them here is your choice." />
                <div className="flex flex-col gap-3">
                  <SettingRow
                    title="Email forwarding"
                    desc={`Anything sent to drop@${D.site.slug}.propaganda.pub`}
                    right={<Toggle on={emailDrop} onChange={setEmailDrop} label="Email forwarding" />}
                  />
                  <SettingRow
                    title="Weekly sweep"
                    desc="Re-reads every post against the knowledge base, Mondays at 6am"
                    right={<Toggle on={sweepWeekly} onChange={setSweepWeekly} label="Weekly sweep" />}
                  />
                </div>
              </Card>
              <Card pad={false}>
                <div className="flex items-center justify-between gap-3 border-b border-secondary px-4 py-3">
                  <Eyebrow>Recent documents</Eyebrow>
                  <Button size="sm" onClick={() => toast("Not in the prototype")}>Upload</Button>
                </div>
                <ul className="divide-y divide-[var(--color-border-secondary)]">
                  {D.sources.map((x) => (
                    <li key={x.id} className="flex items-center gap-3 px-4 py-2.5">
                      <Pill tone="neutral">{x.kind === "call" ? "Call" : "Document"}</Pill>
                      <span className="min-w-0 flex-1 truncate text-sm text-primary">{x.title}</span>
                      <span className="tnum shrink-0 text-xs text-tertiary">{x.insights} insights</span>
                      <span className="tnum shrink-0 text-xs text-quaternary">{x.date}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </>
          )}

          {section === "goals" && (
            <>
              <Card className="flex flex-col gap-4">
                <CardHead title="Consistency" hint="Can't be switched off." right={<Pill tone="good">Always on</Pill>} />
                <div className="overflow-hidden rounded-xl border border-secondary">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-secondary text-left text-xs text-quaternary">
                        <th className="px-4 py-2 font-semibold uppercase tracking-wider">Grade</th>
                        <th className="px-4 py-2 font-semibold uppercase tracking-wider">Clean content</th>
                      </tr>
                    </thead>
                    <tbody className="tnum">
                      {D.gradeCutoffs.map(([g, min], i) => (
                        <tr key={g} className="border-t border-secondary">
                          <td className="px-4 py-2 font-title text-base text-primary">{g}</td>
                          <td className="px-4 py-2 text-secondary">
                            {i === D.gradeCutoffs.length - 1 ? `under ${Math.round(D.gradeCutoffs[i - 1][1] * 100)}%` : `${Math.round(min * 100)}% or more`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-tertiary">
                  Both grades use these cut-offs: one over your content, one over the knowledge base.
                </p>
              </Card>

              <Card className="flex flex-col gap-4">
                <CardHead title="Coverage" hint={`Published ÷ goal, per quarter. ${D.QUARTER}.`} />
                <Field label="Posts you intend to publish this quarter">
                  <div className="flex items-center gap-3">
                    <input id="set-goal" type="range" min={2} max={30} value={goal} onChange={(e) => setGoal(+e.target.value)} className="w-full accent-[var(--color-bg-brand-solid)]" />
                    <span className="tnum w-20 shrink-0 text-sm text-primary">{goal} posts</span>
                  </div>
                </Field>
                <div className="flex flex-col gap-3 border-t border-secondary pt-4">
                  <Eyebrow>Focus topics and ranges</Eyebrow>
                  {s.topics.map((t) => (
                    <div key={t.id} className="flex flex-wrap items-center gap-3">
                      <span className="min-w-0 flex-1 truncate text-sm text-primary">{t.name}</span>
                      <span className="tnum flex items-center gap-1.5 text-sm">
                        <input defaultValue={t.range[0]} className={cx(inputClass, "w-14 px-2 py-1 text-center")} />
                        <span className="text-quaternary">to</span>
                        <input defaultValue={t.range[1]} className={cx(inputClass, "w-14 px-2 py-1 text-center")} />
                      </span>
                      <Pill tone="neutral">Priority {t.importance}</Pill>
                    </div>
                  ))}
                  <p className="text-xs text-quaternary">
                    Ranges, not fixed numbers. The strategy agent proposes them; you can overrule it.
                  </p>
                </div>
              </Card>

              <Card className="flex flex-col gap-4">
                <CardHead title="Performance" hint="Reported, never promised." right={<Pill tone="neutral">Optional</Pill>} />
                <Segmented
                  value={perfMode}
                  onChange={setPerfMode}
                  options={[
                    { value: "growth", label: "Growth on current" },
                    { value: "numbers", label: "Fixed numbers" },
                  ]}
                />
                {perfMode === "growth" ? (
                  <Field label="Growth target" hint="Applied to each metric below.">
                    <input id="set-growth" className={cx(inputClass, "tnum max-w-32")} defaultValue="15%" />
                  </Field>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-3">
                    {D.performance.metrics.map((m) => (
                      <Field key={m.key} label={m.label}>
                        <input id={`set-${m.key}`} className={cx(inputClass, "tnum")} defaultValue={m.value} />
                      </Field>
                    ))}
                  </div>
                )}
              </Card>
            </>
          )}

          {section === "agents" && (
            <>
              <Card className="flex flex-col gap-4">
                <CardHead
                  title="How far the agents go"
                  hint="Each stage on its own. Off means the stage doesn't run at all."
                />
                <ul className="flex flex-col gap-3">
                  {D.autonomy.map((a) => (
                    <li key={a.stage} className="flex flex-wrap items-center gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-primary">{a.stage}</span>
                        <span className="block text-xs text-tertiary">{a.desc}</span>
                      </span>
                      <Segmented
                        value={levels[a.stage]}
                        onChange={(v) => setLevels((l) => ({ ...l, [a.stage]: v }))}
                        options={[
                          { value: "off", label: "Off" },
                          { value: "ask", label: "Ask me" },
                          { value: "auto", label: "On its own" },
                        ]}
                      />
                    </li>
                  ))}
                </ul>
              </Card>
              <Card className="flex flex-col gap-3">
                <CardHead title="The Guardian" hint="The only thing that writes to the knowledge base." />
                <Segmented
                  value="strict"
                  onChange={() => toast("Only strict in the prototype")}
                  options={[
                    { value: "strict", label: "Strict" },
                    { value: "lenient", label: "Lenient" },
                  ]}
                />
                <p className="max-w-[70ch] text-xs text-tertiary">
                  Strict is the point of it. A weak argument is admitted as contested rather than
                  rejected, so the gap in what you know is recorded instead of lost.
                </p>
              </Card>
            </>
          )}

          {section === "plan" && (
            <Card className="flex flex-col gap-4">
              <CardHead title="Plan" hint={D.usage.plan} right={<Pill tone="good">Active</Pill>} />
              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-secondary">Credits used this month</span>
                  <span className="tnum text-primary">
                    ${D.usage.used} of ${D.usage.credits}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-quaternary/60">
                  <div className="h-full rounded-full bg-brand-solid" style={{ width: `${(D.usage.used / D.usage.credits) * 100}%` }} />
                </div>
                <p className="text-xs text-quaternary">
                  Renews {D.usage.renews}. Sweeps are about half of it; the weekly sweep is the knob to
                  turn if this gets expensive.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 border-t border-secondary pt-4">
                <Button size="sm" onClick={() => toast("Not in the prototype")}>Top up</Button>
                <Button size="sm" kind="ghost" onClick={() => toast("Not in the prototype")}>Change plan</Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function SettingRow({ title, desc, right }: { title: string; desc: string; right: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-secondary bg-primary px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-primary">{title}</span>
        <span className="block text-xs text-tertiary">{desc}</span>
      </span>
      {right}
    </div>
  );
}
