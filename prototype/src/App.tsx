// The shell: a left rail, a route, and the toast stack. Onboarding runs
// outside the shell because there's no site to be inside yet.

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Briefcase01,
  ChevronDown,
  ChevronRight,
  Home01,
  Inbox01,
  Moon01,
  RefreshCcw01,
  Scales02,
  Settings01,
  Sun,
} from "@untitledui/icons";
import { TypeIcon, cx } from "./bits";
import { StoreProvider, useStore, type Route } from "./store";
import { Onboarding } from "./screens/Onboarding";
import { Home } from "./screens/Home";
import { Inbox } from "./screens/Inbox";
import { Settings } from "./screens/Settings";
import { Knowledge } from "./screens/Content";
import { BlogPage, EmailPage, PostEditor, SalesPage, SocialPage } from "./screens/Writing";
import * as D from "./data";

export default function App() {
  return (
    <StoreProvider>
      <Frame />
    </StoreProvider>
  );
}

const NAV: Array<{ id: Route; label: string; icon: React.ReactNode }> = [
  { id: "home", label: "Home", icon: <Home01 className="size-4" /> },
  { id: "inbox", label: "Inbox", icon: <Inbox01 className="size-4" /> },
  { id: "blog", label: "Blog", icon: <TypeIcon type="blog" /> },
  { id: "social", label: "Social", icon: <TypeIcon type="linkedin" /> },
  { id: "email", label: "Email", icon: <TypeIcon type="newsletter" /> },
  { id: "sales", label: "Sales enablement", icon: <Briefcase01 className="size-4" /> },
  { id: "kb", label: "Knowledge", icon: <Scales02 className="size-4" /> },
  { id: "settings", label: "Settings", icon: <Settings01 className="size-4" /> },
];

const CONTENT: Route[] = ["blog", "social", "email", "sales"];

function Frame() {
  const { route, go, d, s, dispatch, toast } = useStore();
  const [dark, setDark] = useState(false);
  const [blogColl, setBlogColl] = useState("all");
  const [open, setOpen] = useState<Record<string, boolean>>({ blog: true, social: false, email: false });
  const editing = route.startsWith("post-") ? s.objects.find((o) => o.id === route.slice(5)) : undefined;
  const section: Route = editing ? (editing.type === "blog" ? "blog" : editing.type === "newsletter" ? "email" : "social") : route;

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

  return (
    <div className="flex h-full min-h-0 bg-secondary">
      <aside className="hidden w-[232px] shrink-0 flex-col border-r border-secondary bg-secondary md:flex">
        <div className="flex items-center gap-2 px-4 pt-4 pb-3">
          <span className="grid size-7 place-items-center rounded-md bg-brand-solid font-title text-base leading-none text-white">P</span>
          <span className="min-w-0 flex-1 truncate font-title text-base text-primary">{D.site.name}</span>
        </div>
        <nav className="flex flex-col gap-0.5 px-2">
          {NAV.slice(0, 2).map((n) => (
            <NavButton key={n.id} n={n} active={section === n.id} count={n.id === "inbox" ? d.inboxTotal : 0} onClick={() => go(n.id)} />
          ))}
          <div className="px-2.5 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-quaternary">Content</div>
          {NAV.filter((n) => CONTENT.includes(n.id)).map((n) => {
            const kids: Array<{ id: string; label: string; n: number; type?: D.ObjectType }> =
              n.id === "blog"
                ? D.collections.map((c) => ({ id: c.id, label: `${c.emoji} ${c.name}`, n: s.objects.filter((o) => o.group === c.id).length }))
                : n.id === "social"
                  ? D.channels.map((c) => ({ id: c.id, label: c.name, n: s.objects.filter((o) => o.group === c.id).length, type: c.type }))
                  : n.id === "email"
                    ? D.threads.map((t) => ({ id: t.id, label: t.name, n: s.objects.filter((o) => o.group === t.id).length }))
                    : [];
            return (
              <div key={n.id}>
                <div className="flex items-center">
                  <NavButton n={n} active={section === n.id} count={0} onClick={() => { if (n.id === "blog") setBlogColl("all"); go(n.id); }} />
                  {kids.length > 0 && (
                    <button type="button" aria-label={`Show ${n.label}`} onClick={() => setOpen((o) => ({ ...o, [n.id]: !o[n.id] }))} className="-ml-8 rounded p-1 text-quaternary hover:text-secondary">
                      {open[n.id] ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                    </button>
                  )}
                </div>
                {open[n.id] && (
                  <ul className="mb-1 ml-5 flex flex-col border-l border-secondary pl-2">
                    {kids.map((k) => (
                      <li key={k.id}>
                        <button
                          type="button"
                          onClick={() => { if (n.id === "blog") setBlogColl(k.id); go(n.id); }}
                          className={cx("flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition hover:bg-primary_hover", n.id === "blog" && route === "blog" && blogColl === k.id ? "text-primary" : "text-tertiary")}
                        >
                          {k.type && <TypeIcon type={k.type} className="size-3" />}
                          <span className="min-w-0 flex-1 truncate">{k.label}</span>
                          <span className="tnum text-quaternary">{k.n}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          <div className="h-3" />
          {NAV.slice(-2).map((n) => (
            <NavButton key={n.id} n={n} active={section === n.id} count={0} onClick={() => go(n.id)} />
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-1 border-t border-secondary p-2">
          <SmallButton icon={dark ? <Sun className="size-3.5" /> : <Moon01 className="size-3.5" />} label={dark ? "Light" : "Dark"} onClick={() => setDark((v) => !v)} />
          <SmallButton icon={<AlertTriangle className="size-3.5" />} label="Replay onboarding" onClick={() => go("onboarding")} />
          <SmallButton icon={<RefreshCcw01 className="size-3.5" />} label="Reset the dummy data" onClick={() => { dispatch({ type: "reset" }); toast("Back to the first sweep"); }} />
          <div className="px-2 pt-1 text-[11px] text-quaternary">
            Prototype · {s.flags.length} flags, no backend
          </div>
        </div>
      </aside>

      <main id="main" className="min-w-0 flex-1 overflow-y-auto bg-secondary">
        {/* Phone nav */}
        <div className="sticky z-10 flex items-center gap-1 overflow-x-auto border-b border-secondary bg-secondary px-3 py-2 md:hidden" style={{ top: "env(safe-area-inset-top, 0px)" }}>
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => go(n.id)}
              aria-pressed={route === n.id}
              className={cx(
                "shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium transition",
                route === n.id ? "bg-primary text-primary shadow-xs ring-1 ring-inset ring-primary" : "text-tertiary",
              )}
            >
              {n.label}
              {n.id === "inbox" && d.inboxTotal > 0 && <span className="tnum ml-1 text-quaternary">{d.inboxTotal}</span>}
            </button>
          ))}
        </div>

        {route === "home" && <Home />}
        {route === "inbox" && <Inbox />}
        {route === "blog" && <BlogPage key={blogColl} initialCollection={blogColl} />}
        {route === "social" && <SocialPage />}
        {route === "email" && <EmailPage />}
        {route === "sales" && <SalesPage />}
        {editing && <PostEditor key={editing.id} id={editing.id} />}
        {route === "kb" && <Knowledge />}
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
  onClick,
}: {
  n: { label: string; icon: React.ReactNode };
  active: boolean;
  count: number;
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
      {count > 0 && <span className="tnum rounded-full bg-brand-solid px-1.5 text-xs text-white">{count}</span>}
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
