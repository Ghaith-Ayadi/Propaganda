// Admin > Runs: every agent workflow the worker has run, grouped into flows
// (the runs that belong together: the onboarding sequence, a morning's
// batches, one Checker run), each run a bar on the flow's timeline, so the
// steps before and after it show with it, retries and failures included.
// Open a run for its steps, errors and cost, and retry or cancel it. Mounted
// by lib/admin/sections.tsx as the "runs" section (#/admin/runs); Run now sits
// in the page's header (RunNow.tsx). The data comes from the worker
// (lib/admin/runs.ts, worker/src/flows.ts), which checks the superadmin flag itself.
//
// Display hides kinds of flow; crons (the pulls and sweeps) start hidden.
// A run stopped by the Claude subscription's usage limit is "Stalled until
// HH:MM", never a failure: the worker sleeps through it and carries on.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, RefreshCcw01, Sliders01 } from "@untitledui/icons";
import { Button as AriaButton, Dialog, DialogTrigger, Popover as AriaPopover } from "react-aria-components";
import { useAdmin } from "@/components/admin/AdminContext";
import { RUN_STARTED } from "@/components/admin/RunNow";
import { tenantNames } from "@/components/admin/tenantNames";
import { useRoute } from "@/lib/route";
import {
  cancelRun, getRun, listFlows, retryRun,
  type Cost, type Flow, type FlowCategory, type FlowKind, type FlowRun, type RunDetail, type RunState, type RunSummary, type StepView,
} from "@/lib/admin/runs";
import { usd } from "@/lib/cost";
import { userMessage } from "@/lib/errors";
import { reportError } from "@/lib/telemetry";
import { cx } from "@/utils/cx";

type Filter = "all" | "active" | "stalled" | "failed" | "done";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "stalled", label: "Stalled" },
  { id: "failed", label: "With failures" },
  { id: "done", label: "Done" },
];

const ACTIVE: RunState[] = ["running", "stalled", "queued"];
const POLL_MS = 5000;
const PAGE = 30;
/** Rows a flow shows before "Show all". */
const ROWS = 10;

const CATEGORIES: { id: FlowCategory; label: string; hint: string }[] = [
  { id: "agents", label: "Agents", hint: "One agent's run" },
  { id: "flows", label: "Flows", hint: "Runs that follow each other" },
  { id: "crons", label: "Crons", hint: "Pulls and sweeps on a clock" },
];

// What Display hides, per browser: kind ids, or a category's name when all of it is hidden.
const HIDE_KEY = "propaganda.admin.runs.hide";
const DEFAULT_HIDE = ["crons"];

function readHide(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(HIDE_KEY) ?? "null");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : DEFAULT_HIDE;
  } catch {
    return DEFAULT_HIDE;
  }
}

function saveHide(hide: string[]) {
  try {
    localStorage.setItem(HIDE_KEY, JSON.stringify(hide));
  } catch {
    // Private window: the choice lasts this visit.
  }
}

/** The hidden kind ids, category names expanded. */
function hiddenKinds(hide: string[], kinds: FlowKind[]): Set<string> {
  return new Set(hide.flatMap((h) => (CATEGORIES.some((c) => c.id === h) ? kinds.filter((k) => k.category === h).map((k) => k.id) : [h])));
}

/** Back to the short form: a category whose kinds are all hidden is stored by its name. */
function compactHide(hidden: Set<string>, kinds: FlowKind[]): string[] {
  const out: string[] = [];
  for (const c of CATEGORIES) {
    const ks = kinds.filter((k) => k.category === c.id);
    if (ks.length && ks.every((k) => hidden.has(k.id))) out.push(c.id);
    else out.push(...ks.filter((k) => hidden.has(k.id)).map((k) => k.id));
  }
  return out;
}

function matches(f: Flow, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "active") return ACTIVE.includes(f.state);
  if (filter === "failed") return f.failures > 0;
  return f.state === filter;
}

