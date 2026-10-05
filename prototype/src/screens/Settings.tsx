// Settings: a page with sections rather than the old dialog, because 0.2 adds
// a lot: what content is watched, where knowledge comes from, who has the final
// word on a topic, how strict the agents are, and what it all costs.

import { useState } from "react";
import {
  Bell01,
  Building02,
  Copy01,
  CpuChip01,
  CreditCard01,
  Database01,
  DotsGrid,
  PenTool02,
  Plus,
  Scales02,
  Target04,
  Trash01,
  Users01,
} from "@untitledui/icons";
import {
  Button,
  Card,
  CardHead,
  Eyebrow,
  Field,
  Pill,
  Segmented,
  Toggle,
  TypeIcon,
  cx,
  inputClass,
} from "../bits";
import { topicName, useStore } from "../store";
import * as D from "../data";
import type { ObjectType } from "../data";

type Section = "site" | "content" | "people" | "sources" | "knowledge" | "goals" | "agents" | "voice" | "notifications" | "plan";

const SECTIONS: Array<{ id: Section; label: string; icon: React.ReactNode; group: string }> = [
  { id: "site", label: "Site", icon: <Building02 className="size-4" />, group: "Workspace" },
  { id: "people", label: "People and owners", icon: <Users01 className="size-4" />, group: "Workspace" },
  { id: "content", label: "Content we watch", icon: <DotsGrid className="size-4" />, group: "Inputs" },
  { id: "sources", label: "Documents and calls", icon: <Database01 className="size-4" />, group: "Inputs" },
  { id: "knowledge", label: "Knowledge base", icon: <Scales02 className="size-4" />, group: "Rules" },
  { id: "goals", label: "Goals", icon: <Target04 className="size-4" />, group: "Rules" },
  { id: "agents", label: "Agents", icon: <CpuChip01 className="size-4" />, group: "Rules" },
  { id: "voice", label: "Voice", icon: <PenTool02 className="size-4" />, group: "Rules" },
  { id: "notifications", label: "Notifications", icon: <Bell01 className="size-4" />, group: "You" },
  { id: "plan", label: "Plan and usage", icon: <CreditCard01 className="size-4" />, group: "You" },
];

