// Admin > Runs: Run now, the button right of the page's title. Its menu lists
// what a schedule (or the KB dispatcher) would start, by agent, and the demo
// runs. A real run asks for its tenant and a confirm first; a demo spends
// nothing and starts at once. The worker runs the agent's own workflow
// (worker/src/triggers.ts), so cost logging and budgets are the same as a
// scheduled run's. The page hears about a new run through RUN_STARTED and opens it.

import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "@untitledui/icons";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { useAdmin } from "@/components/admin/AdminContext";
import { tenantLabel } from "@/components/admin/tenantNames";
import { Button } from "@/components/base/buttons/button";
import { Dropdown } from "@/components/base/dropdown/dropdown";
import { toast } from "@/components/base/toast/toast";
import { listTriggers, runTrigger, startDemoRun, type Trigger } from "@/lib/admin/runs";
import { userMessage } from "@/lib/errors";
import { reportError } from "@/lib/telemetry";

/** window event: a run just started (detail: its id), for the Runs page to open. */
export const RUN_STARTED = "admin:run-started";

const announce = (id: string | null) => window.dispatchEvent(new CustomEvent(RUN_STARTED, { detail: id }));

type Tenant = { id: string; name: string; slug: string };

const DEMOS: { id: string; label: string; opts: { stallSeconds?: number; fail?: boolean } }[] = [
  { id: "demo:ok", label: "Three steps", opts: {} },
  { id: "demo:stall", label: "A 2-minute usage limit", opts: { stallSeconds: 120 } },
  { id: "demo:fail", label: "Fails at the last step", opts: { fail: true } },
];

export function RunNowMenu() {
  const { client } = useAdmin();
  const [triggers, setTriggers] = useState<Trigger[] | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [picked, setPicked] = useState<Trigger | null>(null);

  useEffect(() => {
    listTriggers(client).then(
      (r) => {
        setTriggers(r.triggers);
        setTenants(r.tenants);
      },
      (err) => {
        reportError("RunNow.load", err);
        setTriggers([]);
        toast.add({ type: "error", title: "Couldn't load what Run now can start", description: userMessage(err) });
      },
    );
  }, [client]);

  const groups = useMemo(() => {
    const out = new Map<string, Trigger[]>();
    for (const t of triggers ?? []) out.set(t.agent, [...(out.get(t.agent) ?? []), t]);
    return [...out];
  }, [triggers]);

  const demo = async (opts: { stallSeconds?: number; fail?: boolean }) => {
    try {
      const { id } = await startDemoRun(client, opts);
      announce(id);
    } catch (err) {
      reportError("RunsPage.demo", err);
      toast.add({ type: "error", title: "The demo didn't start", description: userMessage(err) });
    }
  };

  const onAction = (key: React.Key) => {
    const k = String(key);
    const d = DEMOS.find((x) => x.id === k);
    if (d) return void demo(d.opts);
    const t = triggers?.find((x) => x.id === k);
    if (t) setPicked(t);
  };

  return (
    <>
      <Dropdown.Root>
        <Button size="sm" color="primary" iconTrailing={ChevronDown}>
          Run now
        </Button>
        <Dropdown.Popover placement="bottom end" className="w-80 max-h-[70vh]">
          <Dropdown.Menu onAction={onAction} aria-label="What to run">
            {!triggers && (
              <Dropdown.Section>
                <Dropdown.Item id="loading" label="Loading…" isDisabled />
              </Dropdown.Section>
            )}
            {groups.map(([agent, ts]) => (
              <Dropdown.Section key={agent}>
                <Dropdown.SectionHeader className="px-4 pb-1 pt-2 text-xs font-semibold text-quaternary">{agent}</Dropdown.SectionHeader>
                {ts.map((t) => (
                  <Dropdown.Item key={t.id} id={t.id} label={t.label} addon={t.scope === "all" ? "all tenants" : undefined} />
                ))}
              </Dropdown.Section>
            ))}
            <Dropdown.Section>
              <Dropdown.SectionHeader className="px-4 pb-1 pt-2 text-xs font-semibold text-quaternary">Demo (spends nothing)</Dropdown.SectionHeader>
              {DEMOS.map((d) => (
                <Dropdown.Item key={d.id} id={d.id} label={d.label} />
              ))}
            </Dropdown.Section>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown.Root>
      {picked && <ConfirmRun trigger={picked} tenants={tenants} onClose={() => setPicked(null)} />}
    </>
  );
}

function ConfirmRun({ trigger, tenants, onClose }: { trigger: Trigger; tenants: Tenant[]; onClose: () => void }) {
  const { client } = useAdmin();
  const [site, setSite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const forAll = trigger.scope === "all";
  const tenant = tenants.find((t) => t.id === site);
  const target = forAll ? "every connected tenant" : tenant ? tenantLabel(tenant) : "";

  const fire = async () => {
    setBusy(true);
    try {
      const { runs } = await runTrigger(client, trigger.id, forAll ? null : site);
      toast.add(
        runs.length
          ? { type: "success", title: `${trigger.agent}: ${trigger.label}`, description: `${runs.length === 1 ? "One run" : `${runs.length} runs`} started for ${target}.` }
          : { type: "info", title: "Nothing to start", description: `${trigger.agent} found no work waiting for ${target}.` },
      );
      announce(runs[0] ?? null);
      onClose();
    } catch (err) {
      reportError("RunNow.start", err);
      setError(userMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalOverlay
      isOpen
      isDismissable={!busy}
      onOpenChange={(open) => !open && onClose()}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-overlay/60 p-4 backdrop-blur-sm sm:items-center"
    >
      <Modal className="w-full max-w-md rounded-xl bg-primary shadow-2xl ring-1 ring-secondary outline-hidden">
        <Dialog className="flex flex-col gap-4 p-6 outline-hidden">
          <div>
            <Heading slot="title" className="type-heading text-primary">
              {trigger.agent}: {trigger.label}
            </Heading>
            <p className="mt-1 text-sm text-tertiary">{trigger.detail}</p>
          </div>
          {forAll ? (
            <p className="text-sm text-secondary">One run covers every tenant with this connection.</p>
          ) : (
            <select
              aria-label="Tenant"
              value={site}
              disabled={busy}
              onChange={(e) => setSite(e.target.value)}
              className="rounded-lg border border-secondary bg-primary px-3 py-2 text-sm text-secondary"
            >
              <option value="">Pick a tenant…</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {tenantLabel(t)}
                </option>
              ))}
            </select>
          )}
          <p className="text-sm text-tertiary">It spends like a scheduled run.</p>
          {error && <p className="text-sm text-error-primary">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button size="sm" color="secondary" isDisabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" color="primary" isDisabled={!forAll && !site} isLoading={busy} onClick={() => void fire()}>
              Start the run
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
