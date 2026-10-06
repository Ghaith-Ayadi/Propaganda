// The shell: a left rail, a route, and the toast stack. Onboarding runs
// outside the shell because there's no site to be inside yet.

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Briefcase01,
  ChevronDown,
  ChevronRight,
  Columns03,
  Dataflow03,
  File06,
  Globe02,
  Home01,
  Inbox01,
  MessageChatCircle,
  Moon01,
  RefreshCcw01,
  Scales02,
  Settings01,
  Sun,
  Target04,
} from "@untitledui/icons";
import { TypeIcon, cx } from "./bits";
import { StoreProvider, useStore, type Route } from "./store";
import { Onboarding } from "./screens/Onboarding";
import { Home } from "./screens/Home";
import { Inbox } from "./screens/Inbox";
import { Settings } from "./screens/Settings";
import { Knowledge } from "./screens/Content";
import { BlogPage, EmailPage, PostEditor, SalesPage, SocialPage } from "./screens/Writing";
import { Pipeline, Review } from "./screens/Pipeline";
import { Chat, Connections, Goals, Site } from "./screens/Workspace";
import * as D from "./data";

export default function App() {
  return (
    <StoreProvider>
      <Frame />
    </StoreProvider>
  );
}

type NavItem = { id: Route; label: string; icon: React.ReactNode };

const TOP: NavItem[] = [
  { id: "home", label: "Home", icon: <Home01 className="size-4" /> },
  { id: "inbox", label: "Inbox", icon: <Inbox01 className="size-4" /> },
  { id: "pipeline", label: "Pipeline", icon: <Columns03 className="size-4" /> },
];
const AFTER: NavItem[] = [
  { id: "kb", label: "Knowledge base", icon: <Scales02 className="size-4" /> },
  { id: "goals", label: "Goals", icon: <Target04 className="size-4" /> },
  { id: "site", label: "Site", icon: <Globe02 className="size-4" /> },
  { id: "chat", label: "Chat", icon: <MessageChatCircle className="size-4" /> },
  { id: "connections", label: "Connections", icon: <Dataflow03 className="size-4" /> },
];
const KINDS: Array<{ id: Route; label: string; icon: React.ReactNode; later?: boolean }> = [
  { id: "blog", label: "Blog", icon: <TypeIcon type="blog" className="size-3.5" /> },
  { id: "social", label: "Social", icon: <TypeIcon type="linkedin" className="size-3.5" />, later: true },
  { id: "email", label: "Email", icon: <TypeIcon type="newsletter" className="size-3.5" />, later: true },
  { id: "sales", label: "Sales enablement", icon: <Briefcase01 className="size-3.5" />, later: true },
];
const CONTENT: Route[] = ["blog", "social", "email", "sales"];

