// Admin > Failures: every agent run that failed, grouped by fingerprint (the
// workflow, the step and the error with its ids taken out). The worker records
// them and files each group as one ticket (worker/src/failures.ts); this page
// shows where each stands and can file now, or ignore a group so it is never
// filed. Mounted by lib/admin/sections.tsx as "failures" (#/admin/failures,
// #/admin/failures/<fingerprint> opens one group).

import { useCallback, useEffect, useState } from "react";
import { useAdmin } from "@/components/admin/AdminContext";
import { toast } from "@/components/base/toast/toast";
import {
  fileFailure, getFailure, ignoreFailure, listFailures, sweepFailures,
  type FailureGroup, type FailureStatus, type FailureView, type TicketKind,
} from "@/lib/admin/failures";
import { usd } from "@/lib/cost";
import { userMessage } from "@/lib/errors";
import { go, useRoute } from "@/lib/route";
import { reportError } from "@/lib/telemetry";

const FILTERS: { id: FailureStatus | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "new", label: "Not filed" },
  { id: "filed", label: "Filed" },
  { id: "ignored", label: "Ignored" },
];

const SINK_NAMES: Record<TicketKind, string> = { notion: "Notion", github: "GitHub", slack: "Slack" };

function clock(ms: number): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

function StatusBadge({ group }: { group: FailureGroup }) {
  const styles: Record<FailureStatus, string> = {
    new: "bg-error-primary text-error-primary",
    filed: "bg-tertiary text-secondary",
    ignored: "bg-tertiary text-quaternary",
  };
  const label = group.status === "new" ? "Not filed" : group.status === "filed" ? "Filed" : "Ignored";
  return <span className={`inline-block whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ${styles[group.status]}`}>{label}</span>;
}