function clock(ms: number): string {
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return sameDay ? time : `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

function duration(from: number, to: number | null): string {
  const s = Math.max(0, Math.round(((to ?? Date.now()) - from) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function costText(c: Cost | null): string {
  if (!c) return "";
  if (c.calls === 0) return "";
  return `${usd(c.usd)}${c.unpriced ? "+" : ""}`;
}

/** When a run stopped (or now, while it goes on). */
function endOf(r: Pick<RunSummary, "state" | "createdAt" | "updatedAt" | "completedAt">, now: number): number {
  if (ACTIVE.includes(r.state)) return now;
  return r.completedAt ?? r.updatedAt ?? r.createdAt;
}

const BAR: Record<RunState, string> = {
  done: "bg-success-solid",
  failed: "bg-error-solid",
  stalled: "bg-warning-solid",
  running: "bg-brand-solid animate-pulse",
  queued: "border border-dashed border-primary",
  cancelled: "bg-quaternary",
};

/** A bar on a timeline from `start` to `end`. */
function Bar({ from, to, start, end, className }: { from: number; to: number; start: number; end: number; className: string }) {
  const span = Math.max(end - start, 1000);
  const left = Math.min(Math.max(((from - start) / span) * 100, 0), 99);
  const width = Math.min(Math.max(((to - from) / span) * 100, 1), 100 - left);
  return <span className={cx("absolute inset-y-0 rounded-sm", className)} style={{ left: `${left}%`, width: `${width}%` }} />;
}

function StateBadge({ run }: { run: Pick<RunSummary, "state" | "stall"> }) {
  const styles: Record<RunState, string> = {
    running: "bg-brand-primary text-brand-secondary",
    stalled: "bg-warning-primary text-warning-primary",
    queued: "bg-tertiary text-tertiary",
    done: "bg-success-primary text-success-primary",
    failed: "bg-error-primary text-error-primary",
    cancelled: "bg-tertiary text-quaternary",
  };
  const label =
    run.state === "stalled" && run.stall
      ? `Stalled until ${clock(run.stall.until)}`
      : run.state[0]!.toUpperCase() + run.state.slice(1);
  return <span className={`inline-block whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ${styles[run.state]}`}>{label}</span>;
}

export function RunsPage() {
  const { client } = useAdmin();
  const [filter, setFilter] = useState<Filter>("all");
  const [hide, setHide] = useState<string[]>(readHide);
  const [pages, setPages] = useState(1);
  const [flows, setFlows] = useState<Flow[] | null>(null);
  const [kinds, setKinds] = useState<FlowKind[]>([]);
  const [more, setMore] = useState(false);
  const [costLog, setCostLog] = useState(true);
  const [sites, setSites] = useState<Map<string, string>>(new Map());
  const [now, setNow] = useState(Date.now());
  // #/admin/runs/<id> (a link from Admin > Failures or a ticket) opens that run.
  const [route] = useRoute();
  const linked = route.view === "admin" ? (route.item ?? null) : null;
  const [selected, setSelected] = useState<string | null>(linked);
  useEffect(() => {
    if (linked) setSelected(linked);
  }, [linked]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await listFlows(client, { hide, limit: Math.min(PAGE * pages, 100) });
      setFlows(r.flows);
      setKinds(r.kinds);
      setMore(r.next !== null && PAGE * pages < 100);
      setCostLog(r.costLog);
      setNow(Date.now());
      setError(null);
      const ids = [...new Set(r.flows.map((f) => f.site).filter((s): s is string => !!s))];
      if (ids.length) setSites(await tenantNames(client, ids));
    } catch (err) {
      reportError("RunsPage", err);
      setError(userMessage(err));
    }
  }, [client, hide, pages]);

  useEffect(() => {
    void load();
  }, [load]);

  // Run now (in the header) started something: open it.
  useEffect(() => {
    const on = (e: Event) => {
      const id = (e as CustomEvent<string | null>).detail;
      if (id) setSelected(id);
      void load();
    };
    window.addEventListener(RUN_STARTED, on);
    return () => window.removeEventListener(RUN_STARTED, on);
  }, [load]);

  // Refresh while anything is in flight (and the tab is visible).
  const anyActive = useMemo(() => (flows ?? []).some((f) => ACTIVE.includes(f.state)), [flows]);
  useEffect(() => {
    if (!anyActive) return;
    const t = setInterval(() => document.visibilityState === "visible" && void load(), POLL_MS);
    return () => clearInterval(t);
  }, [anyActive, load]);

  const stalled = useMemo(() => (flows ?? []).flatMap((f) => f.runs).filter((r) => r.state === "stalled" && r.stall), [flows]);
  const shown = useMemo(() => (flows ?? []).filter((f) => matches(f, filter)), [flows, filter]);
  const hiddenCount = hiddenKinds(hide, kinds).size;

  const changeHide = (next: string[]) => {
    saveHide(next);
    setHide(next);
    setPages(1);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg border border-secondary p-0.5 text-sm">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className="rounded-md px-3 py-1 text-secondary aria-pressed:bg-tertiary aria-pressed:font-medium aria-pressed:text-primary"
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <DisplayMenu kinds={kinds} hide={hide} hiddenCount={hiddenCount} onChange={changeHide} />
          <button type="button" onClick={() => void load()} className="rounded-lg border border-secondary px-3 py-1.5 text-secondary hover:bg-secondary">
            Refresh
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-error-primary">{error}</p>}

      {stalled.length > 0 && (
        <div className="rounded-xl border border-secondary bg-warning-primary px-4 py-3 text-sm text-warning-primary">
          {stalled.length === 1 ? "One run is" : `${stalled.length} runs are`} waiting: for the Claude usage limit to reset, or for a
          tenant's own Anthropic key to work again. {stalled.length === 1 ? "It carries on by itself" : "They carry on by themselves"} from{" "}
          {clock(Math.min(...stalled.map((r) => r.stall!.until)))}.
        </div>
      )}

      {!costLog && flows && flows.length > 0 && (
        <p className="text-xs text-tertiary">The cost log isn't on the server yet, so runs show no cost.</p>
      )}

      {!flows && !error && <p className="text-sm text-tertiary">Loading…</p>}

      {flows && selected && !flows.some((f) => f.runs.some((r) => r.id === selected)) && (
        <div className="rounded-xl border border-secondary px-4 py-4">
          <RunDetailView id={selected} onChanged={(next) => { if (next) setSelected(next); void load(); }} />
        </div>
      )}

      {flows && shown.length === 0 && (
        <p className="rounded-xl border border-secondary px-4 py-8 text-center text-sm text-tertiary">
          No runs{filter === "all" ? " yet" : " here"}{hiddenCount ? `, with ${hiddenCount} kind${hiddenCount === 1 ? "" : "s"} hidden in Display` : ""}.
        </p>
      )}

      {shown.map((f) => (
        <FlowCard
          key={f.id}
          flow={f}
          tenant={f.site ? (sites.get(f.site) ?? f.site) : ""}
          now={now}
          openRun={selected}
          onOpenRun={(id) => setSelected(selected === id ? null : id)}
          onChanged={(next) => {
            if (next) setSelected(next);
            void load();
          }}
        />
      ))}

      {flows && more && (
        <div className="text-center">
          <button type="button" onClick={() => setPages((p) => p + 1)} className="rounded-lg border border-secondary px-3 py-1.5 text-sm text-secondary hover:bg-secondary">
            Show older runs
          </button>
        </div>
      )}
    </div>
  );
}

function FlowCard({
  flow, tenant, now, openRun, onOpenRun, onChanged,
}: {
  flow: Flow;
  tenant: string;
  now: number;
  openRun: string | null;
  onOpenRun: (id: string) => void;
  onChanged: (selectId?: string) => void;
}) {
  const [all, setAll] = useState(false);
  const start = flow.startedAt;
  const end = flow.endedAt ?? now;
  const live = flow.endedAt === null;
  const stall = flow.runs.find((r) => r.state === "stalled")?.stall ?? null;
  // The open run always shows, even past the first rows.
  const openAt = flow.runs.findIndex((r) => r.id === openRun);
  const rows = all || flow.runs.length <= ROWS ? flow.runs : flow.runs.slice(0, Math.max(ROWS, openAt + 1));

  const single = flow.runs.length === 1;
  const head = (
    <>
      <span className="font-medium text-primary">{flow.label}</span>
      {tenant && <span className="text-sm text-tertiary">{tenant}</span>}
      <StateBadge run={{ state: flow.state, stall }} />
      {flow.retries > 0 && <span className="text-xs text-warning-primary">{flow.retries === 1 ? "1 retry" : `${flow.retries} retries`}</span>}
      {flow.restarts > 0 && <span className="text-xs text-tertiary">{flow.restarts === 1 ? "1 restart" : `${flow.restarts} restarts`}</span>}
      {flow.failures > 0 && <span className="text-xs text-error-primary">{flow.failures} failed</span>}
      <span className="ml-auto whitespace-nowrap text-xs tabular-nums text-tertiary">
        {clock(start)} · {duration(start, live ? null : end)}
      </span>
      <span className="w-16 text-right text-xs tabular-nums text-secondary">{costText(flow.cost)}</span>
    </>
  );

  // One run: the card is that run, nothing to lay out on a timeline.
  if (single) {
    const r = flow.runs[0]!;
    const open = openRun === r.id;
    return (
      <section className="rounded-xl border border-secondary">
        <button
          type="button"
          onClick={() => onOpenRun(r.id)}
          aria-expanded={open}
          title={`${r.name} · ${r.id}`}
          className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-4 py-3 text-left hover:bg-secondary/50 aria-expanded:rounded-b-none aria-expanded:bg-secondary/50"
        >
          {head}
        </button>
        {r.error && r.state === "failed" && !open && <p className="truncate px-4 pb-3 text-xs text-error-primary">{r.error}</p>}
        {open && (
          <div className="border-t border-secondary px-4 py-4">
            <RunDetailView id={r.id} summary={r} onChanged={onChanged} />
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-secondary">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">{head}</header>
      <ol className="border-t border-secondary py-1">
        <li aria-hidden="true" className="hidden items-center gap-3 px-4 pb-1 pt-1 text-[11px] text-quaternary sm:flex">
          <span className="w-60 shrink-0" />
          <span className="flex flex-1 justify-between whitespace-nowrap tabular-nums">
            <span>{clock(start)}</span>
            <span>{live ? "now" : clock(end)}</span>
          </span>
          <span className="w-32 shrink-0" />
        </li>
        {rows.map((r) => (
          <FlowRow key={r.id} run={r} start={start} end={end} now={now} open={openRun === r.id} onToggle={() => onOpenRun(r.id)} onChanged={onChanged} />
        ))}
        {rows.length < flow.runs.length && (
          <li className="px-4 py-1">
            <button type="button" onClick={() => setAll(true)} className="text-xs text-tertiary hover:text-secondary">
              Show all {flow.runs.length} runs
            </button>
          </li>
        )}
      </ol>
    </section>
  );
}

function FlowRow({
  run, start, end, now, open, onToggle, onChanged,
}: {
  run: FlowRun;
  start: number;
  end: number;
  now: number;
  open: boolean;
  onToggle: () => void;
  onChanged: (selectId?: string) => void;
}) {
  const to = endOf(run, now);
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        title={`${run.name} · ${run.id}`}
        className="flex w-full items-center gap-3 px-4 py-1.5 text-left text-sm hover:bg-secondary/50 aria-expanded:bg-secondary/50"
      >
        <span className="flex w-28 shrink-0 items-center gap-1.5 truncate sm:w-60" style={{ paddingLeft: `${run.depth * 14}px` }}>
          {run.retryOf && <RefreshCcw01 aria-label="Retry" className="size-3 shrink-0 text-warning-primary" />}
          <span className={cx("truncate", run.superseded ? "text-tertiary line-through" : "text-primary")}>
            {run.retryOf ? `Retry: ${run.label}` : run.label}
          </span>
        </span>
        <span className="relative h-3 min-w-12 flex-1 rounded-sm bg-secondary">
          <Bar from={run.createdAt} to={to} start={start} end={end} className={cx(BAR[run.state], run.superseded && "opacity-40")} />
        </span>
        <span className="w-16 shrink-0 text-right text-xs tabular-nums text-tertiary">
          {run.state === "stalled" && run.stall ? `until ${clock(run.stall.until)}` : duration(run.createdAt, ACTIVE.includes(run.state) ? null : to)}
        </span>
        <span className="hidden w-16 shrink-0 text-right text-xs tabular-nums text-secondary sm:block">{costText(run.cost)}</span>
      </button>
      {run.error && run.state === "failed" && !open && (
        <p className="truncate px-4 pb-1 text-xs text-error-primary" style={{ paddingLeft: `${16 + run.depth * 14}px` }}>
          {run.error}
        </p>
      )}
      {open && (
        <div className="border-y border-secondary bg-primary px-4 py-4">
          <RunDetailView id={run.id} summary={run} onChanged={onChanged} />
        </div>
      )}
    </li>
  );
}

/** Display: which kinds of flow the page shows, as chips by category. Crons start hidden. */
function DisplayMenu({ kinds, hide, hiddenCount, onChange }: { kinds: FlowKind[]; hide: string[]; hiddenCount: number; onChange: (hide: string[]) => void }) {
  const hidden = hiddenKinds(hide, kinds);
  const set = (ids: string[], show: boolean) => {
    const next = new Set(hidden);
    for (const id of ids) show ? next.delete(id) : next.add(id);
    onChange(compactHide(next, kinds));
  };
  return (
    <DialogTrigger>
      <AriaButton className="flex items-center gap-1.5 rounded-lg border border-secondary px-3 py-1.5 text-secondary outline-focus-ring hover:bg-secondary focus-visible:outline-2">
        <Sliders01 className="size-4 text-fg-quaternary" />
        Display
        {hiddenCount > 0 && <span className="text-xs text-quaternary">{hiddenCount} hidden</span>}
      </AriaButton>
      <AriaPopover placement="bottom end" offset={6} className="w-96 max-w-[calc(100vw-2rem)] rounded-xl bg-primary shadow-lg ring-1 ring-secondary_alt outline-hidden">
        <Dialog aria-label="Display" className="space-y-4 p-4 outline-hidden">
          {kinds.length === 0 && <p className="text-sm text-tertiary">Loading…</p>}
          {CATEGORIES.map((c) => {
            const ks = kinds.filter((k) => k.category === c.id);
            if (!ks.length) return null;
            const allShown = ks.every((k) => !hidden.has(k.id));
            return (
              <div key={c.id}>
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold text-secondary">
                    {c.label} <span className="font-normal text-quaternary">{c.hint}</span>
                  </span>
                  <button type="button" onClick={() => set(ks.map((k) => k.id), !allShown)} className="text-xs text-tertiary hover:text-secondary">
                    {allShown ? "Hide all" : "Show all"}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {ks.map((k) => {
                    const on = !hidden.has(k.id);
                    return (
                      <button
                        key={k.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => set([k.id], !on)}
                        className={cx(
                          "flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ring-1 transition",
                          on ? "bg-secondary text-primary ring-primary" : "text-quaternary ring-secondary hover:text-tertiary",
                        )}
                      >
                        {on && <Check className="size-3" />}
                        {k.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </Dialog>
      </AriaPopover>
    </DialogTrigger>
  );
}

function RunDetailView({ id, summary, onChanged }: { id: string; summary?: RunSummary; onChanged: (selectId?: string) => void }) {
  const { client } = useAdmin();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reload with the list. A run's status and updatedAt don't change while it
  // works through its steps, so a live run reloads on every poll (each poll
  // hands in a new summary object).
  const live = summary ? ACTIVE.includes(summary.state) : false;
  const liveSummary = live ? summary : null;
  useEffect(() => {
    getRun(client, id).then(
      (r) => {
        setRun(r);
        setError(null);
      },
      (err) => {
        reportError("RunsPage.detail", err);
        setError(userMessage(err));
      },
    );
  }, [client, id, summary?.status, summary?.updatedAt, summary?.stall?.until, liveSummary]);

  const act = async (what: "retry" | "cancel") => {
    setBusy(true);
    try {
      if (what === "retry") {
        const r = await retryRun(client, id);
        onChanged(r.id);
      } else {
        await cancelRun(client, id);
        onChanged();
      }
    } catch (err) {
      reportError(`RunsPage.${what}`, err);
      setError(userMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (error && !run) return <p className="text-sm text-error-primary">{error}</p>;
  if (!run) return <p className="text-sm text-tertiary">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-quaternary">Id</dt>
          <dd className="font-mono text-secondary">{run.id}</dd>
          {run.forkedFrom && (
            <>
              <dt className="text-quaternary">Retry of</dt>
              <dd className="font-mono text-secondary">{run.forkedFrom}</dd>
            </>
          )}
          {run.parentId && (
            <>
              <dt className="text-quaternary">Part of</dt>
              <dd className="font-mono text-secondary">{run.parentId}</dd>
            </>
          )}
          {run.recoveryAttempts > 1 && (
            <>
              <dt className="text-quaternary">Restarts</dt>
              <dd className="text-secondary">{run.recoveryAttempts - 1}</dd>
            </>
          )}
          {run.cost && run.cost.calls > 0 && (
            <>
              <dt className="text-quaternary">Cost</dt>
              <dd className="text-secondary">
                {usd(run.cost.usd)} over {run.cost.calls} model call{run.cost.calls === 1 ? "" : "s"}
                {run.cost.unpriced ? ` (${run.cost.unpriced} with no price on file)` : ""}
              </dd>
            </>
          )}
        </dl>
        <div className="flex gap-2 text-sm">
          {run.retry && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void act("retry")}
              title={run.retry === "fork" ? "A new run that keeps every step before the one that failed" : "Carry on from where it stopped"}
              className="rounded-lg border border-secondary bg-primary px-3 py-1.5 font-medium text-secondary hover:bg-secondary disabled:opacity-50"
            >
              {run.retry === "fork" ? "Retry from the failed step" : "Resume"}
            </button>
          )}
          {run.cancellable && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void act("cancel")}
              className="rounded-lg border border-secondary bg-primary px-3 py-1.5 font-medium text-error-primary hover:bg-secondary disabled:opacity-50"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-error-primary">{error}</p>}
      {run.error && (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-error-primary px-3 py-2 text-xs text-error-primary">{run.error}</pre>
      )}
      {run.state === "stalled" && run.stall && (
        <p className="text-sm text-warning-primary">
          {run.stall.reason === "tenant-key"
            ? `The tenant's own Anthropic key failed at “${run.stall.step}” (${clock(run.stall.since)}): ${run.stall.message ?? ""} Tries again at ${clock(run.stall.until)}; it never falls back to ours.`
            : `Waiting for the Claude usage limit since ${clock(run.stall.since)} (at “${run.stall.step}”). Carries on by itself at ${clock(run.stall.until)}.`}
        </p>
      )}

      <SoftFailures steps={run.steps} />

      <ol className="space-y-1">
        {run.steps.length === 0 && <li className="text-sm text-tertiary">No steps yet.</li>}
        {run.steps.map((s) => (
          <StepRow key={s.id} step={s} runError={run.error} start={run.createdAt} end={endOf(run, Date.now())} />
        ))}
        {run.state === "running" && <NextStep steps={run.steps} since={run.createdAt} />}
      </ol>
    </div>
  );
}