function Frame() {
  const { route, go, d, s, dispatch, toast } = useStore();
  const [dark, setDark] = useState(false);
  const [blogColl, setBlogColl] = useState("all");
  const [tree, setTree] = useState(true);
  const [open, setOpen] = useState<Record<string, boolean>>({ blog: true, social: false, email: false });
  const editing = route.startsWith("post-") ? s.objects.find((o) => o.id === route.slice(5)) : undefined;
  const reviewing = route.startsWith("review-") ? route.slice(7) : undefined;
  const section: Route = editing
    ? editing.status === "published" ? (editing.type === "blog" ? "blog" : editing.type === "newsletter" ? "email" : "social") : "pipeline"
    : reviewing ? "pipeline" : route;
  const inPipeline = s.pitches.filter((p) => p.status === "new").length + s.objects.filter((o) => o.type === "blog" && (o.status === "scheduled" || o.step)).length;

  useEffect(() => {
    document.documentElement.classList.toggle("dark-mode", dark);
  }, [dark]);

  if (route === "onboarding") {
    return (
      <>
        <Onboarding />
        <Toasts />
      </>
    );
  }

  const kidsOf = (id: Route): Array<{ id: string; label: string; n: number; type?: D.ObjectType }> =>
    id === "blog"
      ? D.collections.map((c) => ({ id: c.id, label: c.name, n: s.objects.filter((o) => o.group === c.id && o.status === "published").length }))
      : id === "social"
        ? D.channels.map((c) => ({ id: c.id, label: `${c.type === "x" ? "X" : "LinkedIn"} · ${c.name}`, n: s.objects.filter((o) => o.group === c.id).length, type: c.type }))
        : id === "email"
          ? D.threads.map((t) => ({ id: t.id, label: t.name, n: s.objects.filter((o) => o.group === t.id).length }))
          : [];

  return (
    <div className="flex h-full min-h-0 bg-secondary">
      <aside className="hidden w-[232px] shrink-0 flex-col overflow-y-auto border-r border-secondary bg-secondary md:flex">
        <div className="flex items-center gap-2 px-4 pt-4 pb-3">
          <span className="grid size-7 place-items-center rounded-md bg-brand-solid font-title text-base leading-none text-white">P</span>
          <span className="min-w-0 flex-1 truncate font-title text-base text-primary">{D.site.name}</span>
        </div>
        <nav className="flex flex-col gap-0.5 px-2">
          {TOP.map((n) => (
            <NavButton key={n.id} n={n} active={section === n.id} count={n.id === "inbox" ? d.inboxTotal : n.id === "pipeline" ? inPipeline : 0} quiet={n.id === "pipeline"} onClick={() => go(n.id)} />
          ))}

          <div className="flex items-center">
            <NavButton
              n={{ label: "Content", icon: <File06 className="size-4" /> }}
              active={CONTENT.includes(section) && !tree}
              count={0}
              onClick={() => { setBlogColl("all"); go("blog"); }}
            />
            <button type="button" aria-label={tree ? "Collapse content" : "Expand content"} aria-expanded={tree} onClick={() => setTree((v) => !v)} className="-ml-8 rounded p-1 text-quaternary hover:text-secondary">
              {tree ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            </button>
          </div>
          {tree && (
            <ul className="mb-1 ml-5 flex flex-col border-l border-secondary pl-1.5">
              {KINDS.map((k) => {
                const kids = kidsOf(k.id);
                return (
                  <li key={k.id} className={cx(k.later && "opacity-60")}>
                    <div className="flex items-center">
                      <button
                        type="button"
                        onClick={() => { if (k.id === "blog") setBlogColl("all"); go(k.id); }}
                        aria-current={section === k.id ? "page" : undefined}
                        className={cx(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition hover:bg-primary_hover",
                          kids.length > 0 && "pr-7",
                          section === k.id && (k.id !== "blog" || blogColl === "all") ? "bg-primary font-medium text-primary shadow-xs ring-1 ring-inset ring-primary" : "text-secondary",
                        )}
                      >
                        <span className="text-quaternary">{k.icon}</span>
                        <span className="min-w-0 flex-1 truncate">{k.label}</span>
                        {k.later && <span className="text-[10px] text-quaternary">later</span>}
                      </button>
                      {kids.length > 0 && (
                        <button type="button" aria-label={`Show ${k.label}`} onClick={() => setOpen((o) => ({ ...o, [k.id]: !o[k.id] }))} className="-ml-6 rounded p-1 text-quaternary hover:text-secondary">
                          {open[k.id] ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                        </button>
                      )}
                    </div>
                    {open[k.id] && kids.length > 0 && (
                      <ul className="mb-1 ml-4 flex flex-col">
                        {kids.map((c) => (
                          <li key={c.id}>
                            <button
                              type="button"
                              onClick={() => { if (k.id === "blog") setBlogColl(c.id); go(k.id); }}
                              className={cx(
                                "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition hover:bg-primary_hover",
                                k.id === "blog" && route === "blog" && blogColl === c.id ? "font-medium text-primary" : "text-tertiary",
                              )}
                            >
                              {c.type && <TypeIcon type={c.type} className="size-3" />}
                              <span className="min-w-0 flex-1 truncate">{c.label}</span>
                              <span className="tnum text-quaternary">{c.n}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {AFTER.map((n) => (
            <NavButton key={n.id} n={n} active={section === n.id} count={0} onClick={() => go(n.id)} />
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-1 border-t border-secondary p-2">
          <NavButton n={{ label: "Settings", icon: <Settings01 className="size-4" /> }} active={section === "settings"} count={0} onClick={() => go("settings")} />
          <SmallButton icon={dark ? <Sun className="size-3.5" /> : <Moon01 className="size-3.5" />} label={dark ? "Light" : "Dark"} onClick={() => setDark((v) => !v)} />
          <SmallButton icon={<AlertTriangle className="size-3.5" />} label="Replay onboarding" onClick={() => go("onboarding")} />
          <SmallButton icon={<RefreshCcw01 className="size-3.5" />} label="Reset the dummy data" onClick={() => { dispatch({ type: "reset" }); toast("Back to the first sweep"); }} />
          <div className="px-2 pt-1 text-[11px] text-quaternary">Prototype, example data, no backend. Social, Email and Sales come after 0.2.</div>
        </div>
      </aside>

      <main id="main" className="min-w-0 flex-1 overflow-y-auto bg-secondary">
        {/* Phone nav */}
        <div className="sticky z-10 flex items-center gap-1 overflow-x-auto border-b border-secondary bg-secondary px-3 py-2 md:hidden" style={{ top: "env(safe-area-inset-top, 0px)" }}>
          {[...TOP, { id: "blog" as Route, label: "Content", icon: null }, ...AFTER, { id: "settings" as Route, label: "Settings", icon: null }].map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => go(n.id)}
              aria-pressed={section === n.id}
              className={cx(
                "shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium transition",
                section === n.id ? "bg-primary text-primary shadow-xs ring-1 ring-inset ring-primary" : "text-tertiary",
              )}
            >
              {n.label}
              {n.id === "inbox" && d.inboxTotal > 0 && <span className="tnum ml-1 text-quaternary">{d.inboxTotal}</span>}
            </button>
          ))}
        </div>

        {route === "home" && <Home />}
        {route === "inbox" && <Inbox />}
        {route === "pipeline" && <Pipeline />}
        {route === "blog" && <BlogPage key={blogColl} initialCollection={blogColl} />}
        {route === "social" && <SocialPage />}
        {route === "email" && <EmailPage />}
        {route === "sales" && <SalesPage />}
        {editing && <PostEditor key={editing.id} id={editing.id} />}
        {reviewing && <Review key={reviewing} id={reviewing} />}
        {route === "kb" && <Knowledge />}
        {route === "goals" && <Goals />}
        {route === "site" && <Site />}
        {route === "chat" && <Chat />}
        {route === "connections" && <Connections />}
        {route === "settings" && <Settings />}
      </main>
      <Toasts />
    </div>
  );
}

function NavButton({
  n,
  active,
  count,
  quiet,
  onClick,
}: {
  n: { label: string; icon: React.ReactNode };
  active: boolean;
  count: number;
  quiet?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition",
        active ? "bg-primary text-primary shadow-xs ring-1 ring-inset ring-primary" : "text-tertiary hover:bg-primary_hover hover:text-secondary",
      )}
    >
      <span className={active ? "text-brand-secondary" : "text-quaternary"}>{n.icon}</span>
      <span className="min-w-0 flex-1 truncate text-left">{n.label}</span>
      {count > 0 && <span className={cx("tnum rounded-full px-1.5 text-xs", quiet ? "font-normal text-quaternary" : "bg-brand-solid text-white")}>{count}</span>}
    </button>
  );
}

function SmallButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-tertiary transition hover:bg-primary_hover hover:text-secondary"
    >
      <span className="text-quaternary">{icon}</span>
      {label}
    </button>
  );
}

function Toasts() {
  const { s } = useStore();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
      {s.toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="fade-up max-w-md rounded-lg bg-primary-solid px-3.5 py-2 text-sm text-primary_on-brand shadow-lg"
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