export function Settings() {
  const [section, setSection] = useState<Section>("site");
  const groups = [...new Set(SECTIONS.map((x) => x.group))];

  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-5 px-4 py-8 sm:px-6">
      <header>
        <h1 className="font-title text-2xl text-primary">Settings</h1>
        <p className="mt-0.5 text-sm text-tertiary">Everyone invited to {D.site.name} can change all of this. Roles come later.</p>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,210px)_minmax(0,1fr)]">
        <nav className="flex gap-1 overflow-x-auto pb-1 lg:sticky lg:top-6 lg:flex-col lg:gap-4 lg:overflow-visible lg:pb-0">
          {groups.map((g) => (
            <div key={g} className="flex shrink-0 gap-1 lg:flex-col lg:gap-0.5">
              <div className="hidden px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-quaternary lg:block">{g}</div>
              {SECTIONS.filter((x) => x.group === g).map((x) => (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => setSection(x.id)}
                  aria-pressed={section === x.id}
                  className={cx(
                    "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition",
                    section === x.id ? "bg-primary text-primary shadow-xs ring-1 ring-inset ring-primary" : "text-tertiary hover:bg-primary_hover hover:text-secondary",
                  )}
                >
                  <span className={section === x.id ? "text-brand-secondary" : "text-quaternary"}>{x.icon}</span>
                  {x.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="flex min-w-0 flex-col gap-4">
          {section === "site" && <SiteSection />}
          {section === "people" && <PeopleSection />}
          {section === "content" && <ContentSection />}
          {section === "sources" && <SourcesSection />}
          {section === "knowledge" && <KnowledgeSection />}
          {section === "goals" && <GoalsSection />}
          {section === "agents" && <AgentsSection />}
          {section === "voice" && <VoiceSection />}
          {section === "notifications" && <NotificationsSection />}
          {section === "plan" && <PlanSection />}
        </div>
      </div>
    </div>
  );
}

// ── Sections ──────────────────────────────────────────────────────────────

function SiteSection() {
  const { toast } = useStore();
  return (
    <>
      <Card className="flex flex-col gap-4">
        <CardHead title="Site" hint="One site per company. Everything else hangs off it." />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company name"><input id="set-name" className={inputClass} defaultValue={D.site.name} /></Field>
          <Field label="Blog address"><input id="set-host" className={inputClass} defaultValue={D.site.blogUrl} /></Field>
          <Field label="Time zone" hint="Sweeps and quarters follow it.">
            <select id="set-tz" className={inputClass} defaultValue="Europe/Berlin">
              <option>Europe/Berlin</option>
              <option>Europe/London</option>
              <option>America/New_York</option>
            </select>
          </Field>
          <Field label="Quarters start in" hint="Coverage resets each quarter.">
            <select id="set-fy" className={inputClass} defaultValue="January">
              <option>January</option>
              <option>April</option>
              <option>July</option>
              <option>October</option>
            </select>
          </Field>
          <Field label="Content language"><select id="set-lang" className={inputClass} defaultValue="English"><option>English</option><option>French</option><option>German</option></select></Field>
        </div>
      </Card>
      <Card className="flex flex-col gap-3">
        <CardHead title="Delete this site" hint="Removes its content records, flags, briefs and knowledge base. Published posts stay where they are." />
        <Button kind="danger" size="sm" className="self-start" onClick={() => toast("Not in the prototype")}>Delete {D.site.name}</Button>
      </Card>
    </>
  );
}

function PeopleSection() {
  const { s, toast } = useStore();
  const [owners, setOwners] = useState<Record<string, string>>({ close: "Maya Okafor", ap: "Maya Okafor", controls: "Lina Haddad", erp: "Tomás Reyes", pricing: "Ghaith Ayadi" });
  const [domain, setDomain] = useState(true);
  return (
    <>
      <Card className="flex flex-col gap-4">
        <CardHead title="People" hint="One type of user: everyone can do and see everything." right={<Button size="sm" kind="primary" iconLeading={<Plus className="size-3.5" />} onClick={() => toast("Invite sent")}>Invite</Button>} />
        <ul className="divide-y divide-[var(--color-border-secondary)] overflow-hidden rounded-xl border border-secondary">
          {D.team.map((t) => (
            <li key={t.email} className="flex items-center gap-3 bg-primary px-4 py-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-medium text-secondary">{t.initials}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-primary">{t.name}</span>
                <span className="block truncate text-xs text-tertiary">{t.email}</span>
              </span>
              <span className="hidden shrink-0 text-xs text-quaternary sm:block">{t.lastSeen}</span>
              <Button size="sm" kind="ghost" onClick={() => toast("Removed")}>Remove</Button>
            </li>
          ))}
          {D.pendingInvites.map((e) => (
            <li key={e} className="flex items-center gap-3 bg-secondary px-4 py-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-xs text-quaternary ring-1 ring-inset ring-secondary">?</span>
              <span className="min-w-0 flex-1 truncate text-sm text-tertiary">{e}</span>
              <Pill tone="warn">Invited</Pill>
              <Button size="sm" kind="ghost" onClick={() => toast("Invite resent")}>Resend</Button>
            </li>
          ))}
        </ul>
        <Row title="Anyone with an @ledgerline.io address can join" desc="They sign in with Google or a code and land in this site." right={<Toggle on={domain} onChange={setDomain} label="Domain sign-up" />} />
      </Card>

      <Card className="flex flex-col gap-4">
        <CardHead title="Topic owners" hint="When the Guardian sends a change of position up, the owner of the topic decides. Their word is final." />
        <div className="flex flex-col gap-2">
          {[...s.topics.map((t) => t.id), "pricing"].map((id) => (
            <div key={id} className="flex flex-wrap items-center gap-3 rounded-xl border border-secondary px-4 py-2.5">
              <span className="min-w-0 flex-1 text-sm text-primary">{topicName(id)}</span>
              <select
                id={`owner-${id}`}
                value={owners[id]}
                onChange={(e) => setOwners((o) => ({ ...o, [id]: e.target.value }))}
                className={cx(inputClass, "w-48 py-1.5")}
              >
                {D.team.map((t) => <option key={t.email}>{t.name}</option>)}
              </select>
            </div>
          ))}
        </div>
        <Field label="Can overrule any topic" hint="One person. Used when owners disagree or a topic has no owner.">
          <select id="set-authority" className={cx(inputClass, "max-w-xs")} defaultValue="Ghaith Ayadi">
            {D.team.map((t) => <option key={t.email}>{t.name}</option>)}
          </select>
        </Field>
      </Card>
    </>
  );
}

const WATCHED: Array<{ type: ObjectType; account: string; status: "connected" | "later"; count: number; mode: string }> = [
  { type: "blog", account: "ledgerline.io/blog (Framer)", status: "connected", count: 44, mode: "Read and publish" },
  { type: "newsletter", account: "The Close (Resend)", status: "connected", count: 14, mode: "Read only" },
  { type: "linkedin", account: "Ledgerline company page", status: "later", count: 0, mode: "Read only" },
  { type: "x", account: "@ledgerline", status: "later", count: 0, mode: "Read only" },
];

function ContentSection() {
  const { toast } = useStore();
  const [publish, setPublish] = useState<"draft" | "live">("draft");
  return (
    <>
      <Card className="flex flex-col gap-4">
        <CardHead title="Content we watch" hint="Every piece is checked against the knowledge base. Whether a flag can be fixed depends on the type, not on you." />
        <ul className="flex flex-col gap-2">
          {WATCHED.map((w) => {
            const t = D.objectTypes[w.type];
            return (
              <li key={w.type} className="flex flex-wrap items-center gap-3 rounded-xl border border-secondary px-4 py-3">
                <TypeIcon type={w.type} className="size-5" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-primary">{t.label}</span>
                  <span className="block truncate text-xs text-tertiary">{w.status === "connected" ? `${w.account} · ${w.count} pieces · ${w.mode}` : "After 0.2"}</span>
                </span>
                <Pill tone={t.fixable ? "good" : "neutral"}>{t.fixable ? "Fixable" : "Can't be fixed"}</Pill>
                {w.status === "connected" ? (
                  <Button size="sm" kind="ghost" onClick={() => toast("Reconnected")}>Manage</Button>
                ) : (
                  <Button size="sm" disabled>Connect</Button>
                )}
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-quaternary">
          "Can't be fixed" types still raise flags. They're logged as mistakes and left out of the content grade.
        </p>
      </Card>
      <Card className="flex flex-col gap-4">
        <CardHead title="Publishing to Framer" hint="One way: Propaganda pushes, it never pulls edits back." right={<Pill tone="good">Connected</Pill>} />
        <Field label="When a brief's post is approved">
          <Segmented value={publish} onChange={setPublish} options={[{ value: "draft", label: "Create a Framer draft" }, { value: "live", label: "Publish straight away" }]} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Framer collection"><select id="set-fr-coll" className={inputClass}><option>Blog</option><option>Resources</option></select></Field>
          <Field label="Fixes to live posts" hint="When you apply a fix from a flag.">
            <select id="set-fr-fix" className={inputClass}><option>Push the edit to Framer</option><option>Leave it for me to copy</option></select>
          </Field>
        </div>
      </Card>
    </>
  );
}

function SourcesSection() {
  const { toast } = useStore();
  const [emailDrop, setEmailDrop] = useState(true);
  const [which, setWhich] = useState<"all" | "tagged">("all");
  const address = `drop@${D.site.slug}.propaganda.pub`;
  return (
    <>
      <Card className="flex flex-col gap-4">
        <CardHead title="How documents arrive" hint="Propaganda receives Markdown or text. How it gets here is your choice." />
        <Row
          title="Email forwarding"
          desc={address}
          right={
            <span className="flex items-center gap-2">
              <Button size="sm" kind="ghost" iconLeading={<Copy01 className="size-3.5" />} onClick={() => { navigator.clipboard?.writeText(address).catch(() => {}); toast("Address copied"); }}>Copy</Button>
              <Toggle on={emailDrop} onChange={setEmailDrop} label="Email forwarding" />
            </span>
          }
        />
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            { name: "Gong", desc: "Call recordings, transcribed", on: true },
            { name: "Fireflies", desc: "Meeting notes", on: false },
            { name: "Google Drive", desc: "One folder, watched", on: true },
            { name: "Notion", desc: "Selected pages", on: false },
          ].map((i) => (
            <div key={i.name} className="flex items-center gap-3 rounded-xl border border-secondary px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-primary">{i.name}</span>
                <span className="block text-xs text-tertiary">{i.desc}</span>
              </span>
              {i.on ? <Pill tone="good">Connected</Pill> : <Button size="sm" onClick={() => toast("Not in the prototype")}>Connect</Button>}
            </div>
          ))}
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <CardHead title="Which calls go in" hint="Under 10 cents a call, so the default is all of them." />
        <Segmented value={which} onChange={setWhich} options={[{ value: "all", label: "All calls" }, { value: "tagged", label: "Only tagged calls" }]} />
        {which === "tagged" && (
          <Field label="Tags" hint="Gong call tags that go in.">
            <input id="set-tags" className={inputClass} defaultValue="discovery, demo, churn, renewal" />
          </Field>
        )}
        <p className="text-xs text-tertiary">Transcripts are read from the day you connect. Older calls are never backfilled.</p>
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
              <span className="tnum hidden shrink-0 text-xs text-tertiary sm:block">{x.insights} insights</span>
              <span className="tnum shrink-0 text-xs text-quaternary">{x.date}</span>
              <button type="button" aria-label={`Remove ${x.title}`} onClick={() => toast("Removed, and its claims re-checked")} className="rounded p-1 text-quaternary hover:text-error-primary">
                <Trash01 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

const TIERS_DEFAULT = [
  { name: "Signed documents", desc: "Contracts, pricing sheets, security reports" },
  { name: "A topic owner's word", desc: "Said on the record, in a call or a decision" },
  { name: "Internal documents", desc: "Decks, wikis, specs" },
  { name: "Calls", desc: "What anyone said in a transcript" },
  { name: "Published content", desc: "Our own posts. The weakest evidence." },
];

function KnowledgeSection() {
  const { toast } = useStore();
  const [tiers, setTiers] = useState(TIERS_DEFAULT);
  const [recheck, setRecheck] = useState(true);
  const move = (i: number, by: number) =>
    setTiers((t) => {
      const n = [...t];
      const j = i + by;
      if (j < 0 || j >= n.length) return t;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  return (
    <>
      <Card className="flex flex-col gap-4">
        <CardHead title="Which evidence wins" hint="When two sources disagree, the higher one holds until a topic owner says otherwise." />
        <ol className="flex flex-col gap-1.5">
          {tiers.map((t, i) => (
            <li key={t.name} className="flex items-center gap-3 rounded-xl border border-secondary bg-primary px-3 py-2.5">
              <span className="tnum w-5 shrink-0 text-center text-xs text-quaternary">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-primary">{t.name}</span>
                <span className="block text-xs text-tertiary">{t.desc}</span>
              </span>
              <span className="flex shrink-0 gap-1">
                <Button size="sm" kind="ghost" disabled={i === 0} onClick={() => move(i, -1)}>Up</Button>
                <Button size="sm" kind="ghost" disabled={i === tiers.length - 1} onClick={() => move(i, 1)}>Down</Button>
              </span>
            </li>
          ))}
        </ol>
      </Card>
      <Card className="flex flex-col gap-4">
        <CardHead title="The Guardian" hint="The only thing that writes to the knowledge base." />
        <Field label="How it handles a weak argument">
          <Segmented value="contested" onChange={() => toast("Only this in the prototype")} options={[{ value: "contested", label: "Admit as contested" }, { value: "reject", label: "Reject" }]} />
        </Field>
        <p className="max-w-[70ch] text-xs text-tertiary">
          Contested is the default: the claim goes in, the gap in what you know is recorded, and the knowledge base grade carries the cost until someone settles it.
        </p>
        <Row title="Re-check content when a claim changes" desc="Every piece that relies on the claim is re-read and gets one summary with bulk actions." right={<Toggle on={recheck} onChange={setRecheck} label="Re-check on change" />} />
      </Card>
      <Card className="flex flex-col gap-3">
        <CardHead title="Start over" hint="Rebuilds the knowledge base from your documents and content. Contested and settled history is kept." />
        <Button size="sm" className="self-start" onClick={() => toast("Not in the prototype")}>Rebuild the knowledge base</Button>
      </Card>
    </>
  );
}

function GoalsSection() {
  const { s } = useStore();
  const [perfMode, setPerfMode] = useState<"growth" | "numbers">(D.performance.mode);
  const [internal, setInternal] = useState(D.coverage.internal.goal);
  const [external, setExternal] = useState(D.coverage.external.goal);
  return (
    <>
      <Card className="flex flex-col gap-4">
        <CardHead title="Consistency" hint="On for every site. Two grades, same cut-offs." right={<Pill tone="good">Always on</Pill>} />
        <div className="overflow-x-auto rounded-xl border border-secondary">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary text-left text-xs text-quaternary">
                <th className="px-4 py-2 font-semibold uppercase tracking-wider">Grade</th>
                <th className="px-4 py-2 font-semibold uppercase tracking-wider">Clean share</th>
              </tr>
            </thead>
            <tbody className="tnum">
              {D.gradeCutoffs.map(([g, min], i) => (
                <tr key={g} className="border-t border-secondary">
                  <td className="px-4 py-2 font-title text-base text-primary">{g}</td>
                  <td className="px-4 py-2 text-secondary">{i === D.gradeCutoffs.length - 1 ? `under ${Math.round(D.gradeCutoffs[i - 1][1] * 100)}%` : `${Math.round(min * 100)}% or more`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="flex flex-col gap-1 text-xs text-tertiary">
          <li><strong className="font-medium text-secondary">Content:</strong> pieces with no open flag. "Not worth fixing" still counts against it; types that can't be fixed are left out.</li>
          <li><strong className="font-medium text-secondary">Knowledge base:</strong> claims that are neither contested nor contradicting another claim.</li>
        </ul>
      </Card>

      <Card className="flex flex-col gap-5">
        <CardHead title="Coverage" hint={`Published ÷ goal, per quarter, capped at 100%. ${D.QUARTER}.`} />
        <div className="grid gap-5 sm:grid-cols-2">
          <Slider id="set-internal" label="From your knowledge" hint={`${D.coverage.internal.opportunities} opportunities found so far`} value={internal} onChange={setInternal} />
          <Slider id="set-external" label="From search demand" hint={`${D.coverage.external.opportunities} opportunities found so far`} value={external} onChange={setExternal} />
        </div>
        <div className="flex flex-col gap-3 border-t border-secondary pt-4">
          <div className="flex items-center justify-between gap-3">
            <Eyebrow>Focus topics</Eyebrow>
            <span className="text-xs text-quaternary">Proposed by the strategy agent; yours to overrule</span>
          </div>
          {s.topics.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-3">
              <span className="tnum w-5 shrink-0 text-xs text-quaternary">{t.importance}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-primary">{t.name}</span>
              <span className="tnum flex items-center gap-1.5 text-sm">
                <input aria-label={`${t.name} minimum`} defaultValue={t.range[0]} className={cx(inputClass, "w-14 px-2 py-1 text-center")} />
                <span className="text-quaternary">to</span>
                <input aria-label={`${t.name} maximum`} defaultValue={t.range[1]} className={cx(inputClass, "w-14 px-2 py-1 text-center")} />
                <span className="text-xs text-quaternary">posts</span>
              </span>
            </div>
          ))}
          <Button size="sm" kind="ghost" className="self-start" iconLeading={<Plus className="size-3.5" />}>Add a topic</Button>
        </div>
        <div className="grid gap-4 border-t border-secondary pt-4 sm:grid-cols-2">
          <Field label="Search data" hint="Where external opportunities come from."><select id="set-seo" className={inputClass}><option>DataForSEO, United States, English</option><option>DataForSEO, United Kingdom, English</option></select></Field>
          <Field label="Ignore keywords harder than" hint="Keyword difficulty, 0 to 100."><input id="set-kd" className={cx(inputClass, "tnum")} defaultValue="45" /></Field>
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <CardHead title="Performance" hint="Reported, never promised: Propaganda doesn't promote." right={<Pill tone="neutral">Optional</Pill>} />
        <Segmented value={perfMode} onChange={setPerfMode} options={[{ value: "growth", label: "Growth on last quarter" }, { value: "numbers", label: "Fixed numbers" }]} />
        <div className="grid gap-3 sm:grid-cols-3">
          {D.performance.metrics.map((m) => (
            <Field key={m.key} label={m.label} hint={`Last quarter: ${m.last.toLocaleString()}${m.unit}`}>
              <input id={`set-${m.key}`} className={cx(inputClass, "tnum")} defaultValue={perfMode === "growth" ? "+15%" : String(m.value)} />
            </Field>
          ))}
        </div>
      </Card>
    </>
  );
}

function AgentsSection() {
  const [levels, setLevels] = useState<Record<string, string>>(Object.fromEntries(D.autonomy.map((a) => [a.stage, a.level])));
  const [threshold, setThreshold] = useState(60);
  const [day, setDay] = useState("Monday");
  const perWeek = Math.round(38 * Math.pow(1 - threshold / 100, 0.9) + 2);
  return (
    <>
      <Card className="flex flex-col gap-4">
        <CardHead title="How far the agents go" hint="Each stage on its own. Off means the stage doesn't run at all." />
        <ul className="flex flex-col gap-3">
          {D.autonomy.map((a) => (
            <li key={a.stage} className="flex flex-wrap items-center gap-3">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-primary">{a.stage}</span>
                <span className="block text-xs text-tertiary">{a.desc}</span>
              </span>
              <Segmented value={levels[a.stage]} onChange={(v) => setLevels((l) => ({ ...l, [a.stage]: v }))} options={[{ value: "off", label: "Off" }, { value: "ask", label: "Ask me" }, { value: "auto", label: "On its own" }]} />
            </li>
          ))}
        </ul>
      </Card>

      <Card className="flex flex-col gap-4">
        <CardHead title="Flags" hint="Propaganda never tells you what deserves a flag. This sets how sure it has to be." />
        <Field label={`Raise a flag at ${threshold}% confidence or more`} hint={`About ${perWeek} flags a week at your volume.`}>
          <input id="set-threshold" type="range" min={30} max={95} step={5} value={threshold} onChange={(e) => setThreshold(+e.target.value)} className="w-full accent-[var(--color-bg-brand-solid)]" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Weekly sweep" hint="Re-reads every piece against the knowledge base.">
            <select id="set-sweep" value={day} onChange={(e) => setDay(e.target.value)} className={inputClass}>
              {["Monday", "Wednesday", "Friday", "Never"].map((d) => <option key={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="Check edits as you write" hint="A fast check in the editor, within two seconds.">
            <select id="set-live" className={inputClass}><option>On</option><option>Off</option></select>
          </Field>
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <CardHead title="Pitches" hint="An idea needs a reason to become a pitch. Everything else is dropped or backlogged." />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="An objection becomes a pitch after" hint="Times heard in calls this quarter."><input id="set-obj" className={cx(inputClass, "tnum")} defaultValue="3 calls" /></Field>
          <Field label="A keyword becomes a pitch at" hint="Monthly searches."><input id="set-vol" className={cx(inputClass, "tnum")} defaultValue="500 or more" /></Field>
          <Field label="Most pitches a week" hint="Beyond this they go to the backlog, ranked by your goals."><input id="set-max" className={cx(inputClass, "tnum")} defaultValue="5" /></Field>
          <Field label="Outside the focus topics"><select id="set-outside" className={inputClass}><option>Backlog them</option><option>Pitch them anyway</option><option>Drop them</option></select></Field>
        </div>
      </Card>
    </>
  );
}

function VoiceSection() {
  return (
    <Card className="flex flex-col gap-4">
      <CardHead title="Voice" hint="How the writer agent sounds. This isn't knowledge: it never touches the knowledge base or the grades." />
      <Field label="In a sentence"><input id="set-voice" className={inputClass} defaultValue="A controller explaining something to another controller over coffee." /></Field>
      <Field label="Always"><textarea id="set-always" rows={3} className={cx(inputClass, "resize-y")} defaultValue={"Short sentences. Real numbers.\nSay 'month end', not 'period close'."} /></Field>
      <Field label="Never"><textarea id="set-never" rows={3} className={cx(inputClass, "resize-y")} defaultValue={"Exclamation marks. 'Seamless'. 'Game-changing'.\nQuotes from customers in public content."} /></Field>
      <Field label="Posts to imitate" hint="The writer reads these before every draft.">
        <div className="flex flex-wrap gap-1.5">
          {D.objects.filter((o) => o.type === "blog").slice(0, 3).map((o) => (
            <Pill key={o.id}>
              <TypeIcon type="blog" className="size-3" />
              {o.title}
            </Pill>
          ))}
        </div>
      </Field>
    </Card>
  );
}

function NotificationsSection() {
  const [digest, setDigest] = useState<"daily" | "weekly" | "off">("daily");
  const [prefs, setPrefs] = useState({ owner: true, guardian: true, pitches: false, review: true, slack: true });
  const set = (k: keyof typeof prefs) => (v: boolean) => setPrefs((p) => ({ ...p, [k]: v }));
  return (
    <Card className="flex flex-col gap-4">
      <CardHead title="Notifications" hint="Yours only. Everyone else sets their own." />
      <Field label="Inbox digest by email">
        <Segmented value={digest} onChange={setDigest} options={[{ value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "off", label: "Off" }]} />
      </Field>
      <div className="flex flex-col gap-2">
        <Row title="A topic you own needs your decision" desc="The Guardian sent up a change of position." right={<Toggle on={prefs.owner} onChange={set("owner")} label="Owner decisions" />} />
        <Row title="The Guardian ruled on your argument" desc="Admitted, contested or rejected." right={<Toggle on={prefs.guardian} onChange={set("guardian")} label="Guardian rulings" />} />
        <Row title="A draft is waiting for your review" desc="Only drafts assigned to you." right={<Toggle on={prefs.review} onChange={set("review")} label="Reviews" />} />
        <Row title="Every new pitch" desc="Otherwise they wait in the digest." right={<Toggle on={prefs.pitches} onChange={set("pitches")} label="Pitches" />} />
        <Row title="Also post to Slack" desc="#content-ops" right={<Toggle on={prefs.slack} onChange={set("slack")} label="Slack" />} />
      </div>
    </Card>
  );
}

function PlanSection() {
  const { toast } = useStore();
  const jobs = [
    { name: "Sweeps", usd: 8.6 },
    { name: "Reading calls and documents", usd: 4.1 },
    { name: "Writing drafts", usd: 2.9 },
    { name: "The Guardian", usd: 1.8 },
  ];
  return (
    <>
      <Card className="flex flex-col gap-4">
        <CardHead title="Plan" hint={D.usage.plan} right={<Pill tone="good">Active</Pill>} />
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="text-secondary">Credits this month</span>
          <span className="tnum text-primary">${D.usage.used.toFixed(2)} of ${D.usage.credits}</span>
        </div>
        <div className="flex h-2 overflow-hidden rounded-full bg-quaternary/60">
          {jobs.map((j, i) => (
            <div key={j.name} className="h-full" style={{ width: `${(j.usd / D.usage.credits) * 100}%`, background: `color-mix(in srgb, var(--color-bg-brand-solid) ${100 - i * 22}%, transparent)` }} />
          ))}
        </div>
        <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {jobs.map((j, i) => (
            <li key={j.name} className="flex items-center gap-2 text-xs">
              <span className="size-2 shrink-0 rounded-sm" style={{ background: `color-mix(in srgb, var(--color-bg-brand-solid) ${100 - i * 22}%, transparent)` }} />
              <span className="min-w-0 flex-1 text-secondary">{j.name}</span>
              <span className="tnum text-primary">${j.usd.toFixed(2)}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-quaternary">Renews {D.usage.renews}. Sweeps are the biggest cost; a less frequent sweep is the knob to turn.</p>
        <div className="flex flex-wrap gap-2 border-t border-secondary pt-4">
          <Button size="sm" onClick={() => toast("Not in the prototype")}>Top up</Button>
          <Button size="sm" kind="ghost" onClick={() => toast("Not in the prototype")}>Change plan</Button>
        </div>
      </Card>
      <Card pad={false}>
        <div className="border-b border-secondary px-4 py-3"><Eyebrow>Invoices</Eyebrow></div>
        <ul className="divide-y divide-[var(--color-border-secondary)]">
          {[["Oct 1, 2026", "$100.00"], ["Sep 1, 2026", "$112.40"], ["Aug 1, 2026", "$100.00"]].map(([d, a]) => (
            <li key={d} className="tnum flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="flex-1 text-secondary">{d}</span>
              <span className="text-primary">{a}</span>
              <Pill tone="good">Paid</Pill>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

// ── Bits ──────────────────────────────────────────────────────────────────

function Row({ title, desc, right }: { title: string; desc: string; right: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-secondary bg-primary px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-primary">{title}</span>
        <span className="block break-words text-xs text-tertiary">{desc}</span>
      </span>
      {right}
    </div>
  );
}

function Slider({ id, label, hint, value, onChange }: { id: string; label: string; hint: string; value: number; onChange: (v: number) => void }) {
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-3">
        <input id={id} type="range" min={0} max={30} value={value} onChange={(e) => onChange(+e.target.value)} className="w-full accent-[var(--color-bg-brand-solid)]" />
        <span className="tnum w-16 shrink-0 text-sm text-primary">{value} posts</span>
      </div>
    </Field>
  );
}
