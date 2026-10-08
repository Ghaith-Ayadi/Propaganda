// Admin > Consumption: model spend for every tenant at API prices, by tenant,
// job and model, with the budget limits and the global kill switch. Mounted by
// lib/admin/sections.ts as the "consumption" section (#/admin/consumption).
// Every request is a server function that starts with private.require_superadmin().

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin } from "@/components/admin/AdminContext";
import {
  liftKill, loadConsumption, loadDaily, loadLimits, setLimits, usd,
  type ConsumptionRow, type DayCost, type Killswitch, type Limits,
} from "@/lib/cost";
import { reportError } from "@/lib/telemetry";
import { userMessage } from "@/lib/errors";

type Period = "today" | "month" | "30d";

function range(p: Period): [Date, Date] {
  const now = new Date();
  const end = new Date(now.getTime() + 60_000);
  if (p === "today") return [new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())), end];
  if (p === "month") return [new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), end];
  return [new Date(now.getTime() - 30 * 86_400_000), end];
}

export function ConsumptionPage() {
  const { client } = useAdmin();
  const [period, setPeriod] = useState<Period>("month");
  const [rows, setRows] = useState<ConsumptionRow[] | null>(null);
  const [daily, setDaily] = useState<DayCost[]>([]);
  const [limits, setLimitsState] = useState<Limits[]>([]);
  const [kill, setKill] = useState<Killswitch>({ engaged: false, reason: "" });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [from, to] = range(period);
    try {
      const [r, d, l] = await Promise.all([
        loadConsumption(client, from, to),
        loadDaily(client, from, to),
        loadLimits(client),
      ]);
      setRows(r);
      setDaily(d);
      setLimitsState(l.limits);
      setKill(l.kill);
      setError(null);
    } catch (err) {
      reportError("ConsumptionPage", err);
      setError(userMessage(err));
    }
  }, [client, period]);

  useEffect(() => {
    void load();
  }, [load]);

  const total = useMemo(() => (rows ?? []).reduce((a, r) => a + r.costUsd, 0), [rows]);
  const unpriced = useMemo(() => (rows ?? []).reduce((a, r) => a + r.unpriced, 0), [rows]);
  const tenants = useMemo(() => {
    const m = new Map<string, { name: string; usd: number; rows: ConsumptionRow[] }>();
    for (const r of rows ?? []) {
      const t = m.get(r.site) ?? { name: r.siteName, usd: 0, rows: [] };
      t.usd += r.costUsd;
      t.rows.push(r);
      m.set(r.site, t);
    }
    return [...m.entries()].sort((a, b) => b[1].usd - a[1].usd);
  }, [rows]);

  if (error) return <p className="text-sm text-error-primary">{error}</p>;
  if (!rows) return <p className="text-sm text-tertiary">Loading…</p>;

  return (
    <div className="space-y-6">
      {kill.engaged && (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-error bg-error-primary px-4 py-3 text-sm">
          <span className="text-error-primary">
            Kill switch engaged{kill.reason ? `: ${kill.reason}` : ""}. All model calls are refused.
          </span>
          <button
            type="button"
            className="rounded-lg border border-secondary bg-primary px-3 py-1.5 font-medium text-secondary hover:bg-secondary"
            onClick={() => {
              liftKill(client).then(load, (err) => {
                reportError("ConsumptionPage.lift", err);
                setError(userMessage(err));
              });
            }}
          >
            Lift
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-3xl text-primary">{usd(total)}</div>
          <div className="text-xs text-tertiary">at API prices{unpriced > 0 ? ` · ${unpriced} call${unpriced === 1 ? "" : "s"} with no price on file` : ""}</div>
        </div>
        <div className="flex gap-1 rounded-lg border border-secondary p-0.5 text-sm">
          {([["today", "Today"], ["month", "This month"], ["30d", "30 days"]] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={period === id}
              onClick={() => setPeriod(id)}
              className="rounded-md px-3 py-1 text-secondary aria-pressed:bg-tertiary aria-pressed:font-medium aria-pressed:text-primary"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <DailyBars days={daily} />

      <section>
        <h3 className="mb-2 text-sm font-medium text-secondary">By tenant, job and model</h3>
        <div className="overflow-x-auto rounded-xl border border-secondary">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary text-left text-[11px] font-semibold uppercase tracking-wide text-quaternary">
                <th className="px-4 py-2">Tenant / job</th>
                <th className="px-4 py-2">Model</th>
                <th className="px-4 py-2 text-right">Calls</th>
                <th className="px-4 py-2 text-right">Tokens in / out</th>
                <th className="px-4 py-2 text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {tenants.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-tertiary">No model calls in this period.</td></tr>
              )}
              {tenants.map(([site, t]) => (
                <TenantRows key={site} name={t.name} usd={t.usd} rows={t.rows} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Budgets
        limits={limits}
        tenants={tenants.map(([site, t]) => ({ site, name: t.name }))}
        onSave={async (l) => {
          try {
            await setLimits(client, l);
            await load();
          } catch (err) {
            reportError("ConsumptionPage.limits", err);
            setError(userMessage(err));
          }
        }}
      />
    </div>
  );
}

function TenantRows({ name, usd: total, rows }: { name: string; usd: number; rows: ConsumptionRow[] }) {
  return (
    <>
      <tr className="border-t border-secondary bg-secondary/50">
        <td className="px-4 py-2 font-medium text-primary" colSpan={4}>{name}</td>
        <td className="px-4 py-2 text-right font-medium text-primary">{usd(total)}</td>
      </tr>
      {rows.map((r) => (
        <tr key={r.job + r.model} className="border-t border-secondary text-secondary">
          <td className="px-4 py-2 pl-8">{r.job}</td>
          <td className="px-4 py-2">{r.model}{r.unpriced > 0 && <span className="ml-2 text-xs text-warning-primary">unpriced</span>}</td>
          <td className="px-4 py-2 text-right tabular-nums">{r.calls.toLocaleString("en-US")}</td>
          <td className="px-4 py-2 text-right tabular-nums">{r.inputTokens.toLocaleString("en-US")} / {r.outputTokens.toLocaleString("en-US")}</td>
          <td className="px-4 py-2 text-right tabular-nums">{usd(r.costUsd)}</td>
        </tr>
      ))}
    </>
  );
}

function DailyBars({ days }: { days: DayCost[] }) {
  if (days.length === 0) return null;
  const max = Math.max(...days.map((d) => d.costUsd), 0.000001);
  return (
    <div className="flex h-24 items-end gap-1 rounded-xl border border-secondary px-3 pb-2 pt-3" role="img" aria-label="Spend per day">
      {days.map((d) => (
        <div key={d.day} className="flex-1 rounded-t bg-brand-solid" style={{ height: `${Math.max(2, (d.costUsd / max) * 100)}%` }} title={`${d.day}: ${usd(d.costUsd)}`} />
      ))}
    </div>
  );
}

/** Limits are off until set (blank = off). The global daily cap engages the kill switch. */
function Budgets({
  limits, tenants, onSave,
}: {
  limits: Limits[];
  tenants: { site: string; name: string }[];
  onSave: (l: Limits) => Promise<void>;
}) {
  const scopes = [
    { scope: "global", name: "Everyone (daily cap)" },
    ...tenants.map((t) => ({ scope: t.site, name: t.name })),
  ];
  return (
    <section>
      <h3 className="mb-1 text-sm font-medium text-secondary">Limits</h3>
      <p className="mb-2 text-xs text-tertiary">
        Blank means no limit. A tenant warns at 80% of its monthly budget and loses background work at 100%; the editor keeps working.
        Reaching the global daily cap engages the kill switch, which only a superadmin can lift.
      </p>
      <div className="overflow-hidden rounded-xl border border-secondary">
        {scopes.map(({ scope, name }) => (
          <LimitRow key={scope} scope={scope} name={name} current={limits.find((l) => l.scope === scope)} onSave={onSave} />
        ))}
      </div>
    </section>
  );
}

function LimitRow({
  scope, name, current, onSave,
}: { scope: string; name: string; current?: Limits; onSave: (l: Limits) => Promise<void> }) {
  const isGlobal = scope === "global";
  const [value, setValue] = useState(String((isGlobal ? current?.dailyUsd : current?.monthlyUsd) ?? ""));
  useEffect(() => setValue(String((isGlobal ? current?.dailyUsd : current?.monthlyUsd) ?? "")), [current, isGlobal]);

  const save = () => {
    const n = value.trim() === "" ? null : Number(value);
    if (n !== null && !(n > 0)) return;
    void onSave({
      scope,
      monthlyUsd: isGlobal ? current?.monthlyUsd ?? null : n,
      dailyUsd: isGlobal ? n : current?.dailyUsd ?? null,
      warnRatio: current?.warnRatio ?? 0.8,
    });
  };

  return (
    <div className="flex items-center justify-between gap-4 border-t border-secondary px-4 py-2 first:border-t-0">
      <span className="text-sm text-primary">{name}</span>
      <label className="flex items-center gap-2 text-sm text-tertiary">
        {isGlobal ? "Per day $" : "Per month $"}
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget.blur())}
          placeholder="off"
          className="w-24 rounded-lg border border-secondary bg-primary px-2 py-1 text-right text-primary"
        />
      </label>
    </div>
  );
}
