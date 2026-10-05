// The shell: a left rail, a route, and the toast stack. Onboarding runs
// outside the shell because there's no site to be inside yet.

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Database01,
  Home01,
  Inbox01,
  Moon01,
  RefreshCcw01,
  Scales02,
  Settings01,
  Sun,
} from "@untitledui/icons";
import { Pill, cx } from "./bits";
import { StoreProvider, useStore, type Route } from "./store";
import { Onboarding } from "./screens/Onboarding";
import { Home } from "./screens/Home";
import { Inbox } from "./screens/Inbox";
import { Settings } from "./screens/Settings";
import { Content, Knowledge } from "./screens/Content";
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
  { id: "posts", label: "Content", icon: <Database01 className="size-4" /> },
  { id: "kb", label: "Knowledge", icon: <Scales02 className="size-4" /> },
  { id: "settings", label: "Settings", icon: <Settings01 className="size-4" /> },
];

function Frame() {
  const { route, go, d, s, dispatch, toast } = useStore();
  const [dark, setDark] = useState(false);

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
          {NAV.map((n) => (
            <NavButton key={n.id} n={n} active={route === n.id} count={n.id === "inbox" ? d.inboxTotal : 0} onClick={() => go(n.id)} />
          ))}
        </nav>

        <div className="mt-6 flex flex-col gap-2 px-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-quaternary">Grades</div>
          <div className="flex items-center gap-2">
            <Pill tone={d.content.grade === "A" ? "good" : d.content.grade === "B" ? "info" : d.content.grade === "C" ? "warn" : "bad"}>
              Content {d.content.grade}
            </Pill>
            <Pill tone={d.kb.grade === "A" ? "good" : d.kb.grade === "B" ? "info" : d.kb.grade === "C" ? "warn" : "bad"}>
              KB {d.kb.grade}
            </Pill>
          </div>
        </div>

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
        {route === "posts" && <Content />}
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
        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition",
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
