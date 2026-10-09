// Admin > Runs: Run now. Starts what a schedule (or the KB dispatcher) would
// start, for a tenant Ayadi picks, for testing. The worker runs the agent's own
// workflow (worker/src/triggers.ts), so cost logging and budgets are the same
// as a scheduled run's, and the new run shows in the list below.

import { useEffect, useMemo, useState } from "react";
import { useAdmin } from "@/components/admin/AdminContext";
import { toast } from "@/components/base/toast/toast";
import { listTriggers, runTrigger, type Trigger } from "@/lib/admin/runs";
import { userMessage } from "@/lib/errors";
import { reportError } from "@/lib/telemetry";

export function RunNow({ onStarted, onClose }: { onStarted: (runId: string | null) => void; onClose: () => void }) {
  const { client } = useAdmin();
  const [triggers, setTriggers] = useState<Trigger[] | null>(null);
  const [tenants, setTenants] = useState<{ id: string; name: string }[]>([]);
  const [triggerId, setTriggerId] = useState("");
  const [site, setSite] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (triggers) return;
    listTriggers(client).then(
      (r) => {
        setTriggers(r.triggers);
        setTenants(r.tenants);
        setTriggerId((id) => id || (r.triggers[0]?.id ?? ""));
        setError(null);
      },
      (err) => {
        reportError("RunNow.load", err);
        setError(userMessage(err));
      },
    );
  }, [triggers, client]);

  const trigger = triggers?.find((t) => t.id === triggerId) ?? null;
  const tenantName = tenants.find((t) => t.id === site)?.name ?? site;
  const groups = useMemo(() => {
    const out = new Map<string, Trigger[]>();
    for (const t of triggers ?? []) out.set(t.agent, [...(out.get(t.agent) ?? []), t]);
    return [...out];
  }, [triggers]);

  const ready = !!trigger && (trigger.scope === "all" || !!site);
  const target = trigger?.scope === "all" ? "every connected tenant" : tenantName;

  const fire = async () => {
    if (!trigger) return;
    setBusy(true);
    try {
      const { runs } = await runTrigger(client, trigger.id, trigger.scope === "tenant" ? site : null);
      toast.add(
        runs.length
          ? { type: "success", title: `${trigger.agent}: ${trigger.label}`, description: `${runs.length === 1 ? "One run" : `${runs.length} runs`} started for ${target}.` }
          : { type: "info", title: "Nothing to start", description: `${trigger.agent} found no work waiting for ${target}.` },
      );
      setConfirming(false);
      onStarted(runs[0] ?? null);
    } catch (err) {
      reportError("RunNow.start", err);
      setError(userMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full rounded-xl border border-secondary bg-primary p-4 text-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-medium text-primary">Run an agent now</h3>
        <button type="button" onClick={onClose} className="text-tertiary hover:text-secondary">
          Close
        </button>
      </div>
      {error && <p className="mb-3 text-error-primary">{error}</p>}
      {!triggers && !error && <p className="text-tertiary">Loading…</p>}
      {triggers && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="What to run"
              value={triggerId}
              disabled={confirming}
              onChange={(e) => setTriggerId(e.target.value)}
              className="rounded-lg border border-secondary bg-primary px-2 py-1.5 text-secondary"
            >
              {groups.map(([agent, ts]) => (
                <optgroup key={agent} label={agent}>
                  {ts.map((t) => (
                    <option key={t.id} value={t.id}>{`${agent}: ${t.label}`}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <select
              aria-label="Tenant"
              value={trigger?.scope === "all" ? "" : site}
              disabled={confirming || trigger?.scope === "all"}
              onChange={(e) => setSite(e.target.value)}
              className="rounded-lg border border-secondary bg-primary px-2 py-1.5 text-secondary disabled:opacity-50"
            >
              <option value="">{trigger?.scope === "all" ? "Every connected tenant" : "Pick a tenant…"}</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>{t.name || t.id}</option>
              ))}
            </select>
            {!confirming && (
              <button
                type="button"
                disabled={!ready}
                onClick={() => setConfirming(true)}
                className="rounded-lg border border-secondary bg-primary px-3 py-1.5 font-medium text-secondary hover:bg-secondary disabled:opacity-50"
              >
                Run…
              </button>
            )}
          </div>
          {trigger && <p className="text-tertiary">{trigger.detail}</p>}
          {confirming && trigger && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-secondary px-3 py-2">
              <span className="text-primary">
                Start “{trigger.agent}: {trigger.label}” for <strong>{target}</strong>? It spends like a scheduled run.
              </span>
              <span className="ml-auto flex gap-2">
                <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="rounded-lg px-3 py-1.5 text-secondary hover:bg-tertiary">
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void fire()}
                  className="rounded-lg bg-primary-solid px-3 py-1.5 font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? "Starting…" : "Start the run"}
                </button>
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