/**
 * DBOS lists a step only once it has finished, so during a long one (a model
 * call writing a draft) the last row is the previous step and the run looks
 * stuck. Say that the next one is under way, and for how long.
 */
function NextStep({ steps, since }: { steps: StepView[]; since: number }) {
  if (steps.some((s) => s.state === "running" || s.state === "stalled")) return null;
  const from = Math.max(since, ...steps.map((s) => s.completedAt ?? 0));
  return (
    <li className="flex items-center gap-3 text-sm">
      <span className="size-2 shrink-0 animate-pulse rounded-full bg-brand-solid" />
      <span className="w-6 shrink-0" />
      <span className="text-tertiary">Working on the next step</span>
      <span className="ml-auto tabular-nums text-xs text-tertiary">{duration(from, null)}</span>
      <span className="w-16" />
    </li>
  );
}

/** Steps that failed without failing the run: how many were tried again, and what the run went on without. */
function SoftFailures({ steps }: { steps: StepView[] }) {
  const retried = steps.filter((s) => s.state === "retried").length;
  const skipped = steps.filter((s) => s.state === "skipped");
  if (!retried && !skipped.length) return null;
  return (
    <p className="text-sm text-warning-primary">
      {retried > 0 && `${retried} failed attempt${retried === 1 ? " was" : "s were"} tried again after a wait. `}
      {skipped.length > 0 && `Carried on without ${skipped.map((s) => `“${s.name}”`).join(", ")}: ${skipped.length === 1 ? "it" : "they"} kept failing (${skipped[0]!.error ?? "no message"}).`}
    </p>
  );
}

