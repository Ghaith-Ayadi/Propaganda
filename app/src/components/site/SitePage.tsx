// #/site: the tenant's blog. Hosted here: its address, design and custom
// domain. Hosted elsewhere (headless): where it lives, and our pitch for
// moving it. Then the tenant's details and, for the owner, deleting it.
// #/site/domain scrolls to the custom domain.

import { useEffect, useRef } from "react";
import { Brush01, Globe01, LinkExternal01, RefreshCw01 } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { NativeSelect } from "@/components/base/select/select-native";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { useWorkspace } from "@/components/Workspace";
import { DeleteSiteSection, DesignSection, SiteIdentityFields } from "@/components/SettingsDialog";
import { readableUrl, siteHost, sitePublicUrl } from "@/lib/siteUrl";
import { useSetting } from "@/lib/settings";
import { goPage, usePageRest } from "@/lib/route";
import { cx } from "@/utils/cx";
import { DomainSetup } from "./DomainSetup";
import { PENDING_DOMAIN_KEY } from "./domains";
import {
  LANGUAGES,
  PLATFORMS,
  platformLabel,
  setHosting,
  setLanguage,
  setPlatform,
  setPlatformUrl,
  setTimeZone,
  timeZones,
  useDesignName,
  useHosting,
} from "./hosting";

export function SitePage() {
  const { site } = useWorkspace();
  const settings = useHosting();
  const rest = usePageRest();
  const domainRef = useRef<HTMLDivElement>(null);
  const hosted = settings.hosting === "propaganda";
  const where = platformLabel(settings.platform);

  useEffect(() => {
    if (rest === "domain") domainRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [rest]);

  const description = hosted
    ? `${siteHost(site)} · your blog runs on Propaganda.`
    : `${settings.url ? readableUrl(settings.url) : "Your blog"} · today it lives on ${where}, and Propaganda publishes to it.`;

  return (
    <PageBody>
      <PageHeader title="Site" description={description} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-start justify-between gap-3">
            <CardTitle title="Your blog" description="Address, design and the collections it shows." />
            <Badge type="pill-color" size="sm" color={hosted ? "brand" : "gray"}>
              {hosted ? "Propaganda" : where}
            </Badge>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {hosted ? (
              <Button color="secondary" size="sm" href={sitePublicUrl(site)} target="_blank" iconTrailing={LinkExternal01}>
                Open the site
              </Button>
            ) : (
              settings.url && (
                <Button color="secondary" size="sm" href={settings.url} target="_blank" iconTrailing={LinkExternal01}>
                  Open the site
                </Button>
              )
            )}
            <Button color="link-gray" size="sm" onClick={() => goPage("content", "blog")}>
              Collections
            </Button>
          </div>
          {hosted && <DesignSummary />}
          {/* UI assembly (#37): the Design editor stays reachable here until #38 adds Settings > Design. */}
          {hosted && (
            <div className="mt-5 border-t border-secondary pt-4">
              <DesignSection />
            </div>
          )}
        </Card>

        {hosted ? <AddressCard onSetUp={() => domainRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} /> : <PitchCard where={where} />}
      </div>

      {hosted ? (
        <div ref={domainRef} className="scroll-mt-6">
          <Card className="mt-4">
            <CardTitle
              title="Your own domain"
              description="Serve the blog from your own address. Certificates and renewals are on us."
            />
            <div className="mt-5">
              <DomainSetup />
            </div>
          </Card>
        </div>
      ) : (
        <ElsewhereCard />
      )}

      <Card className="mt-4">
        <CardTitle title="Tenant" description="One site per tenant. Everything else hangs off it." />
        <div className="mt-5 grid gap-x-6 gap-y-5 md:grid-cols-2">
          <div className="md:col-span-2">
            <SiteIdentityFields />
          </div>
          <NativeSelect
            label="Time zone"
            hint="Sweeps, schedules and quarters follow it."
            value={settings.timezone}
            onChange={(e) => void setTimeZone(e.target.value)}
            options={timeZones(settings.timezone).map((z) => ({ value: z, label: z.replace(/_/g, " ") }))}
          />
          <NativeSelect
            label="Content language"
            hint="What the agents write in."
            value={settings.language}
            onChange={(e) => void setLanguage(e.target.value)}
            options={LANGUAGES}
          />
          <NativeSelect
            label="Where the blog lives"
            hint={hosted ? "Hosted by Propaganda." : "Propaganda writes; your platform hosts."}
            value={hosted ? "propaganda" : "elsewhere"}
            onChange={(e) => void setHosting(e.target.value === "elsewhere" ? "elsewhere" : "propaganda")}
            options={[
              { value: "propaganda", label: "On Propaganda" },
              { value: "elsewhere", label: "Somewhere else" },
            ]}
          />
        </div>
      </Card>

      <Card className="mt-4">
        <DeleteSiteSection />
        <div className="mt-5 flex items-center justify-between gap-3 border-t border-secondary pt-4">
          <p className="text-sm text-tertiary">Run the first-time setup again: blog, strategy and sources.</p>
          <Button color="secondary" size="sm" iconLeading={RefreshCw01} onClick={() => goPage("welcome")}>
            Replay onboarding
          </Button>
        </div>
      </Card>
    </PageBody>
  );
}

function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <section className={cx("rounded-2xl bg-primary p-5 shadow-xs ring-1 ring-secondary ring-inset md:p-6", className)}>{children}</section>;
}

