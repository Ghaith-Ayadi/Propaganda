// Admin > Runs: every agent workflow the worker has run, with its tenant,
// steps, status, errors and cost, and retry or cancel. Mounted by
// lib/admin/sections.tsx as the "runs" section (#/admin/runs). The data comes
// from the worker (lib/admin/runs.ts), which checks the superadmin flag itself.
//
// A run stopped by the Claude subscription's usage limit is "Stalled until
// HH:MM", never a failure: the worker sleeps through it and carries on.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin } from "@/components/admin/AdminContext";
import { RunNow } from "@/components/admin/RunNow";
import {
  cancelRun, getRun, listRuns, retryRun, startDemoRun,
  type Cost, type RunDetail, type RunState, type RunSummary, type StepView,
} from "@/lib/admin/runs";
import { usd } from "@/lib/cost";
import { userMessage } from "@/lib/errors";
import { reportError } from "@/lib/telemetry";

const FILTERS: { id: RunState | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "running", label: "Running" },
  { id: "stalled", label: "Stalled" },
  { id: "queued", label: "Queued" },
  { id: "failed", label: "Failed" },
  { id: "done", label: "Done" },
  { id: "cancelled", label: "Cancelled" },
];

const ACTIVE: RunState[] = ["running", "stalled", "queued"];
const POLL_MS = 5000;

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
  const [filter, setFilter] = useState<RunState | "all">("all");
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [costLog, setCostLog] = useState(true);
  const [sites, setSites] = useState<Map<string, string>>(new Map());
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runNowOpen, setRunNowOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await listRuns(client, { state: filter === "all" ? undefined : filter, limit: 100 });
      setRuns(r.runs);
      setCostLog(r.costLog);
      setError(null);
      // Tenant names: sites are publicly readable.
      const missing = [...new Set(r.runs.map((x) => x.site).filter((s): s is string => !!s))];
      if (missing.length) {
        const { data } = await client.from("sites").select("id,name").in("id", missing);
        if (data) setSites(new Map(data.map((s: { id: string; name: string }) => [s.id, s.name])));
      }
    } catch (err) {
      reportError("RunsPage", err);
      setError(userMessage(err));
    }
  }, [client, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  // Refresh while anything is in flight (and the tab is visible).
  const anyActive = useMemo(() => (runs ?? []).some((r) => ACTIVE.includes(r.state)), [runs]);
  useEffect(() => {
    if (!anyActive) return;
    const t = setInterval(() => document.visibilityState === "visible" && void load(), POLL_MS);
    return () => clearInterval(t);
  }, [anyActive, load]);

  const stalled = useMemo(() => (runs ?? []).filter((r) => r.state === "stalled" && r.stall), [runs]);

  const demo = async (opts: { stallSeconds?: number; fail?: boolean }) => {
    try {
      const { id } = await startDemoRun(client, opts);
      setSelected(id);
      await load();
    } catch (err) {
      reportError("RunsPage.demo", err);
      setError(userMessage(err));
    }
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
          {!runNowOpen && <RunNowButton onOpen={() => setRunNowOpen(true)} />}
          <DemoMenu onStart={demo} />
          <button type="button" onClick={() => void load()} className="rounded-lg border border-secondary px-3 py-1.5 text-secondary hover:bg-secondary">
            Refresh
          </button>
        </div>
      </div>

      {runNowOpen && (
        <RunNow
          onClose={() => setRunNowOpen(false)}
          onStarted={(id) => {
            if (id) setSelected(id);
            void load();
          }}
        />
      )}

      {error && <p className="text-sm text-error-primary">{error}</p>}

      {stalled.length > 0 && (
        <div className="rounded-xl border border-secondary bg-warning-primary px-4 py-3 text-sm text-warning-primary">
          {stalled.length === 1 ? "One run is" : `${stalled.length} runs are`} waiting: for the Claude usage limit to reset, or for a
          tenant's own Anthropic key to work again. {stalled.length === 1 ? "It carries on by itself" : "They carry on by themselves"} from{" "}
          {clock(Math.min(...stalled.map((r) => r.stall!.until)))}.
        </div>
      )}

      {!costLog && runs && runs.length > 0 && (
        <p className="text-xs text-tertiary">The cost log isn't on the server yet, so runs show no cost.</p>
      )}

      {!runs && !error && <p className="text-sm text-tertiary">Loading…</p>}

      {runs && (
        <div className="overflow-x-auto rounded-xl border border-secondary">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary text-left text-[11px] font-semibold uppercase tracking-wide text-quaternary">
                <th className="px-4 py-2">Run</th>
                <th className="px-4 py-2">Tenant</th>
                <th className="px-4 py-2">State</th>
                <th className="px-4 py-2">Started</th>
                <th className="px-4 py-2 text-right">Took</th>
                <th className="px-4 py-2 text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-tertiary">No runs{filter === "all" ? " yet" : " here"}.</td></tr>
              )}
              {runs.map((r) => (
                <RunRow
                  key={r.id}
                  run={r}
                  tenant={r.site ? (sites.get(r.site) ?? r.site) : ""}
                  open={selected === r.id}
                  onToggle={() => setSelected(selected === r.id ? null : r.id)}
                  onChanged={(next) => {
                    if (next) setSelected(next);
                    void load();
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RunRow({
  run, tenant, open, onToggle, onChanged,
}: {
  run: RunSummary;
  tenant: string;
  open: boolean;
  onToggle: () => void;
  onChanged: (selectId?: string) => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        aria-expanded={open}
        className="cursor-pointer border-t border-secondary text-secondary hover:bg-secondary/50 aria-expanded:bg-secondary/50"
      >
        <td className="px-4 py-2">
          <div className="font-medium text-primary">{run.name}</div>
          <div className="font-mono text-[11px] text-quaternary">{run.id.slice(0, 8)}{run.forkedFrom ? " · retry" : ""}</div>
        </td>
        <td className="px-4 py-2">{tenant}</td>
        <td className="px-4 py-2"><StateBadge run={run} /></td>
        <td className="px-4 py-2 whitespace-nowrap">{clock(run.createdAt)}</td>
        <td className="px-4 py-2 text-right tabular-nums">{duration(run.createdAt, run.completedAt)}</td>
        <td className="px-4 py-2 text-right tabular-nums">{costText(run.cost)}</td>
      </tr>
      {open && (
        <tr className="border-t border-secondary">
          <td colSpan={6} className="bg-primary px-4 py-4">
            <RunDetailView id={run.id} summary={run} onChanged={onChanged} />
          </td>
        </tr>
      )}
    </>
  );
}

function RunDetailView({ id, summary, onChanged }: { id: string; summary: RunSummary; onChanged: (selectId?: string) => void }) {
  const { client } = useAdmin();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reload with the list (summary changes on every poll).
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
  }, [client, id, summary.status, summary.updatedAt, summary.stall?.until]);

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

      <ol className="space-y-1">
        {run.steps.length === 0 && <li className="text-sm text-tertiary">No steps yet.</li>}
        {run.steps.map((s) => (
          <StepRow key={s.id} step={s} runError={run.error} />
        ))}
      </ol>
    </div>
  );
}

function StepRow({ step, runError }: { step: StepView; runError: string | null }) {
  const dot: Record<StepView["state"], string> = {
    done: "bg-success-solid",
    failed: "bg-error-solid",
    stalled: "bg-warning-solid",
    running: "bg-brand-solid",
  };
  const note = step.state === "stalled" ? "waiting (usage limit or the tenant's key)" : step.state === "failed" ? "failed" : step.state === "running" ? "running" : "";
  return (
    <li className="text-sm">
      <div className="flex items-center gap-3">
        <span className={`size-2 shrink-0 rounded-full ${dot[step.state]}`} />
        <span className="w-6 shrink-0 text-right font-mono text-[11px] text-quaternary">{step.id}</span>
        <span className="text-primary">{step.name}</span>
        {note && <span className="text-xs text-tertiary">{note}</span>}
        {step.childId && <span className="font-mono text-[11px] text-quaternary">→ {step.childId.slice(0, 8)}</span>}
        <span className="ml-auto tabular-nums text-xs text-tertiary">
          {step.startedAt ? duration(step.startedAt, step.completedAt) : ""}
        </span>
        <span className="w-16 text-right tabular-nums text-xs text-secondary">{costText(step.cost)}</span>
      </div>
      {step.error && step.state === "failed" && step.error !== runError && (
        <pre className="ml-11 mt-1 whitespace-pre-wrap text-xs text-error-primary">{step.error}</pre>
      )}
    </li>
  );
}

function RunNowButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="rounded-lg border border-secondary bg-primary px-3 py-1.5 font-medium text-secondary hover:bg-secondary">
      Run now…
    </button>
  );
}

/** Runs that spend nothing, to check the worker and this page end to end. */
function DemoMenu({ onStart }: { onStart: (o: { stallSeconds?: number; fail?: boolean }) => void }) {
  return (
    <select
      aria-label="Start a demo run"
      value=""
      onChange={(e) => {
        const v = e.target.value;
        e.target.value = "";
        if (v === "ok") onStart({});
        if (v === "stall") onStart({ stallSeconds: 120 });
        if (v === "fail") onStart({ fail: true });
      }}
      className="rounded-lg border border-secondary bg-primary px-2 py-1.5 text-secondary"
    >
      <option value="" disabled>Demo run…</option>
      <option value="ok">Demo: three steps</option>
      <option value="stall">Demo: a 2-minute usage limit</option>
      <option value="fail">Demo: fails at the last step</option>
    </select>
  );
}