function StepRow({ step, runError, start, end }: { step: StepView; runError: string | null; start: number; end: number }) {
  const dot: Record<StepView["state"], string> = {
    done: "bg-success-solid",
    failed: "bg-error-solid",
    stalled: "bg-warning-solid",
    running: "bg-brand-solid",
    retried: "bg-warning-solid",
    skipped: "bg-fg-quaternary",
  };
  const note =
    step.state === "stalled"
      ? "waiting (usage limit or the tenant's key)"
      : step.state === "failed"
        ? "failed"
        : step.state === "running"
          ? "running"
          : step.state === "retried" || step.state === "skipped"
            ? `failed, ${step.note ?? (step.state === "retried" ? "tried again" : "carried on without it")}`
            : "";
  return (
    <li className="text-sm">
      <div className="flex items-center gap-3">
        <span className={`size-2 shrink-0 rounded-full ${dot[step.state]}`} />
        <span className="w-6 shrink-0 text-right font-mono text-[11px] text-quaternary">{step.id}</span>
        <span className="text-primary">{step.name}</span>
        {note && <span className="text-xs text-tertiary">{note}</span>}
        {step.childId && <span className="font-mono text-[11px] text-quaternary">→ {step.childId.slice(0, 8)}</span>}
        <span className="relative ml-auto hidden h-2 w-40 shrink-0 rounded-sm bg-secondary sm:block">
          {step.startedAt && (
            <Bar from={step.startedAt} to={step.completedAt ?? Date.now()} start={start} end={Math.max(end, step.completedAt ?? 0)} className={dot[step.state]} />
          )}
        </span>
        <span className="w-14 shrink-0 text-right tabular-nums text-xs text-tertiary sm:ml-0 ml-auto">
          {step.startedAt ? duration(step.startedAt, step.completedAt) : ""}
        </span>
        <span className="w-16 text-right tabular-nums text-xs text-secondary">{costText(step.cost)}</span>
      </div>
      {step.error && step.state === "failed" && step.error !== runError && (
        <pre className="ml-11 mt-1 whitespace-pre-wrap text-xs text-error-primary">{step.error}</pre>
      )}
      {step.error && (step.state === "retried" || step.state === "skipped") && (
        <pre className="ml-11 mt-1 whitespace-pre-wrap text-xs text-warning-primary">{step.error}</pre>
      )}
    </li>
  );
}

