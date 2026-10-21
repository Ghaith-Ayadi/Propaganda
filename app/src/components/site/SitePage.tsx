// #/site: everything about the tenant's blog, in one place, in four tabs:
//
//   #/site (address)   where it lives, its address and custom domain, and where it is hosted
//   #/site/design      the theme and the Design editor
//   #/site/author      the author's name, photo, bio and links
//   #/site/details     the tenant's name, tagline, manifesto, time zone, language, deleting it
//
// #/site/domain opens the address tab at the custom domain. Settings used to
// hold Author, Site and Design; those links forward here (SettingsPage).

import { useEffect, useRef, type ReactNode } from "react";
import { Brush01, Globe01, LinkExternal01, RefreshCw01 } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { NativeSelect } from "@/components/base/select/select-native";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/shell/Card";
import { PageBody, PageHeader, PageTabs } from "@/components/shell/PageHeader";
import { useWorkspace } from "@/components/Workspace";
import { AuthorTab, DesignSection, SiteTab } from "@/components/SettingsDialog";
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

const TABS = [
  { id: "address", label: "Address and hosting" },
  { id: "design", label: "Design" },
  { id: "author", label: "Author" },
  { id: "details", label: "Details" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function SitePage() {
  const { site } = useWorkspace();
  const settings = useHosting();
  const rest = usePageRest();
  const hosted = settings.hosting === "propaganda";
  const where = platformLabel(settings.platform);
  // "domain" is the address tab, scrolled to the custom domain.
  const tab: TabId = TABS.some((t) => t.id === rest) ? (rest as TabId) : "address";

  const description = hosted
    ? `${siteHost(site)} · your blog runs on Propaganda.`
    : `${settings.url ? readableUrl(settings.url) : "Your blog"} · today it lives on ${where}, and Propaganda publishes to it.`;

  return (
    <>
      <PageHeader
        title="Site"
        description={description}
        tabs={<PageTabs label="Site sections" items={TABS.map((t) => ({ id: t.id, label: t.label }))} selected={tab} onChange={(id) => goPage("site", id === "address" ? null : id)} />}
      />
      <PageBody>
        {tab === "address" && <AddressTab hosted={hosted} where={where} scrollToDomain={rest === "domain"} />}
        {tab === "design" && (
          <Panel title="Design" description="The theme your blog uses, and the editor for it.">
            <DesignSection />
          </Panel>
        )}
        {tab === "author" && (
          <Panel title="Author" description="Shown by themed blogs, on the author page and next to posts.">
            <AuthorTab />
          </Panel>
        )}
        {tab === "details" && <DetailsTab />}
      </PageBody>
    </>
  );
}

function Panel({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody className="py-5">{children}</CardBody>
    </Card>
  );
}

function AddressTab({ hosted, where, scrollToDomain }: { hosted: boolean; where: string; scrollToDomain: boolean }) {
  const { site } = useWorkspace();
  const settings = useHosting();
  const domainRef = useRef<HTMLDivElement>(null);
  const toDomain = () => domainRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  useEffect(() => {
    if (scrollToDomain) toDomain();
  }, [scrollToDomain]);

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Your blog"
            description="Where it lives and what it shows."
            actions={
              <Badge type="pill-color" size="sm" color={hosted ? "brand" : "gray"}>
                {hosted ? "Propaganda" : where}
              </Badge>
            }
          />
          <CardBody>
            <div className="flex flex-wrap items-center gap-2">
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
          </CardBody>
          {hosted && <DesignSummary />}
        </Card>

        {hosted ? <AddressCard onSetUp={toDomain} /> : <PitchCard where={where} />}
      </div>

      {hosted ? (
        <div ref={domainRef} className="mt-4 scroll-mt-6">
          <Card>
            <CardHeader
              icon={<Globe01 className="size-5" />}
              title="Your own domain"
              description="Serve the blog from your own address. Certificates and renewals are on us."
            />
            <CardBody className="py-5">
              <DomainSetup />
            </CardBody>
          </Card>
        </div>
      ) : (
        <ElsewhereCard />
      )}

      <Card className="mt-4">
        <CardHeader title="Hosting" description={hosted ? "We host the blog." : "We write; your platform hosts."} />
        <CardBody className="py-5">
          <NativeSelect
            label="Where the blog lives"
            value={hosted ? "propaganda" : "elsewhere"}
            onChange={(e) => void setHosting(e.target.value === "elsewhere" ? "elsewhere" : "propaganda")}
            options={[
              { value: "propaganda", label: "On Propaganda" },
              { value: "elsewhere", label: "Somewhere else" },
            ]}
          />
        </CardBody>
      </Card>
    </>
  );
}

function DetailsTab() {
  const settings = useHosting();
  return (
    <>
      <Panel title="Tenant" description="One site per tenant. Everything else hangs off it.">
        <SiteTab />
      </Panel>

      <Card className="mt-4">
        <CardHeader title="Time and language" description="What schedules and the agents follow." />
        <CardBody className="grid gap-x-6 gap-y-5 py-5 md:grid-cols-2">
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
        </CardBody>
      </Card>

      <Card className="mt-4">
        <CardHeader
          title="Getting started"
          description="Your first day's guide: business, strategy, the plan and your first article."
          actions={
            <Button color="secondary" size="sm" iconLeading={RefreshCw01} onClick={() => goPage("getting-started")}>
              Open Getting started
            </Button>
          }
        />
      </Card>
    </>
  );
}

/** The published design, and the way to the Design tab, which edits it. */
function DesignSummary() {
  const name = useDesignName();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-secondary px-5 py-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-medium text-secondary">
          <Brush01 className="size-4 text-fg-quaternary" />
          Design
        </div>
        <p className="mt-0.5 text-sm text-tertiary">{name ? `The ${name} theme.` : "The original design."}</p>
      </div>
      <Button size="sm" color="secondary" onClick={() => goPage("site", "design")}>
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
      <CardHeader title="Address" description="Where readers find the blog." />
      <CardBody className="flex flex-col gap-3">
        <AddressRow label={site.domain || platformHost} note={site.domain ? "Your domain" : "Propaganda address"} live />
        {site.domain && <AddressRow label={platformHost} note={`Forwards to ${site.domain}`} />}
        {pending && pending !== site.domain && <AddressRow label={pending} note="Being set up" />}
        {!site.domain && !pending && (
          <div>
            <Button color="secondary" size="sm" iconLeading={Globe01} onClick={onSetUp}>
              Use your own domain
            </Button>
          </div>
        )}
      </CardBody>
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
    <Card className="ring-2 ring-primary">
      <CardHeader title={`Move it off ${where}`} description="Your blog is hosted elsewhere, so this card is our pitch." />
      <CardBody>
        <ul className="space-y-2 text-sm text-secondary">
          <li>Faster pages, on your own domain.</li>
          <li>Posts re-checked the moment a fact changes, and fixed in place.</li>
          <li>No copy-paste between the editor and the CMS.</li>
        </ul>
      </CardBody>
      <CardFooter>
        <Button color="primary" size="sm" onClick={() => void setHosting("propaganda")}>
          Host it on Propaganda
        </Button>
      </CardFooter>
    </Card>
  );
}

function ElsewhereCard() {
  const { platform, url } = useHosting();
  return (
    <Card className="mt-4">
      <CardHeader title="Where it lives today" description="Propaganda publishes there. Your readers stay where they are." />
      <CardBody className="grid gap-5 py-5 md:grid-cols-2">
        <NativeSelect
          label="Platform"
          value={platform || "other"}
          onChange={(e) => void setPlatform(e.target.value)}
          options={PLATFORMS}
        />
        <Input label="Blog address" placeholder="https://yourcompany.com/blog" defaultValue={url} onBlur={(e) => void setPlatformUrl((e.target as HTMLInputElement).value.trim())} />
      </CardBody>
    </Card>
  );
}
