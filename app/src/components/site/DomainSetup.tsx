// Custom domain setup: type the address, add two records at your DNS
// provider, watch the check turn green. Written for someone who has never
// touched DNS (Kontra's setup is the test). The rules live in api/domains.ts;
// the calls and the polling hook in ./domains.ts.

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle, Copy01, LinkExternal01, RefreshCw01 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { NativeSelect } from "@/components/base/select/select-native";
import { toast } from "@/components/base/toast/toast";
import { useWorkspace } from "@/components/Workspace";
import { setSetting, useSetting } from "@/lib/settings";
import { siteHost, PLATFORM_DOMAIN } from "@/lib/siteUrl";
import { userMessage } from "@/lib/errors";
import { reportError, track } from "@/lib/telemetry";
import { cx } from "@/utils/cx";
import {
  PENDING_DOMAIN_KEY,
  dnsReady,
  isLive,
  looksLikeApex,
  normalizeDomain,
  removeDomain,
  useDomainCheck,
  type DomainRecord,
  type DomainStatus,
} from "./domains";
import { DNS_GUIDES, fillStep, guideFor } from "./dnsGuides";

export function DomainSetup({ compact = false }: { compact?: boolean }) {
  const { site, refreshSite } = useWorkspace();
  const pending = useSetting<string>(PENDING_DOMAIN_KEY, "") ?? "";
  const isOwner = site.role === "owner";
  // The domain on screen: the one being set up, else the one connected.
  const domain = pending || site.domain;

  const check = useDomainCheck(site.id, domain, {
    autoConnect: isOwner,
    onConnected: (s) => {
      track("domain_connected", { apex: s.apex, provider: s.provider || "unknown" });
      refreshSite({ ...site, domain: s.domain });
    },
  });

  // Connected and served: the setup is over, the pending key goes.
  useEffect(() => {
    if (pending && isLive(check.status) && check.status?.domain === pending) void setSetting(PENDING_DOMAIN_KEY, "");
  }, [pending, check.status]);

  if (!domain) return isOwner ? <DomainForm /> : <p className="text-sm text-tertiary">No custom domain yet. The site's owner can add one here.</p>;

  return <DomainProgress domain={domain} check={check} compact={compact} canEdit={isOwner} />;
}

/** Step 0: which address. */
function DomainForm({ initial = "" }: { initial?: string }) {
  const { site } = useWorkspace();
  const [value, setValue] = useState(initial);
  const host = normalizeDomain(value);
  const typed = value.trim().length > 0;
  const onPlatform = /propaganda\.pub\/?$/i.test(value.trim());

  function start() {
    if (!host) return;
    track("domain_setup_started", { apex: looksLikeApex(host) });
    void setSetting(PENDING_DOMAIN_KEY, host);
  }

  const hint = !typed
    ? `A subdomain like blog.${exampleDomain(site.name)} is the easiest: one record and you're done.`
    : onPlatform
      ? `That's already your Propaganda address. Use a domain you own.`
      : !host
        ? "That doesn't look like a domain name. Try something like blog.yourcompany.com."
        : looksLikeApex(host)
          ? `${host} is a root domain. It works, but if your website lives there today, use a subdomain such as blog.${host}.`
          : `Your blog will live at https://${host}.`;

  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-start"
      onSubmit={(e) => {
        e.preventDefault();
        start();
      }}
    >
      <div className="min-w-0 flex-1">
        <Input
          aria-label="Your domain"
          placeholder={`blog.${exampleDomain(site.name)}`}
          value={value}
          onChange={setValue}
          hint={hint}
          isInvalid={typed && !host}
        />
      </div>
      <Button type="submit" color="primary" size="md" isDisabled={!host}>
        Continue
      </Button>
    </form>
  );
}

type Check = ReturnType<typeof useDomainCheck>;