export function FailuresPage() {
  const { client } = useAdmin();
  const [route] = useRoute();
  const open = route.view === "admin" ? (route.item ?? null) : null;
  const [filter, setFilter] = useState<FailureStatus | "all">("all");
  const [groups, setGroups] = useState<FailureGroup[] | null>(null);
  const [sinks, setSinks] = useState<TicketKind[]>([]);
  const [environment, setEnvironment] = useState("");
  const [sites, setSites] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await listFailures(client, filter === "all" ? undefined : filter);
      setGroups(r.groups);
      setSinks(r.sinks);
      setEnvironment(r.environment);
      setError(null);
      const ids = [...new Set(r.groups.flatMap((g) => g.sites))];
      if (ids.length) {
        const { data } = await client.from("sites").select("id,name").in("id", ids);
        if (data) setSites(new Map(data.map((s: { id: string; name: string }) => [s.id, s.name])));
      }
    } catch (err) {
      reportError("FailuresPage", err);
      setError(userMessage(err));
    }
  }, [client, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    setBusy(true);
    try {
      await sweepFailures(client);
      await load();
    } catch (err) {
      reportError("FailuresPage.sweep", err);
      setError(userMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (fp: string) => go({ view: "admin", section: "failures", item: open === fp ? null : fp });
  const tenants = (g: FailureGroup) => g.sites.map((s) => sites.get(s) ?? s).join(", ");

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
        <button
          type="button"
          disabled={busy}
          onClick={() => void refresh()}
          className="rounded-lg border border-secondary px-3 py-1.5 text-sm text-secondary hover:bg-secondary disabled:opacity-50"
        >
          {busy ? "Checking…" : "Check now"}
        </button>
      </div>

      {groups && (
        <p className="text-xs text-tertiary">
          {sinks.length
            ? `New failures are filed as ${sinks.map((s) => SINK_NAMES[s]).join(" and ")} tickets, one per group, from ${environment}. Repeats are added to the same ticket.`
            : `No ticket destination is set up on ${environment || "this box"}: failures are recorded here and filed once one is.`}
        </p>
      )}

      {error && <p className="text-sm text-error-primary">{error}</p>}
      {!groups && !error && <p className="text-sm text-tertiary">Loading…</p>}

      {groups && (
        <div className="overflow-x-auto rounded-xl border border-secondary">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary text-left text-[11px] font-semibold uppercase tracking-wide text-quaternary">
                <th className="px-4 py-2">Failure</th>
                <th className="px-4 py-2">Tenants</th>
                <th className="px-4 py-2 text-right">Times</th>
                <th className="px-4 py-2">Last</th>
                <th className="px-4 py-2">Ticket</th>
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-tertiary">No failed runs{filter === "all" ? "" : " here"}.</td></tr>
              )}
              {groups.map((g) => (
                <GroupRow
                  key={g.fingerprint}
                  group={g}
                  tenants={tenants(g)}
                  open={open === g.fingerprint}
                  onToggle={() => toggle(g.fingerprint)}
                  canFile={sinks.length > 0}
                  siteName={(id) => sites.get(id) ?? id}
                  onChanged={() => void load()}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function GroupRow({
  group, tenants, open, onToggle, canFile, siteName, onChanged,
}: {
  group: FailureGroup;
  tenants: string;
  open: boolean;
  onToggle: () => void;
  canFile: boolean;
  siteName: (id: string) => string;
  onChanged: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        aria-expanded={open}
        className="cursor-pointer border-t border-secondary align-top text-secondary hover:bg-secondary/50 aria-expanded:bg-secondary/50"
      >
        <td className="px-4 py-2">
          <div className="font-medium text-primary">{group.workflow}{group.step ? ` › ${group.step}` : ""}</div>
          <div className="line-clamp-2 max-w-[520px] text-xs text-tertiary">{group.signature}</div>
        </td>
        <td className="px-4 py-2">{tenants}</td>
        <td className="px-4 py-2 text-right tabular-nums">{group.occurrences}</td>
        <td className="whitespace-nowrap px-4 py-2">{clock(group.lastSeen)}</td>
        <td className="px-4 py-2"><StatusBadge group={group} /></td>
      </tr>
      {open && (
        <tr className="border-t border-secondary">
          <td colSpan={5} className="bg-primary px-4 py-4">
            <GroupDetail fingerprint={group.fingerprint} summary={group} canFile={canFile} siteName={siteName} onChanged={onChanged} />
          </td>
        </tr>
      )}
    </>
  );
}

function GroupDetail({
  fingerprint, summary, canFile, siteName, onChanged,
}: {
  fingerprint: string;
  summary: FailureGroup;
  canFile: boolean;
  siteName: (id: string) => string;
  onChanged: () => void;
}) {
  const { client } = useAdmin();
  const [failures, setFailures] = useState<FailureView[] | null>(null);
  const [report, setReport] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const group = summary;

  useEffect(() => {
    getFailure(client, fingerprint).then(
      (r) => {
        setFailures(r.failures);
        setReport(r.report ?? "");
        setError(null);
      },
      (err) => {
        reportError("FailuresPage.detail", err);
        setError(userMessage(err));
      },
    );
  }, [client, fingerprint, summary.occurrences]);

  const act = async (what: "file" | "ignore" | "unignore") => {
    setBusy(true);
    try {
      if (what === "file") await fileFailure(client, fingerprint);
      else await ignoreFailure(client, fingerprint, what === "ignore");
      onChanged();
    } catch (err) {
      reportError(`FailuresPage.${what}`, err);
      setError(userMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(report);
      toast.add({ type: "success", title: "Report copied", description: "Paste it to Claude to have it fixed." });
    } catch (err) {
      reportError("FailuresPage.copy", err);
    }
  };

  const latest = failures?.[0];
  const cost = (failures ?? []).reduce((s, f) => s + f.cost, 0);
  const unpriced = (failures ?? []).reduce((s, f) => s + f.unpriced, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-quaternary">Seen</dt>
          <dd className="text-secondary">{group.occurrences} time{group.occurrences === 1 ? "" : "s"}, first {clock(group.firstSeen)}, last {clock(group.lastSeen)}</dd>
          <dt className="text-quaternary">Models</dt>
          <dd className="text-secondary">{group.models.join(", ") || "none"}</dd>
          {failures && (
            <>
              <dt className="text-quaternary">Spent</dt>
              <dd className="text-secondary">{usd(cost)}{unpriced ? ` plus ${unpriced} call${unpriced === 1 ? "" : "s"} with no price on file` : ""}</dd>
            </>
          )}
          <dt className="text-quaternary">Fingerprint</dt>
          <dd className="font-mono text-secondary">{group.fingerprint}</dd>
          {group.tickets.length > 0 && (
            <>
              <dt className="text-quaternary">Tickets</dt>
              <dd className="flex flex-wrap gap-3 text-secondary">
                {group.tickets.map((t) =>
                  t.url ? (
                    <a key={t.kind} href={t.url} target="_blank" rel="noreferrer" className="underline hover:text-primary">
                      {SINK_NAMES[t.kind]}{t.kind === "github" ? ` #${t.ref}` : ""}
                    </a>
                  ) : (
                    <span key={t.kind}>{SINK_NAMES[t.kind]}</span>
                  ),
                )}
              </dd>
            </>
          )}
        </dl>
        <div className="flex gap-2 text-sm">
          {report && (
            <button
              type="button"
              onClick={() => void copyReport()}
              title="The bug report written for an agent: error, stack, steps, input and how to reproduce"
              className="rounded-lg border border-secondary bg-primary px-3 py-1.5 font-medium text-secondary hover:bg-secondary"
            >
              Copy report
            </button>
          )}
          {group.status !== "ignored" && canFile && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void act("file")}
              title={group.status === "filed" ? "Add the latest repeats to the ticket now" : "File the bug report now"}
              className="rounded-lg border border-secondary bg-primary px-3 py-1.5 font-medium text-secondary hover:bg-secondary disabled:opacity-50"
            >
              {group.status === "filed" ? "Update ticket" : "File ticket"}
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void act(group.status === "ignored" ? "unignore" : "ignore")}
            title={group.status === "ignored" ? "File it like any other failure" : "Keep recording it, never file it"}
            className="rounded-lg border border-secondary bg-primary px-3 py-1.5 font-medium text-secondary hover:bg-secondary disabled:opacity-50"
          >
            {group.status === "ignored" ? "Stop ignoring" : "Ignore"}
          </button>
        </div>
      </div>

      {group.processError && <p className="text-sm text-warning-primary">Not filed: {group.processError}</p>}
      {error && <p className="text-sm text-error-primary">{error}</p>}

      <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-error-primary px-3 py-2 text-xs text-error-primary">{group.latestError}</pre>
      {latest?.stack && (
        <details className="text-xs">
          <summary className="cursor-pointer text-tertiary">Stack{latest.commit ? ` (commit ${latest.commit.slice(0, 7)})` : ""}</summary>
          <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-secondary px-3 py-2 font-mono text-secondary">{latest.stack}</pre>
        </details>
      )}

      {!failures && !error && <p className="text-sm text-tertiary">Loading…</p>}
      {failures && (
        <ol className="space-y-1 text-sm">
          {failures.map((f) => (
            <li key={f.runId} className="flex flex-wrap items-center gap-3">
              <span className="whitespace-nowrap text-tertiary">{clock(f.failedAt)}</span>
              <a href={`#/admin/runs/${encodeURIComponent(f.runId)}`} className="font-mono text-xs text-secondary underline hover:text-primary">
                {f.runId.slice(0, 8)}
              </a>
              <span className="text-secondary">{f.site ? siteName(f.site) : ""}</span>
              {f.step && <span className="text-xs text-tertiary">at “{f.step}”</span>}
              <span className="ml-auto tabular-nums text-xs text-secondary">{f.calls ? `${usd(f.cost)}${f.unpriced ? "+" : ""}` : ""}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