function CardTitle({ title, description }: { title: string; description?: string }) {
  return (
    <div className="min-w-0">
      <h2 className="font-title text-xl text-primary">{title}</h2>
      {description && <p className="mt-1 text-sm text-tertiary">{description}</p>}
    </div>
  );
}

/** The published design, and the way to Settings › Design, which edits it. */
function DesignSummary() {
  const name = useDesignName();
  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-secondary pt-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-medium text-secondary">
          <Brush01 className="size-4 text-fg-quaternary" />
          Design
        </div>
        <p className="mt-0.5 text-sm text-tertiary">{name ? `The ${name} theme.` : "The original design."}</p>
      </div>
      <Button size="sm" color="secondary" onClick={() => goPage("settings", "design")}>
        Change the design
      </Button>
    </div>
  );
}

function AddressCard({ onSetUp }: { onSetUp: () => void }) {
  const { site } = useWorkspace();
  const pending = useSetting<string>(PENDING_DOMAIN_KEY, "") ?? "";
  const platformHost = siteHost({ slug: site.slug, domain: "" });
  return (
    <Card>
      <CardTitle title="Address" description="Where readers find the blog." />
      <div className="mt-4 flex flex-col gap-3">
        <AddressRow label={site.domain || platformHost} note={site.domain ? "Your domain" : "Propaganda address"} live />
        {site.domain && <AddressRow label={platformHost} note={`Forwards to ${site.domain}`} />}
        {pending && pending !== site.domain && <AddressRow label={pending} note="Being set up" />}
      </div>
      {!site.domain && !pending && (
        <Button className="mt-4" color="secondary" size="sm" iconLeading={Globe01} onClick={onSetUp}>
          Use your own domain
        </Button>
      )}
    </Card>
  );
}

function AddressRow({ label, note, live }: { label: string; note: string; live?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-secondary px-3 py-2">
      <span className="flex min-w-0 items-center gap-2">
        <span className={cx("size-2 shrink-0 rounded-full", live ? "bg-success-solid" : "bg-quaternary")} />
        <span className="truncate font-mono text-sm text-primary">{label}</span>
      </span>
      <span className="shrink-0 text-xs text-tertiary">{note}</span>
    </div>
  );
}

/** Headless tenants: the pitch for hosting with us. */
function PitchCard({ where }: { where: string }) {
  return (
    <section className="rounded-2xl bg-primary p-5 shadow-xs ring-2 ring-primary ring-inset md:p-6">
      <CardTitle title={`Move it off ${where}`} description="Your blog is hosted elsewhere, so this card is our pitch." />
      <ul className="mt-4 space-y-2 text-sm text-secondary">
        <li>Faster pages, on your own domain.</li>
        <li>Posts re-checked the moment a fact changes, and fixed in place.</li>
        <li>No copy-paste between the editor and the CMS.</li>
      </ul>
      <Button className="mt-5" color="primary" size="sm" onClick={() => void setHosting("propaganda")}>
        Host it on Propaganda
      </Button>
    </section>
  );
}

function ElsewhereCard() {
  const { platform, url } = useHosting();
  return (
    <Card className="mt-4">
      <CardTitle title="Where it lives today" description="Propaganda publishes there. Your readers stay where they are." />
      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <NativeSelect
          label="Platform"
          value={platform || "other"}
          onChange={(e) => void setPlatform(e.target.value)}
          options={PLATFORMS}
        />
        <Input label="Blog address" placeholder="https://yourcompany.com/blog" defaultValue={url} onBlur={(e) => void setPlatformUrl((e.target as HTMLInputElement).value.trim())} />
      </div>
    </Card>
  );
}