function DomainProgress({ domain, check, compact, canEdit }: { domain: string; check: Check; compact: boolean; canEdit: boolean }) {
  const { site, refreshSite } = useWorkspace();
  const { status, error } = check;
  const [removing, setRemoving] = useState(false);
  const live = isLive(status);
  const connected = site.domain === domain;

  async function startOver() {
    // Only the pending setup: a connected domain is removed below.
    await setSetting(PENDING_DOMAIN_KEY, "");
  }

  async function remove() {
    setRemoving(true);
    try {
      await removeDomain(site.id);
      await setSetting(PENDING_DOMAIN_KEY, "");
      refreshSite({ ...site, domain: "" });
      toast.add({ type: "success", title: `Back to ${siteHost({ slug: site.slug, domain: "" })}` });
    } catch (err) {
      reportError("Domain not removed", err);
      toast.add({ type: "error", title: "Domain not removed", description: userMessage(err) });
    } finally {
      setRemoving(false);
    }
  }

  if (live) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3 rounded-xl bg-success-primary p-4 ring-1 ring-secondary ring-inset">
          <CheckCircle className="mt-0.5 size-5 shrink-0 text-fg-success-primary" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-primary">{domain} is live</p>
            <p className="mt-0.5 text-sm text-tertiary">
              DNS is right and the certificate is issued. {site.slug}.{PLATFORM_DOMAIN} now forwards here.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button color="secondary" size="sm" href={`https://${domain}/`} target="_blank" iconTrailing={LinkExternal01}>
            Open {domain}
          </Button>
          {canEdit && connected && (
            <Button color="tertiary-destructive" size="sm" isDisabled={removing} onClick={() => void remove()}>
              {removing ? "Removing…" : "Remove domain"}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-secondary">
          Setting up <span className="font-semibold text-primary">{domain}</span>
        </p>
        {canEdit && !connected && (
          <Button color="link-gray" size="sm" onClick={() => void startOver()}>
            Use a different domain
          </Button>
        )}
      </div>

      {error && !status ? (
        <div className="flex items-start gap-3 rounded-xl bg-warning-primary p-4 ring-1 ring-secondary ring-inset">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-fg-warning-primary" />
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-primary">The check couldn't run</p>
            <p className="mt-0.5 text-tertiary">{userMessage(error)}</p>
            <Button className="mt-2" color="link-color" size="sm" onClick={check.recheck}>
              Try again
            </Button>
          </div>
        </div>
      ) : !status ? (
        <p className="text-sm text-tertiary">Looking up {domain}…</p>
      ) : (
        <>
          <Step n={1} title="Add these records" done={dnsReady(status)}>
            <RecordsAndGuide status={status} compact={compact} />
          </Step>
          <Step n={2} title="We check every few seconds" done={dnsReady(status)}>
            <ChecksList status={status} check={check} />
          </Step>
          <Step n={3} title="Connect and secure" done={false} last>
            <ConnectLine status={status} canEdit={canEdit} />
          </Step>
        </>
      )}
    </div>
  );
}

function Step({ n, title, done, last, children }: { n: number; title: string; done: boolean; last?: boolean; children: React.ReactNode }) {
  return (
    <section className="relative flex gap-4">
      <div className="flex flex-col items-center">
        <span
          className={cx(
            "grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold ring-1 ring-inset",
            done ? "bg-success-solid text-white ring-transparent" : "bg-primary text-secondary ring-primary",
          )}
        >
          {done ? "✓" : n}
        </span>
        {!last && <span className="mt-1 w-px flex-1 bg-border-secondary" />}
      </div>
      <div className={cx("min-w-0 flex-1", !last && "pb-2")}>
        <h4 className="text-sm font-semibold text-primary">{title}</h4>
        <div className="mt-2">{children}</div>
      </div>
    </section>
  );
}

function RecordsAndGuide({ status, compact }: { status: DomainStatus; compact: boolean }) {
  const [provider, setProvider] = useState(status.provider || "other");
  useEffect(() => {
    if (status.provider) setProvider(status.provider);
  }, [status.provider]);
  const guide = guideFor(provider);
  const nameOf = (r: DomainRecord) => (guide.fullName ? (r.name === "@" ? status.zone : `${r.name}.${status.zone}`) : r.name);
  const point = status.records.find((r) => r.role === "point")!;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-tertiary">
        {status.provider
          ? `${status.zone}'s DNS is at ${guide.label}. Add these two records there.`
          : `Add these two records wherever ${status.zone}'s DNS is managed.`}{" "}
        The first sends readers to your blog, the second proves the domain is yours.
      </p>

      {/* Phones: one card per record; the table needs the width. */}
      <div className="flex flex-col gap-2 sm:hidden">
        {status.records.map((r) => (
          <div key={r.role} className="flex flex-col gap-2 rounded-xl p-3 ring-1 ring-secondary ring-inset">
            <span className="font-mono text-xs font-semibold text-primary">{r.type}</span>
            <div>
              <p className="text-xs text-tertiary">Name</p>
              <CopyValue value={nameOf(r)} />
            </div>
            <div>
              <p className="text-xs text-tertiary">Value</p>
              <CopyValue value={r.value} />
            </div>
          </div>
        ))}
      </div>

      <div className="hidden overflow-hidden rounded-xl ring-1 ring-secondary ring-inset sm:block">
        <table className="w-full table-fixed text-left text-sm">
          <thead className="bg-secondary text-xs text-tertiary">
            <tr>
              <th className="w-20 px-3 py-2 font-medium">Type</th>
              <th className="w-[34%] px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-secondary">
            {status.records.map((r) => (
              <tr key={r.role} className="align-top">
                <td className="px-3 py-2.5 font-mono text-xs text-primary">{r.type}</td>
                <td className="px-3 py-2.5">
                  <CopyValue value={nameOf(r)} />
                </td>
                <td className="px-3 py-2.5">
                  <CopyValue value={r.value} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={cx("rounded-xl bg-secondary p-4", compact && "p-3")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-primary">Step by step</p>
          <NativeSelect
            aria-label="DNS provider"
            size="sm"
            className="w-56"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            options={DNS_GUIDES.map((g) => ({ value: g.id, label: g.label }))}
          />
        </div>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-secondary">
          {guide.steps.map((s, i) => (
            <li key={i}>{fillStep(s, { ...point, name: nameOf(point) })}</li>
          ))}
          <li>Then add the TXT record the same way.</li>
        </ol>
        {guide.note && <p className="mt-3 text-xs text-tertiary">{guide.note}</p>}
        {guide.url && (
          <Button className="mt-3" color="link-color" size="sm" href={guide.url} target="_blank" iconTrailing={LinkExternal01}>
            Open {guide.label}
          </Button>
        )}
      </div>
    </div>
  );
}

function CopyValue({ value }: { value: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(
          () => toast.add({ type: "success", title: "Copied", description: value }),
          () => undefined,
        );
      }}
      className="group flex w-full min-w-0 items-start gap-1.5 rounded-md text-left font-mono text-xs break-all text-primary outline-focus-ring focus-visible:outline-2"
      title="Copy"
    >
      <span className="min-w-0 flex-1">{value}</span>
      <Copy01 className="mt-px size-3.5 shrink-0 text-fg-quaternary group-hover:text-fg-quaternary_hover" />
    </button>
  );
}

function ChecksList({ status, check }: { status: DomainStatus; check: Check }) {
  const [, rerender] = useState(0);
  useEffect(() => {
    const t = setInterval(() => rerender((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const ago = check.lastChecked ? Math.max(0, Math.round((Date.now() - check.lastChecked) / 1000)) : null;

  return (
    <div className="flex flex-col gap-2">
      {status.records.map((r) => (
        <CheckRow key={r.role} state={r.check} label={recordLabel(r)} detail={recordDetail(r, status)} />
      ))}
      {status.proxied && (
        <p className="rounded-lg bg-warning-primary px-3 py-2 text-xs text-warning-primary">
          Cloudflare's proxy is on for {status.domain}. Click the orange cloud next to the record so it turns grey (DNS only).
        </p>
      )}
      {status.taken && (
        <p className="rounded-lg bg-error-primary px-3 py-2 text-xs text-error-primary">
          Another Propaganda site already uses {status.domain}. Write to us if it's yours.
        </p>
      )}
      <div className="flex items-center gap-2 text-xs text-quaternary">
        {check.checking ? <RefreshCw01 className="size-3.5 animate-spin" /> : <RefreshCw01 className="size-3.5" />}
        <span>{check.checking ? "Checking now…" : ago !== null ? `Checked ${ago < 2 ? "just now" : `${ago} seconds ago`}` : ""}</span>
        <Button color="link-gray" size="sm" isDisabled={check.checking} onClick={check.recheck}>
          Check now
        </Button>
      </div>
      {!dnsReady(status) && (
        <p className="text-xs text-tertiary">Most providers apply a new record within a few minutes; some take up to an hour. You can leave this page: the check carries on next time you open it.</p>
      )}
    </div>
  );
}

function recordLabel(r: DomainRecord): string {
  return r.role === "point" ? `${r.type} record: points your domain at Propaganda` : "TXT record: proves it's yours";
}

function recordDetail(r: DomainRecord, s: DomainStatus): string {
  if (r.check === "ok") return "Found.";
  if (r.check === "missing") return "Not found yet.";
  if (r.role === "point") {
    if (s.proxied) return "Found, but behind Cloudflare's proxy.";
    return `Found ${r.found.join(", ")}, expected ${r.value}. Edit that record, or delete it and add ours.`;
  }
  return "Found a TXT record with another value. Copy the value again: it must match exactly.";
}

function CheckRow({ state, label, detail }: { state: "ok" | "missing" | "wrong" | "wait"; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <span
        className={cx(
          "mt-1.5 size-2 shrink-0 rounded-full",
          state === "ok" ? "bg-success-solid" : state === "wrong" ? "bg-warning-solid" : "animate-pulse bg-quaternary",
        )}
      />
      <span className="min-w-0">
        <span className="text-primary">{label}</span> <span className="text-tertiary">{detail}</span>
      </span>
    </div>
  );
}

function ConnectLine({ status, canEdit }: { status: DomainStatus; canEdit: boolean }) {
  if (!dnsReady(status)) {
    return <p className="text-sm text-tertiary">As soon as both records are found, we connect {status.domain} and get its certificate. Nothing to click.</p>;
  }
  if (!status.connected) {
    return (
      <CheckRow
        state="wait"
        label="Connecting…"
        detail={canEdit ? "" : "The site's owner finishes this by opening this page."}
      />
    );
  }
  return (
    <CheckRow
      state="wait"
      label="Getting the certificate."
      detail="This usually takes under a minute. The page turns green on its own."
    />
  );
}

function exampleDomain(siteName: string): string {
  const word = siteName.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 20);
  return `${word || "yourcompany"}.com`;
}

