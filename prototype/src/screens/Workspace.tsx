// Pages that used to be Settings sections and now have their own place in the
// nav: Goals (what every pitch is rated against), Site, Connections (sources,
// AI clients over MCP, outside publishing) and Chat.

import { useState } from "react";
import { ArrowUpRight, Send01 } from "@untitledui/icons";
import { Button, Card, CardHead, Eyebrow, Pill, cx, inputClass } from "../bits";
import { useStore } from "../store";
import * as D from "../data";
import { ContentSection, GoalsSection, SiteSection, SourcesSection } from "./Settings";

function Page({ title, sub, children, right }: { title: string; sub: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-title text-2xl text-primary">{title}</h1>
          <p className="mt-0.5 max-w-[70ch] text-sm text-tertiary">{sub}</p>
        </div>
        {right}
      </header>
      {children}
    </div>
  );
}

// ── Goals ──────────────────────────────────────────────────────────────

export function Goals() {
  const { s } = useStore();
  const blog = s.objects.filter((o) => o.type === "blog");
  const published = blog.filter((o) => o.status === "published");
  const thisWeek = blog.filter((o) => (o.status !== "draft" || o.step === "review") && o.date >= "2026-10-05" && o.date <= "2026-10-11").length;
  return (
    <Page title="Goals" sub={`${D.QUARTER}. What the agent rates every pitch against, and what Home reports on.`}>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="flex flex-col gap-4">
          <CardHead title="Cadence" hint="Blog posts a week, published or scheduled." />
          <div className="flex items-baseline gap-3">
            <span className="tnum font-title text-5xl text-primary">{D.cadence}</span>
            <span className="text-sm text-tertiary">a week · {thisWeek} planned this week</span>
          </div>
          <p className="text-xs text-tertiary">An open slot in the week raises the fit of any pitch that can fill it.</p>
        </Card>
        <Card className="flex flex-col gap-4">
          <CardHead title="Mix" hint="Share of published blog posts by collection. The line is the target." />
          <ul className="flex flex-col gap-2.5">
            {D.collections.map((c) => {
              const share = published.filter((o) => o.group === c.id).length / published.length;
              const target = D.mix[c.id];
              return (
                <li key={c.id} className="grid grid-cols-[minmax(0,130px)_minmax(0,1fr)_auto] items-center gap-3 text-sm">
                  <span className="truncate text-primary">{c.name}</span>
                  <span className="relative h-2 rounded-full bg-secondary">
                    <span className="absolute inset-y-0 left-0 rounded-full bg-brand-solid" style={{ width: `${Math.round(share * 100)}%` }} />
                    <span className="absolute -inset-y-1 w-0.5 rounded bg-[var(--color-fg-primary)]" style={{ left: `${target * 100}%` }} />
                  </span>
                  <span className="tnum text-right text-xs text-tertiary">
                    {Math.round(share * 100)}% / {Math.round(target * 100)}%
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
      <GoalsSection />
    </Page>
  );
}

// ── Site ───────────────────────────────────────────────────────────────

export function Site() {
  const { toast, go } = useStore();
  return (
    <Page title="Site" sub={`${D.site.blogUrl.replace("https://", "")} · today your blog lives on ${D.site.destination}, and Propaganda publishes to it.`}>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="flex flex-col gap-3">
          <CardHead title="Your blog" hint="Theme, domain, navigation, and which collections are shown." right={<Pill>{D.site.destination}</Pill>} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => toast("Not in the prototype")}>
              Open the site
              <ArrowUpRight className="size-3.5" />
            </Button>
            <Button size="sm" kind="ghost" onClick={() => go("connections")}>Publishing settings</Button>
          </div>
        </Card>
        <Card className="flex flex-col gap-3 ring-1 ring-inset ring-brand">
          <CardHead title={`Move it off ${D.site.destination}`} hint="Your blog is hosted elsewhere, so this page is our pitch." />
          <ul className="flex flex-col gap-1.5 text-sm text-secondary">
            <li>Faster pages, on your own domain.</li>
            <li>Posts re-checked the moment a fact changes, and fixed in place.</li>
            <li>No copy-paste between the editor and the CMS.</li>
          </ul>
          <Button kind="primary" size="sm" className="self-start" onClick={() => toast("Not in the prototype")}>Host it on Propaganda</Button>
        </Card>
      </div>
      <SiteSection />
    </Page>
  );
}

// ── Connections ────────────────────────────────────────────────────────

type ConnTab = "sources" | "ai" | "outside";

export function Connections() {
  const { toast } = useStore();
  const [tab, setTab] = useState<ConnTab>("sources");
  const tabs: Array<[ConnTab, string]> = [["sources", "Sources"], ["ai", "AI"], ["outside", "Outside"]];
  return (
    <Page title="Connections" sub={`Everything ${D.site.name} is plugged into.`}>
      <nav className="flex gap-1 overflow-x-auto border-b border-secondary" role="tablist">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cx("-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition", tab === id ? "border-brand-solid text-primary" : "border-transparent text-tertiary hover:text-secondary")}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === "sources" && (
        <>
          <p className="text-sm text-tertiary">Where ideas and facts come in.</p>
          <SourcesSection />
        </>
      )}
      {tab === "ai" && (
        <>
          <p className="max-w-[70ch] text-sm text-tertiary">
            Use the pipeline and the knowledge base from your own AI tools, over MCP. Propaganda runs its own models; you don't bring one.
          </p>
          <Card pad={false} className="divide-y divide-[var(--color-border-secondary)]">
            {[
              ["Claude", "Ask about pitches, check a draft against the knowledge base"],
              ["ChatGPT", "The same, from ChatGPT"],
              ["Cursor and other MCP clients", "Any client that speaks MCP"],
            ].map(([n, d]) => (
              <div key={n} className="flex items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-primary">{n}</span>
                  <span className="block text-xs text-tertiary">{d}</span>
                </span>
                <Button size="sm" onClick={() => toast("Not in the prototype")}>Connect</Button>
              </div>
            ))}
          </Card>
        </>
      )}
      {tab === "outside" && (
        <>
          <p className="text-sm text-tertiary">Where your content lives when it isn't hosted here, and what Propaganda reads and publishes there.</p>
          <ContentSection />
        </>
      )}
    </Page>
  );
}

// ── Chat ───────────────────────────────────────────────────────────────

type Msg = { who: "you" | "agent"; text: string };

const HISTORY: Msg[] = [
  { who: "you", text: "Why is the SOC 2 pitch rated a strong fit?" },
  {
    who: "agent",
    text: "Three reasons. Two open flags come from the same confusion about Type I and Type II, and this piece would replace the flagged post. It's audit season, so it's worth less after November. And 2,400 people a month search for it while we don't rank.",
  },
];

export function Chat() {
  const [msgs, setMsgs] = useState<Msg[]>(HISTORY);
  const [draft, setDraft] = useState("");
  const send = () => {
    if (!draft.trim()) return;
    setMsgs((m) => [...m, { who: "you", text: draft.trim() }, { who: "agent", text: "This is a prototype, so I can't answer for real. In the product I'd answer from the pipeline, the goals and the knowledge base, with links." }]);
    setDraft("");
  };
  return (
    <Page title="Chat" sub={`Ask the agent about anything in ${D.site.name}: pitches, goals, the knowledge base.`}>
      <Card className="flex min-h-[420px] flex-col gap-4">
        <ol className="flex flex-1 flex-col gap-3">
          {msgs.map((m, i) => (
            <li key={i} className={cx("max-w-[75%] rounded-xl px-3.5 py-2.5 text-sm", m.who === "you" ? "self-end bg-brand-solid text-white" : "self-start bg-secondary text-primary")}>
              {m.text}
            </li>
          ))}
        </ol>
        <div className="flex gap-2">
          <input id="chat-input" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Ask something" className={cx(inputClass, "flex-1")} />
          <Button kind="primary" iconLeading={<Send01 className="size-4" />} onClick={send}>Send</Button>
        </div>
      </Card>
      <div className="flex flex-col gap-2">
        <Eyebrow>Try</Eyebrow>
        <div className="flex flex-wrap gap-1.5">
          {["What's blocking the content grade?", "Which collection is furthest from its target?", "What did we say about pricing last quarter?"].map((q) => (
            <button key={q} type="button" onClick={() => setDraft(q)} className="rounded-full px-2.5 py-1 text-xs text-tertiary ring-1 ring-inset ring-primary hover:text-primary">
              {q}
            </button>
          ))}
        </div>
      </div>
    </Page>
  );
}
